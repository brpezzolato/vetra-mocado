import Decimal from 'decimal.js';
import { saoDate } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import { countsAsIncome, incomeIn } from './income';

const sum = (entries: FinancialEntry[]) =>
  entries.reduce((total, entry) => total.plus(entry.amount), new Decimal(0));

const spentIn = (entries: FinancialEntry[]) =>
  sum(entries.filter((entry) => entry.entry_type === 'expense'));

// Só a renda de verdade: sem depósito do Flash nem estorno (lib/income.ts).
const receivedIn = (entries: FinancialEntry[]) =>
  sum(entries.filter(countsAsIncome));

/** Groups expenses by key, biggest first, with each slice's share. */
function ranked(
  entries: FinancialEntry[],
  key: (entry: FinancialEntry) => string,
) {
  const expenses = entries.filter((entry) => entry.entry_type === 'expense');
  const total = sum(expenses);
  const groups = new Map<string, FinancialEntry[]>();
  for (const entry of expenses) {
    const name = key(entry) || '—';
    groups.set(name, [...(groups.get(name) ?? []), entry]);
  }
  return [...groups.entries()]
    .map(([name, group]) => {
      const amount = sum(group);
      return {
        name,
        total: amount.toFixed(2),
        count: group.length,
        share: total.isZero()
          ? 0
          : amount.div(total).mul(100).toDecimalPlaces(1).toNumber(),
      };
    })
    .sort((a, b) => Number(b.total) - Number(a.total));
}

export type DaySummary = {
  day: string;
  spent: string;
  received: string;
  count: number;
  byCategory: ReturnType<typeof ranked>;
  byAccount: ReturnType<typeof ranked>;
  entries: FinancialEntry[];
};

/** Everything that happened on one calendar day in São Paulo. */
export function daySummary(entries: FinancialEntry[], day: string): DaySummary {
  const onDay = entries
    .filter((entry) => saoDate(entry.occurred_at) === day)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return {
    day,
    spent: spentIn(onDay).toFixed(2),
    received: receivedIn(onDay).toFixed(2),
    count: onDay.length,
    byCategory: ranked(onDay, (entry) => entry.category),
    byAccount: ranked(onDay, (entry) => entry.account),
    entries: onDay,
  };
}

export type MonthSummary = {
  /** YYYY-MM. */
  month: string;
  spent: string;
  received: string;
  /** Received minus spent: negative means the month cost more than it brought. */
  net: string;
  count: number;
  byCategory: ReturnType<typeof ranked>;
  byAccount: ReturnType<typeof ranked>;
  topMerchants: ReturnType<typeof ranked>;
  /** Every day of the month, zeros included, so a chart keeps its shape. */
  daily: { day: string; total: string }[];
  busiestDay: { day: string; total: string } | null;
  dailyAverage: string;
  /** Compared with the previous month; null when there is none. */
  previous: {
    month: string;
    spent: string;
    delta: string;
    deltaPercent: number | null;
  } | null;
};

const daysInMonth = (month: string) => {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
};

const monthBefore = (month: string) => {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const inMonth = (entries: FinancialEntry[], month: string) =>
  entries.filter((entry) => saoDate(entry.occurred_at).startsWith(month));

/** Month close: spend, categories, places and comparison with the month before. */
export function monthSummary(
  entries: FinancialEntry[],
  month: string,
): MonthSummary {
  const current = inMonth(entries, month);
  const spent = spentIn(current);
  // Entradas pelo mês em que contam (lib/income.ts).
  const received = sum(incomeIn(entries, month));

  const perDay = new Map<string, Decimal>();
  for (const entry of current)
    if (entry.entry_type === 'expense') {
      const day = saoDate(entry.occurred_at);
      perDay.set(day, (perDay.get(day) ?? new Decimal(0)).plus(entry.amount));
    }
  const daily = Array.from({ length: daysInMonth(month) }, (_, index) => {
    const day = `${month}-${String(index + 1).padStart(2, '0')}`;
    return { day, total: (perDay.get(day) ?? new Decimal(0)).toFixed(2) };
  });
  const busiest = daily.reduce<{ day: string; total: string } | null>(
    (best, day) =>
      Number(day.total) > 0 && (!best || Number(day.total) > Number(best.total))
        ? day
        : best,
    null,
  );

  const earlier = monthBefore(month);
  const before = inMonth(entries, earlier);
  const beforeSpent = spentIn(before);
  // An empty month is no data, not zero spend.
  const previous = before.length
    ? {
        month: earlier,
        spent: beforeSpent.toFixed(2),
        delta: spent.minus(beforeSpent).toFixed(2),
        deltaPercent: beforeSpent.isZero()
          ? null
          : spent
              .minus(beforeSpent)
              .div(beforeSpent)
              .mul(100)
              .toDecimalPlaces(1)
              .toNumber(),
      }
    : null;

  const daysElapsed = daily.filter((day) => Number(day.total) > 0).length;
  return {
    month,
    spent: spent.toFixed(2),
    received: received.toFixed(2),
    net: received.minus(spent).toFixed(2),
    count: current.length,
    byCategory: ranked(current, (entry) => entry.category),
    byAccount: ranked(current, (entry) => entry.account),
    topMerchants: ranked(current, (entry) => entry.description),
    daily,
    busiestDay: busiest,
    dailyAverage: daysElapsed
      ? spent.div(daysElapsed).toFixed(2)
      : new Decimal(0).toFixed(2),
    previous,
  };
}

/** Months with entries, newest first. */
export function monthsWithEntries(entries: FinancialEntry[]) {
  return [
    ...new Set(entries.map((entry) => saoDate(entry.occurred_at).slice(0, 7))),
  ].sort((a, b) => b.localeCompare(a));
}

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function monthLabel(month: string) {
  const [year, index] = month.split('-').map(Number);
  const name = MONTH_NAMES[index - 1];
  return name ? `${name} de ${year}` : month;
}
