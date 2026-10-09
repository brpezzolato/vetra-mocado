import Decimal from 'decimal.js';
import type { AllowanceDay } from './daily-allowance';

/* Lista de desejos: quantos dias de sobra do valor do dia faltam para comprar.
   Sobra = valor do dia − gasto (mínimo zero), nos dias encerrados. Progresso =
   soma das sobras desde a entrada; previsão pela média dos últimos 14 dias. */

export type WishlistItem = {
  id: string;
  name: string;
  price: number | string;
  created_at: string;
  bought_at: string | null;
};

/** Quantos dias de sobra entram na média. */
const AVERAGE_DAYS = 14;

/** A sobra de cada dia que já acabou: yyyy-mm-dd → valor. */
export function leftoverByDay({
  today,
  allowances,
  spentByDay,
}: {
  today: string;
  allowances: AllowanceDay[];
  spentByDay: Record<string, Decimal.Value>;
}) {
  const leftover: Record<string, Decimal> = {};
  for (const item of allowances) {
    if (item.day >= today) continue;
    leftover[item.day] = Decimal.max(
      new Decimal(item.allowance).minus(spentByDay[item.day] ?? 0),
      0,
    );
  }
  return leftover;
}

export function wishProgress({
  item,
  today,
  leftover,
}: {
  item: Pick<WishlistItem, 'price' | 'created_at'>;
  today: string;
  leftover: Record<string, Decimal>;
}) {
  const since = item.created_at.slice(0, 10);
  const price = new Decimal(item.price);
  const saved = Object.entries(leftover)
    .filter(([day]) => day >= since)
    .reduce((sum, [, value]) => sum.plus(value), new Decimal(0));
  const recent = Object.entries(leftover)
    .filter(([day]) => day < today)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, AVERAGE_DAYS);
  const average = recent.length
    ? recent
        .reduce((sum, [, value]) => sum.plus(value), new Decimal(0))
        .div(recent.length)
    : new Decimal(0);
  const missing = Decimal.max(price.minus(saved), 0);
  return {
    saved: Decimal.min(saved, price),
    missing,
    percent: price.gt(0)
      ? Math.min(
          100,
          Decimal.min(saved, price).div(price).times(100).toNumber(),
        )
      : 0,
    ready: missing.isZero(),
    /** Dias de sobra que faltam, pela média; nulo sem sobra para medir. */
    daysLeft: missing.isZero()
      ? 0
      : average.gt(0)
        ? missing.div(average).ceil().toNumber()
        : null,
  };
}
