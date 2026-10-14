import Decimal from 'decimal.js';
import { saoDate } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';

/* Gasto no cartão que já aconteceu e ainda não chegou como compra (a Pluggy
   leva até 3 dias úteis). Por dia:
     subida do usado (limite − disponível)
   + pagamentos de fatura e estornos do dia (liberam limite)
   − compras que já chegaram no mesmo intervalo
   = gasto sem compra (mínimo zero).
   O dia vai da última foto antes da meia-noite até a última foto dele; as
   compras entram pela hora exata. Quando a compra chega, o valor some. */

export type LimitSnapshot = {
  account: string;
  taken_at: string;
  /** Hora dos dados (última atualização da conexão); é ela que define a janela. */
  data_at?: string | null;
  credit_limit: number | string;
  available: number | string;
};

/** Uma compra (ou estorno) do cartão, como a sincronização grava. */
export type CardMovement = {
  account: string;
  occurred_at: string;
  /** Positivo; estorno é `income`. */
  amount: number | string;
  entry_type: 'expense' | 'income';
  installment_number?: number | null;
  installment_purchase_total?: number | string | null;
};

export type CardPayment = {
  account: string;
  date: string;
  amount: number | string;
};

export type UnidentifiedSpend = {
  day: string;
  account: string;
  amount: string;
  /** Foto que mostrou a queda: o gasto aconteceu até esta hora. */
  at: string;
  /** Gasto anterior à primeira foto de um cartão novo (`openingGap`). */
  opening?: boolean;
  /** Parte de uma divisão feita pelo usuário (`applySplits`). */
  split?: {
    /** Dia em que o app viu a queda: a chave da divisão. */
    day: string;
    /** O valor a chegar inteiro, quando a divisão foi aplicada. */
    total: string;
    /** O nome que o usuário deu à parte, se deu. */
    description: string | null;
  };
};

export type SplitPart = {
  amount: string;
  day: string;
  description?: string | null;
};

export type PendingSplit = {
  account: string;
  day: string;
  parts: SplitPart[];
  /** O valor dividido. Sem ele (divisão antiga), vale o valor atual. */
  total?: number | string | null;
  /** A hora da foto que mostrou a queda dividida. */
  seen_until?: string | null;
  updated_at?: string | null;
};

/** Compra do cartão com a hora em que chegou ao app. */
export type ArrivedMovement = CardMovement & { created_at?: string | null };

const CENT_TOLERANCE = new Decimal('0.05');

/** O primeiro subconjunto de `parts` (mantendo a ordem) que soma `target`. */
function subsetSumming(parts: SplitPart[], target: Decimal) {
  const n = parts.length;
  for (let size = n; size >= 1; size--)
    for (let mask = 0; mask < 1 << n; mask++) {
      let count = 0;
      for (let bit = mask; bit; bit &= bit - 1) count++;
      if (count !== size) continue;
      const chosen = parts.filter((_, index) => mask & (1 << index));
      const sum = chosen.reduce(
        (total, part) => total.plus(part.amount),
        new Decimal(0),
      );
      if (sum.minus(target).abs().lte(CENT_TOLERANCE)) return chosen;
    }
  return null;
}

/**
 * Troca cada compra a chegar dividida pelo usuário pelas partes dele.
 * A divisão cobre só a queda que o usuário viu (`total`): as compras feitas
 * até ela que chegaram depois abatem o total, e o que cair no limite além
 * disso é compra nova, no próprio dia.
 * - Partes somam o valor atual: viram as compras (cada uma no seu dia).
 * - Somam menos: partes + o resto, ainda como compra a chegar.
 * - Somam mais (compras já chegaram): só as partes que somam o que falta.
 * - Nada fecha: o valor que falta, no dia da maior parte.
 */
export function applySplits(
  items: UnidentifiedSpend[],
  splits: PendingSplit[],
  movements: ArrivedMovement[] = [],
): UnidentifiedSpend[] {
  return items.flatMap((whole) => {
    const split = splits.find(
      (candidate) =>
        candidate.account === whole.account && candidate.day === whole.day,
    );
    if (!split?.parts.length) return [whole];
    // Quanto da queda dividida ainda falta chegar; o resto é compra nova.
    let item = whole;
    const fresh: UnidentifiedSpend[] = [];
    if (split.total != null && split.seen_until && split.updated_at) {
      const since = Date.parse(split.updated_at);
      const until = Date.parse(split.seen_until);
      const arrived = movements
        .filter(
          (movement) =>
            movement.account === whole.account &&
            movement.created_at &&
            Date.parse(movement.created_at) > since &&
            Date.parse(movement.occurred_at) <= until,
        )
        .reduce(
          (sum, movement) => sum.plus(limitUse(movement)),
          new Decimal(0),
        );
      const left = Decimal.max(new Decimal(split.total).minus(arrived), 0);
      const extra = new Decimal(whole.amount).minus(left);
      if (extra.gt(0)) {
        if (extra.gte(1)) fresh.push({ ...whole, amount: extra.toFixed(2) });
        // Divisão cumprida: só a compra nova segue.
        if (left.lt(1)) return fresh;
        item = { ...whole, amount: left.toFixed(2) };
      }
    }
    return [...splitInto(item, split), ...fresh];
  });
}

/** As partes de uma divisão para o valor que ainda falta chegar. */
function splitInto(
  item: UnidentifiedSpend,
  split: PendingSplit,
): UnidentifiedSpend[] {
  const amount = new Decimal(item.amount);
  const sum = split.parts.reduce(
    (total, part) => total.plus(part.amount),
    new Decimal(0),
  );
  const toItem = (part: SplitPart): UnidentifiedSpend => ({
    day: part.day,
    account: item.account,
    amount: new Decimal(part.amount).toFixed(2),
    at: `${part.day}T12:00:00-03:00`,
    split: {
      day: item.day,
      total: item.amount,
      description: part.description?.trim() || null,
    },
  });
  if (sum.minus(amount).abs().lte(CENT_TOLERANCE))
    return split.parts.map(toItem);
  if (sum.lt(amount))
    return [
      ...split.parts.map(toItem),
      {
        ...item,
        amount: amount.minus(sum).toFixed(2),
        split: { day: item.day, total: item.amount, description: null },
      },
    ];
  const remaining = subsetSumming(split.parts, amount);
  if (remaining) return remaining.map(toItem);
  // Nada fecha: o que falta chegar fica no dia da maior parte, para a
  // correção de data não se perder quando parte das compras chega.
  const main = split.parts.reduce((best, part) =>
    new Decimal(part.amount).gt(best.amount) ? part : best,
  );
  return [
    {
      ...toItem(main),
      amount: item.amount,
      split: { day: item.day, total: item.amount, description: null },
    },
  ];
}

/** Dias seguidos no calendário (yyyy-mm-dd). */
const neighbours = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) ===
  86_400_000;

/** A hora que vale de uma foto: a dos dados, ou a da foto sem ela. */
const seen = (snapshot: LimitSnapshot) => snapshot.data_at ?? snapshot.taken_at;

const used = (snapshot: LimitSnapshot) =>
  new Decimal(snapshot.credit_limit).minus(snapshot.available);

/** Parcelada usa o total na 1ª parcela; as outras não mexem no limite. */
function limitUse(movement: CardMovement) {
  if (movement.entry_type === 'income')
    return new Decimal(movement.amount).negated();
  if (movement.installment_number && movement.installment_number > 1)
    return new Decimal(0);
  if (movement.installment_number === 1 && movement.installment_purchase_total)
    return new Decimal(movement.installment_purchase_total);
  return new Decimal(movement.amount);
}

export function unidentifiedSpend({
  days,
  snapshots,
  movements,
  payments,
}: {
  /** Os dias a olhar (yyyy-mm-dd), do mais antigo ao mais novo. */
  days: string[];
  snapshots: LimitSnapshot[];
  movements: CardMovement[];
  payments: CardPayment[];
}): UnidentifiedSpend[] {
  const result: UnidentifiedSpend[] = [];
  const accounts = [...new Set(snapshots.map((snapshot) => snapshot.account))];
  for (const account of accounts) {
    const shots = snapshots
      .filter((snapshot) => snapshot.account === account)
      .sort((a, b) => seen(a).localeCompare(seen(b)));
    // O que falta em cada dia, ainda sem arredondar para zero.
    const raw: { day: string; missing: Decimal; at: string }[] = [];
    for (const day of days) {
      // Abre com a última foto anterior (ou a primeira do dia, sem anterior) e
      // fecha com a última do dia.
      const during = shots.filter((shot) => saoDate(seen(shot)) === day);
      const before =
        shots.filter((shot) => saoDate(seen(shot)) < day).at(-1) ??
        (during.length > 1 ? during[0] : undefined);
      const end = during.at(-1);
      if (!before || !end) continue;
      const from = Date.parse(seen(before));
      const to = Date.parse(seen(end));
      const explained = movements
        .filter(
          (movement) =>
            movement.account === account &&
            Date.parse(movement.occurred_at) > from &&
            Date.parse(movement.occurred_at) <= to,
        )
        .reduce(
          (sum, movement) => sum.plus(limitUse(movement)),
          new Decimal(0),
        );
      const paid = payments
        .filter(
          (payment) => payment.account === account && payment.date === day,
        )
        .reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0));
      raw.push({
        day,
        missing: used(end).minus(used(before)).plus(paid).minus(explained),
        at: seen(end),
      });
    }
    // A compra pode ter hora num dia vizinho ao da queda: o negativo de um
    // dia abate a sobra do dia seguinte e depois a do anterior. Só vizinho:
    // compra no 1º dia da janela cuja queda foi antes dela (129,00 em
    // 08/10/2026, queda em 07/10) apagava compras de dias depois.
    raw.forEach((item, index) => {
      let owed = item.missing.negated();
      if (owed.lte(0)) return;
      for (const other of [raw[index + 1], raw[index - 1]]) {
        if (!other || !neighbours(item.day, other.day) || other.missing.lte(0))
          continue;
        const taken = Decimal.min(other.missing, owed);
        other.missing = other.missing.minus(taken);
        owed = owed.minus(taken);
        if (owed.lte(0)) break;
      }
      item.missing = new Decimal(0);
    });
    // Centavos de arredondamento não são compra.
    for (const item of raw)
      if (item.missing.gte(1))
        result.push({
          day: item.day,
          account,
          amount: item.missing.toFixed(2),
          at: item.at,
        });
  }
  return result;
}

/**
 * Gasto anterior à primeira foto de um cartão novo: usado na foto − compras
 * até a hora dos dados. Só vale para cartão sem fatura nem pagamento.
 * Fica na véspera: o banco leva ao menos um dia para mandar a compra.
 */
export function openingGap(
  first: LimitSnapshot,
  movements: CardMovement[],
): UnidentifiedSpend | null {
  const until = Date.parse(seen(first));
  const known = movements
    .filter(
      (movement) =>
        movement.account === first.account &&
        Date.parse(movement.occurred_at) <= until,
    )
    .reduce((sum, movement) => sum.plus(limitUse(movement)), new Decimal(0));
  const missing = used(first).minus(known);
  if (missing.lt(1)) return null;
  const eve = new Date(`${saoDate(seen(first))}T12:00:00Z`);
  eve.setUTCDate(eve.getUTCDate() - 1);
  const day = eve.toISOString().slice(0, 10);
  return {
    day,
    account: first.account,
    amount: missing.toFixed(2),
    // Fim da véspera em São Paulo.
    at: new Date(`${day}T23:59:00-03:00`).toISOString(),
    opening: true,
  };
}

/* Gasto sem compra vira compra "a chegar" na lista e na fatura: conta nos
   totais, mas não existe no banco, não abre e some quando a compra chega. */

const PENDING_PREFIX = 'a-chegar:';

export const PENDING_DESCRIPTION = 'Compra a chegar';

export function pendingEntries(items: UnidentifiedSpend[]): FinancialEntry[] {
  return items.map((item, index) => ({
    id: `${PENDING_PREFIX}${item.account}:${item.split?.day ?? item.day}:${index}`,
    user_id: '',
    entry_type: 'expense',
    amount: item.amount,
    description: item.split?.description ?? PENDING_DESCRIPTION,
    category: 'A identificar',
    account: item.account,
    occurred_at: item.at,
    source: 'pluggy',
    external_id: null,
    bank_status: 'PENDING',
    ...(item.opening && {
      notes: 'Feita antes da primeira leitura do limite',
    }),
    ...(item.split && { notes: 'Dividida por você' }),
    created_at: item.at,
    updated_at: item.at,
  }));
}

export const isPendingSpend = (entry: Pick<FinancialEntry, 'id'>) =>
  entry.id.startsWith(PENDING_PREFIX);

/** A compra a chegar (cartão e dia em que o app viu a queda) de um lançamento. */
export function pendingKey(entry: Pick<FinancialEntry, 'id'>) {
  if (!isPendingSpend(entry)) return null;
  const rest = entry.id.slice(PENDING_PREFIX.length);
  const match = rest.match(/^(.*):(\d{4}-\d{2}-\d{2}):\d+$/);
  return match ? { account: match[1]!, day: match[2]! } : null;
}
