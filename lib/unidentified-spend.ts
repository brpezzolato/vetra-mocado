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
};

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
    // A compra pode ter hora num dia vizinho ao da queda. O negativo abate a
    // sobra dos dias seguintes e depois dos anteriores; o total da janela é
    // sempre queda − compras.
    let carry = new Decimal(0);
    for (const item of raw) {
      const net = item.missing.plus(carry);
      item.missing = Decimal.max(net, 0);
      carry = Decimal.min(net, 0);
    }
    for (const item of [...raw].reverse()) {
      if (carry.isZero()) break;
      const net = item.missing.plus(carry);
      item.missing = Decimal.max(net, 0);
      carry = Decimal.min(net, 0);
    }
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
  return items.map((item) => ({
    id: `${PENDING_PREFIX}${item.account}:${item.day}`,
    user_id: '',
    entry_type: 'expense',
    amount: item.amount,
    description: PENDING_DESCRIPTION,
    category: 'A identificar',
    account: item.account,
    occurred_at: item.at,
    source: 'pluggy',
    external_id: null,
    bank_status: 'PENDING',
    ...(item.opening && {
      notes: 'Feita antes da primeira leitura do limite',
    }),
    created_at: item.at,
    updated_at: item.at,
  }));
}

export const isPendingSpend = (entry: Pick<FinancialEntry, 'id'>) =>
  entry.id.startsWith(PENDING_PREFIX);
