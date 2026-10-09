// Retrospectiva do mês em destaques (estilo "Wrapped"). Só o que sai dos
// lançamentos; o rendimento dos cofrinhos é somado na tela.
import Decimal from 'decimal.js';
import { saoDate } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import { monthSummary } from './period-summary';

const daysInMonth = (month: string) => {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
};

export const shiftMonth = (month: string, by: number) => {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Parcela da 2ª em diante é dívida sendo paga: não é maior compra nem quebra
 * a sequência sem gastos. A 1ª vale pelo total.
 */
const isLaterInstallment = (entry: FinancialEntry) =>
  Boolean(entry.installment_group_id || entry.installment_total) &&
  (entry.installment_number ?? 1) > 1;

export type MonthlyRecap = {
  month: string;
  /** O mês ainda não acabou: os números são até hoje. */
  partial: boolean;
  spent: string;
  count: number;
  previous: {
    month: string;
    spent: string;
    deltaPercent: number | null;
  } | null;
  biggestPurchase: {
    description: string;
    category: string;
    day: string;
    amount: string;
    /** Parcelada: `amount` é o total da compra, e isto o número de parcelas. */
    installments: number | null;
  } | null;
  /** A categoria que mais cresceu em reais contra o mês anterior. */
  risingCategory: {
    name: string;
    total: string;
    previous: string;
    delta: string;
  } | null;
  topCategory: { name: string; total: string; share: number } | null;
  /** A loja onde mais se comprou, em número de vezes. */
  favoritePlace: { name: string; count: number; total: string } | null;
  /** A maior sequência de dias seguidos sem gasto novo. */
  noSpendStreak: { days: number; start: string; end: string } | null;
  noSpendDays: number;
};

export function monthlyRecap(
  entries: FinancialEntry[],
  month: string,
  now = new Date(),
): MonthlyRecap {
  const today = saoDate(now);
  const partial = today.slice(0, 7) === month;
  const summary = monthSummary(entries, month);
  const current = entries.filter(
    (entry) =>
      entry.entry_type === 'expense' &&
      saoDate(entry.occurred_at).startsWith(month),
  );

  let biggestPurchase: MonthlyRecap['biggestPurchase'] = null;
  for (const entry of current) {
    if (isLaterInstallment(entry)) continue;
    const installments =
      (entry.installment_total ?? 0) > 1 ? entry.installment_total! : null;
    const amount = new Decimal(
      installments && entry.installment_purchase_total
        ? entry.installment_purchase_total
        : installments
          ? new Decimal(entry.amount).times(installments)
          : entry.amount,
    );
    if (!biggestPurchase || amount.gt(biggestPurchase.amount))
      biggestPurchase = {
        description: entry.description,
        category: entry.category,
        day: saoDate(entry.occurred_at),
        amount: amount.toFixed(2),
        installments,
      };
  }

  const before = summary.previous
    ? monthSummary(entries, summary.previous.month)
    : null;
  const priorByName = new Map(
    (before?.byCategory ?? []).map((category) => [category.name, category]),
  );
  let risingCategory: MonthlyRecap['risingCategory'] = null;
  if (before)
    for (const category of summary.byCategory) {
      const previous = new Decimal(priorByName.get(category.name)?.total ?? 0);
      const delta = new Decimal(category.total).minus(previous);
      if (delta.gt(0) && (!risingCategory || delta.gt(risingCategory.delta)))
        risingCategory = {
          name: category.name,
          total: category.total,
          previous: previous.toFixed(2),
          delta: delta.toFixed(2),
        };
    }

  const visits = new Map<string, { count: number; total: Decimal }>();
  for (const entry of current) {
    if (isLaterInstallment(entry)) continue;
    const place = visits.get(entry.description) ?? {
      count: 0,
      total: new Decimal(0),
    };
    visits.set(entry.description, {
      count: place.count + 1,
      total: place.total.plus(entry.amount),
    });
  }
  const favorite = [...visits].sort(
    (a, b) => b[1].count - a[1].count || b[1].total.comparedTo(a[1].total),
  )[0];

  // Os dias contados vão até ontem no mês corrente: hoje ainda pode ter gasto.
  const lastDay = partial ? Number(today.slice(8)) - 1 : daysInMonth(month);
  const spendDays = new Set(
    current
      .filter((entry) => !isLaterInstallment(entry))
      .map((entry) => saoDate(entry.occurred_at)),
  );
  let noSpendStreak: MonthlyRecap['noSpendStreak'] = null;
  let noSpendDays = 0;
  let run = 0;
  for (let index = 1; index <= lastDay; index++) {
    const day = `${month}-${String(index).padStart(2, '0')}`;
    if (spendDays.has(day)) {
      run = 0;
      continue;
    }
    noSpendDays++;
    run++;
    if (!noSpendStreak || run > noSpendStreak.days)
      noSpendStreak = {
        days: run,
        start: `${month}-${String(index - run + 1).padStart(2, '0')}`,
        end: day,
      };
  }

  const top = summary.byCategory[0];
  return {
    month,
    partial,
    spent: summary.spent,
    count: current.length,
    previous: summary.previous
      ? {
          month: summary.previous.month,
          spent: summary.previous.spent,
          deltaPercent: summary.previous.deltaPercent,
        }
      : null,
    biggestPurchase,
    risingCategory,
    topCategory: top
      ? { name: top.name, total: top.total, share: top.share }
      : null,
    favoritePlace: favorite
      ? {
          name: favorite[0],
          count: favorite[1].count,
          total: favorite[1].total.toFixed(2),
        }
      : null,
    noSpendStreak,
    noSpendDays,
  };
}

/** O mês que a retrospectiva abre: o anterior, que já fechou. */
export const recapDefaultMonth = (now = new Date()) =>
  shiftMonth(saoDate(now).slice(0, 7), -1);

/** A home lembra da retrospectiva nos 3 primeiros dias do mês. */
export const recapIsFresh = (now = new Date()) =>
  Number(saoDate(now).slice(8)) <= 3;
