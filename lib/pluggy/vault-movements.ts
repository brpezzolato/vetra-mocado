// Movimentações dos cofrinhos vindas do banco. Puro.
// - Nubank: cada lote tem seus movimentos (`BUY` aporte, `SELL` retirada).
// - Mercado Pago: aparecem na conta corrente com `operationType`
//   TRANSFERENCIA_SALDO_RESERVADO e "Dinheiro reservado/retirado <reserva>".
import Decimal from 'decimal.js';
import type { PiggySnapshot } from './investments';
import type {
  PluggyInvestmentLot,
  PluggyInvestmentMovement,
  PluggyReserve,
  PluggyTransaction,
} from './types';

export type BankMovement = {
  externalId: string;
  kind: 'deposit' | 'withdrawal';
  /** Em reais, duas casas. Na retirada é o que caiu na conta. */
  amount: string;
  occurredAt: string;
};

export type ExistingMovement = {
  id: string;
  kind: string;
  amount: number | string;
  occurred_at: string;
  external_id: string | null;
};

const TIME_ZONE = 'America/Sao_Paulo';

/** O dia em São Paulo de um instante ISO. */
export function saoPauloDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts;
}

/**
 * Dia de uma data de investimento: a Pluggy manda meia-noite UTC (um dia, não
 * um instante), então corta a data e grava meio-dia.
 */
export function calendarDay(value: string): string {
  return value.slice(0, 10);
}

const noon = (day: string) => `${day}T12:00:00-03:00`;

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

const cents = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? null
    : new Decimal(Math.abs(value)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Sem acento e espaços normalizados, **mantendo a caixa**. */
const unaccented = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Movimentos de uma reserva do MP pelo nome na descrição, sem acento e sem
 * caixa. O MP renomeia acrescentando um número: tolerado, mas então a caixa
 * tem de bater exatamente.
 */
export function reserveMovements(
  transactions: PluggyTransaction[],
  reserveName: string,
): BankMovement[] {
  const name = plain(reserveName);
  const base = unaccented(reserveName).replace(/ \d+$/, '');
  const renamed = base !== unaccented(reserveName);
  return transactions.flatMap((transaction) => {
    if (transaction.operationType !== 'TRANSFERENCIA_SALDO_RESERVADO')
      return [];
    const match = /^dinheiro (reservado|retirado) (.+)$/i.exec(
      unaccented(transaction.description),
    );
    if (!match) return [];
    const target = match[2];
    const same = plain(target) === name || (renamed && target.trim() === base);
    if (!same) return [];
    const amount = cents(transaction.amount);
    if (!amount || amount.isZero()) return [];
    return [
      {
        externalId: `pluggy:${transaction.id}`,
        kind: match[1].toLowerCase() === 'reservado' ? 'deposit' : 'withdrawal',
        amount: amount.toFixed(2),
        occurredAt: transaction.date,
      },
    ];
  });
}

/**
 * Movimentos de uma reserva recém-aparecida: os mais recentes até a soma
 * bater com o saldo (folga de 2% ou R$ 1,00 para rendimento). Sem soma que
 * bata, nenhum.
 */
export function explainBalance(
  movements: BankMovement[],
  balance: number | null,
): BankMovement[] {
  if (balance === null) return [];
  const target = new Decimal(balance);
  const slack = Decimal.max(new Decimal(1), target.mul('0.02'));
  const newestFirst = [...movements].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );
  let total = new Decimal(0);
  for (let index = 0; index < newestFirst.length; index++) {
    const movement = newestFirst[index];
    total =
      movement.kind === 'deposit'
        ? total.plus(movement.amount)
        : total.minus(movement.amount);
    const gap = target.minus(total);
    if (gap.gte(0) && gap.lte(slack)) return newestFirst.slice(0, index + 1);
  }
  return [];
}

/**
 * Aportes e retiradas dos lotes. Lote aberto antes de `importFrom` fica fora
 * inteiro, inclusive retiradas posteriores.
 */
export function lotMovements(
  lots: PluggyInvestmentLot[],
  movementsByLot: Map<string, PluggyInvestmentMovement[]>,
  importFrom: string | null,
): BankMovement[] {
  return lots.flatMap((lot) => {
    const opened = lot.purchaseDate ? calendarDay(lot.purchaseDate) : null;
    if (!opened || (importFrom && opened < importFrom)) return [];
    return (movementsByLot.get(lot.id) ?? []).flatMap((movement) => {
      const kind =
        movement.type === 'BUY'
          ? 'deposit'
          : movement.type === 'SELL'
            ? 'withdrawal'
            : null;
      const amount = cents(
        kind === 'withdrawal'
          ? (movement.netAmount ?? movement.amount)
          : movement.amount,
      );
      if (!kind || !amount || amount.isZero() || !movement.date) return [];
      return [
        {
          externalId: `pluggy:${movement.id}`,
          kind,
          amount: amount.toFixed(2),
          occurredAt: noon(calendarDay(movement.date)),
        },
      ];
    });
  });
}

/**
 * O que gravar: já visto fica; lançado à mão com mesmo tipo, valor e dia é
 * adotado (ganha o id do banco); o resto é inserido. Antes de `importFrom`, nada.
 */
export function planMovementWrites(
  bank: BankMovement[],
  existing: ExistingMovement[],
  importFrom: string | null,
): { adopt: { id: string; externalId: string }[]; insert: BankMovement[] } {
  const known = new Set(
    existing.map((row) => row.external_id).filter(Boolean) as string[],
  );
  const free = existing.filter((row) => !row.external_id);
  const adopt: { id: string; externalId: string }[] = [];
  const insert: BankMovement[] = [];
  for (const movement of bank) {
    if (known.has(movement.externalId)) continue;
    const day = saoPauloDay(movement.occurredAt);
    if (importFrom && day < importFrom) continue;
    const index = free.findIndex(
      (row) =>
        row.kind === movement.kind &&
        new Decimal(row.amount).eq(movement.amount) &&
        saoPauloDay(row.occurred_at) === day,
    );
    if (index >= 0) {
      adopt.push({ id: free[index].id, externalId: movement.externalId });
      free.splice(index, 1);
    } else insert.push(movement);
    known.add(movement.externalId);
  }
  return { adopt, insert };
}

/**
 * Saldo da reserva do MP como conciliação do dia da última atualização do
 * item. Sem imposto separado.
 */
export function reserveSnapshot(
  reserve: PluggyReserve,
  itemUpdatedAt: string | null,
): PiggySnapshot | null {
  const amount = cents(reserve.amount);
  if (!amount || !itemUpdatedAt || (reserve.amount ?? 0) < 0) return null;
  return {
    snapshotDate: saoPauloDay(itemUpdatedAt),
    gross: amount.toFixed(2),
    net: amount.toFixed(2),
    iof: null,
    incomeTax: null,
  };
}

/**
 * Arquivado não volta só porque o banco ainda mostra os lotes (o Nubank
 * informa caixinha excluída como ativa por um tempo). Volta, como novo, só
 * com aporte após o arquivamento.
 */
export function archiveStillCovers(
  archivedAt: string,
  openedDays: string[],
): boolean {
  const newest = [...openedDays].sort().at(-1);
  return !!newest && newest <= saoPauloDay(archivedAt);
}
