import Decimal from 'decimal.js';
import type { FinancialEntry } from './financial-tracker';
import { saoDate } from './expense-insights';
import { EXPENSE_CATEGORIES } from './expense-categories';
import {
  resolvePaymentMethod,
  type PaymentCard,
  type PaymentMethodId,
} from './payment-cards';

/** Purchases paid by someone else: tracked, but kept apart from own spending. */
export const OTHER_PAYER_ACCOUNT = 'Pago por outra pessoa';

// Dates are São Paulo calendar days (YYYY-MM-DD), independent of device zone.
const dayOf = (entry: FinancialEntry) => saoDate(entry.occurred_at);
const monthOf = (day: string) => day.slice(0, 7);
const dayOfMonth = (day: string) => Number(day.slice(8, 10));
const pad = (value: number) => String(value).padStart(2, '0');

function addMonths(month: string, offset: number) {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

function addDays(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function daysInMonth(month: string) {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

export function monthLabel(month: string, style: 'short' | 'long' = 'short') {
  const [year, index] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: style })
    .format(new Date(Date.UTC(year, index - 1, 15)))
    .replace('.', '');
}

const sum = (entries: FinancialEntry[]) =>
  entries.reduce((total, entry) => total.plus(entry.amount), new Decimal(0));

const normalized = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/** Case-insensitive merge, preferring the canonical spelling. */
function categoryName(value: string) {
  const key = normalized(value);
  return (
    EXPENSE_CATEGORIES.find((item) => normalized(item) === key) ??
    (value.trim().replace(/\s+/g, ' ') || 'Não informado')
  );
}

type Group = { name: string; total: number; count: number; share: number };

function grouped(
  entries: FinancialEntry[],
  label: (entry: FinancialEntry) => string,
  whole: Decimal,
): Group[] {
  const groups = new Map<
    string,
    { name: string; total: Decimal; count: number }
  >();
  for (const entry of entries) {
    const name = label(entry).trim().replace(/\s+/g, ' ') || 'Não informado';
    const key = normalized(name);
    const current = groups.get(key) ?? {
      name,
      total: new Decimal(0),
      count: 0,
    };
    current.total = current.total.plus(entry.amount);
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((item) => ({
      name: item.name,
      total: item.total.toNumber(),
      count: item.count,
      share: whole.isZero() ? 0 : item.total.div(whole).mul(100).toNumber(),
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Months from the first record to now, newest first. Earlier months are
 * "no data", not "no spending".
 */
export function availableMonths(entries: FinancialEntry[], now = new Date()) {
  const current = monthOf(saoDate(now));
  const start = trackingStartOf(entries, now);
  if (!start) return [current];
  const months: string[] = [];
  for (
    let month = current;
    month >= monthOf(start);
    month = addMonths(month, -1)
  )
    months.push(month);
  return months;
}

/** First recorded day: anything before it is no data, not zero. */
function trackingStartOf(entries: FinancialEntry[], now: Date) {
  const nowTime = now.getTime();
  return (
    entries
      .filter((entry) => new Date(entry.occurred_at).getTime() <= nowTime)
      .map(dayOf)
      .sort()[0] ?? null
  );
}

/** The years the screen can show as a running total, newest first. */
export function availableYears(entries: FinancialEntry[], now = new Date()) {
  return [
    ...new Set(availableMonths(entries, now).map((month) => month.slice(0, 4))),
  ];
}

export type PeriodKind = 'month' | 'year' | 'all';

const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T12:00:00Z`).getTime() -
      new Date(`${from}T12:00:00Z`).getTime()) /
      86_400_000,
  );

/** `period` is a month (YYYY-MM), a year (YYYY) for its running total, or
 * "all" for the whole history. `month` is the older name for the first. */
export function buildFinancialVisualizations(
  entries: FinancialEntry[],
  options: {
    now?: Date;
    period?: string;
    month?: string;
    cards?: PaymentCard[];
  } = {},
) {
  const now = options.now ?? new Date();
  const nowTime = now.getTime();
  const cards = options.cards ?? [];
  const today = saoDate(now);
  const currentMonth = monthOf(today);
  const currentYear = today.slice(0, 4);
  const trackingStart = trackingStartOf(entries, now);
  const requested = options.period ?? options.month ?? currentMonth;
  const kind: PeriodKind =
    requested === 'all' ? 'all' : /^\d{4}$/.test(requested) ? 'year' : 'month';
  // Outside a month view, `month` is the current one (drives scheduled instalments).
  const month =
    kind === 'month' && requested <= currentMonth ? requested : currentMonth;
  const year =
    kind === 'year' && requested <= currentYear ? requested : currentYear;
  const isCurrentMonth = kind === 'month' && month === currentMonth;
  const monthDays = daysInMonth(month);
  const periodStart =
    kind === 'month'
      ? `${month}-01`
      : kind === 'year'
        ? `${year}-01-01`
        : (trackingStart ?? today);
  const periodEnd =
    kind === 'month'
      ? `${month}-${pad(monthDays)}`
      : kind === 'year'
        ? `${year}-12-31`
        : today;
  // The last day the period has actually lived through.
  const referenceDay = periodEnd >= today ? today : periodEnd;
  const inPeriod = (day: string) => day >= periodStart && day <= periodEnd;

  const happened = (entry: FinancialEntry) =>
    new Date(entry.occurred_at).getTime() <= nowTime;
  const expenses = entries.filter((entry) => entry.entry_type === 'expense');

  const periodEntries = expenses.filter(
    (entry) => inPeriod(dayOf(entry)) && happened(entry),
  );
  // Card instalments later this month are certain, not a guess.
  const scheduled = isCurrentMonth
    ? expenses.filter(
        (entry) => monthOf(dayOf(entry)) === month && !happened(entry),
      )
    : [];
  const periodTotal = sum(periodEntries);

  // Days that could carry spending: skip the days before recording started.
  const firstCountedDay =
    trackingStart && trackingStart > periodStart ? trackingStart : periodStart;
  const countedDays = Math.max(
    1,
    daysBetween(firstCountedDay, referenceDay) + 1,
  );

  // Projection: current pace (without instalments) plus scheduled instalments.
  const instalmentsSoFar = sum(
    periodEntries.filter((entry) => Boolean(entry.installment_group_id)),
  );
  const dailyPace = periodTotal.minus(instalmentsSoFar).div(countedDays);
  const daysLeft = monthDays - dayOfMonth(referenceDay);
  const scheduledTotal = sum(scheduled);
  const projection = isCurrentMonth
    ? {
        total: periodTotal
          .plus(dailyPace.mul(daysLeft))
          .plus(scheduledTotal)
          .toNumber(),
        dailyPace: dailyPace.toNumber(),
        scheduled: scheduledTotal.toNumber(),
        daysLeft,
        // Under a week the average is unreliable; flag it.
        tentative: countedDays < 7,
      }
    : null;

  // Comparison only when the previous period was recorded from its first day
  // (month vs month, year vs year; history has none).
  const previousMonth = addMonths(month, -1);
  const previousYear = String(Number(year) - 1);
  const previousStart =
    kind === 'month' ? `${previousMonth}-01` : `${previousYear}-01-01`;
  const comparable =
    kind !== 'all' && Boolean(trackingStart) && trackingStart! <= previousStart;
  const comparableFrom = !trackingStart
    ? null
    : kind === 'month'
      ? addMonths(
          monthOf(trackingStart),
          dayOfMonth(trackingStart) === 1 ? 1 : 2,
        )
      : kind === 'year'
        ? String(
            Number(trackingStart.slice(0, 4)) +
              (trackingStart.slice(5) === '01-01' ? 1 : 2),
          )
        : null;
  const elapsed = dayOfMonth(referenceDay);
  const running = referenceDay === today;
  const previousPeriod = comparable
    ? expenses.filter((entry) => {
        const day = dayOf(entry);
        return kind === 'month'
          ? monthOf(day) === previousMonth &&
              // Finished month vs whole previous month; running one vs the same stretch.
              (!running || dayOfMonth(day) <= elapsed)
          : day.slice(0, 4) === previousYear &&
              (!running || day.slice(5) <= referenceDay.slice(5));
      })
    : [];
  const previousTotal = sum(previousPeriod);
  const comparison = comparable
    ? {
        available: true as const,
        previous: kind === 'month' ? previousMonth : previousYear,
        previousTotal: previousTotal.toNumber(),
        changePercent: previousTotal.isZero()
          ? null
          : periodTotal
              .minus(previousTotal)
              .div(previousTotal)
              .mul(100)
              .toNumber(),
      }
    : { available: false as const, from: comparableFrom };

  // Running total through the month.
  const byDay = (list: FinancialEntry[]) => {
    const totals = new Map<number, Decimal>();
    for (const entry of list) {
      const day = dayOfMonth(dayOf(entry));
      totals.set(day, (totals.get(day) ?? new Decimal(0)).plus(entry.amount));
    }
    return totals;
  };
  const spentByDay = byDay(periodEntries);
  const scheduledByDay = byDay(scheduled);
  const pacesPrevious = kind === 'month' && comparable;
  const previousByDay = byDay(
    pacesPrevious
      ? expenses.filter((entry) => monthOf(dayOf(entry)) === previousMonth)
      : [],
  );
  const previousDays = daysInMonth(previousMonth);
  let runningTotal = new Decimal(0);
  let previousRunning = new Decimal(0);
  let projected = periodTotal;
  // Daily running total for a month; year/history use `monthly`.
  const pace = Array.from(
    { length: kind === 'month' ? monthDays : 0 },
    (_, index) => {
      const day = index + 1;
      runningTotal = runningTotal.plus(spentByDay.get(day) ?? 0);
      if (day <= previousDays)
        previousRunning = previousRunning.plus(previousByDay.get(day) ?? 0);
      if (projection && day > elapsed)
        projected = projected
          .plus(dailyPace)
          .plus(scheduledByDay.get(day) ?? 0);
      return {
        day: pad(day),
        current: day <= elapsed ? runningTotal.toNumber() : null,
        // Starts on today's point so the dashed line continues the solid one.
        projected:
          projection && day >= elapsed
            ? (day === elapsed ? periodTotal : projected).toNumber()
            : null,
        previous: pacesPrevious ? previousRunning.toNumber() : null,
      };
    },
  );

  // Month by month.
  const firstMonth = trackingStart ? monthOf(trackingStart) : month;
  const monthly: {
    month: string;
    label: string;
    total: number;
    partial: 'start' | 'current' | null;
    projected: number | null;
  }[] = [];
  // Month: itself and five before; year: its months; history: all. Never
  // before the first record.
  const windowFirst =
    kind === 'month'
      ? addMonths(month, -5)
      : kind === 'year'
        ? `${year}-01`
        : firstMonth;
  const windowLast =
    kind === 'month'
      ? month
      : kind === 'year' && `${year}-12` < currentMonth
        ? `${year}-12`
        : currentMonth;
  for (
    let key = windowFirst < firstMonth ? firstMonth : windowFirst;
    key <= windowLast;
    key = addMonths(key, 1)
  ) {
    const total = sum(
      expenses.filter(
        (entry) => monthOf(dayOf(entry)) === key && happened(entry),
      ),
    ).toNumber();
    monthly.push({
      month: key,
      label: monthLabel(key),
      total,
      partial:
        key === currentMonth
          ? 'current'
          : key === firstMonth && trackingStart && dayOfMonth(trackingStart) > 1
            ? 'start'
            : null,
      projected: key === currentMonth && projection ? projection.total : null,
    });
  }

  // Where it went.
  const categories = grouped(
    periodEntries,
    (entry) => categoryName(entry.category),
    periodTotal,
  );
  // Categories ranked over the whole history: stable pie colours and order
  // across months, with neighbours on adjacent palette slots.
  const categoryRanking = grouped(
    expenses.filter(happened),
    (entry) => categoryName(entry.category),
    new Decimal(1),
  )
    .map((item) => item.name)
    .filter((name) => name !== 'Outros');
  const merchants = grouped(
    periodEntries,
    (entry) => entry.description,
    periodTotal,
  );
  const accounts = grouped(
    periodEntries,
    (entry) => entry.account,
    periodTotal,
  ).map((item) => ({
    ...item,
    method: resolvePaymentMethod(item.name, cards) as PaymentMethodId,
  }));

  // Benefit card and paid-by-others money didn't leave the owner's pocket.
  const benefit = sum(
    periodEntries.filter(
      (entry) => resolvePaymentMethod(entry.account, cards) === 'flash',
    ),
  );
  const otherPayer = sum(
    periodEntries.filter(
      (entry) => entry.account.trim() === OTHER_PAYER_ACCOUNT,
    ),
  );
  const payers = {
    own: periodTotal.minus(benefit).minus(otherPayer).toNumber(),
    benefit: benefit.toNumber(),
    otherPayer: otherPayer.toNumber(),
  };

  // Biggest swings vs the same stretch of last month, including drops to zero.
  const previousCategories = new Map(
    grouped(
      previousPeriod,
      (entry) => categoryName(entry.category),
      previousTotal,
    ).map((item) => [item.name, item.total]),
  );
  const categoryChanges = comparable
    ? [
        ...new Set([
          ...categories.map((item) => item.name),
          ...previousCategories.keys(),
        ]),
      ]
        .map((name) => {
          const total =
            categories.find((item) => item.name === name)?.total ?? 0;
          const previous = previousCategories.get(name) ?? 0;
          return { name, total, previous, delta: total - previous };
        })
        .filter((item) => item.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    : [];

  // Day of week: averaged per occurrence (not summed), never before the
  // first recorded day.
  const windowEnd = referenceDay;
  const lookBack = kind === 'month' ? addDays(windowEnd, -89) : periodStart;
  const windowStart =
    trackingStart && trackingStart > lookBack ? trackingStart : lookBack;
  const weekdayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const occurrences = Array(7).fill(0) as number[];
  let windowDays = 0;
  for (let day = windowStart; day <= windowEnd; day = addDays(day, 1)) {
    occurrences[new Date(`${day}T12:00:00Z`).getUTCDay()] += 1;
    windowDays += 1;
  }
  const weekdayTotals = Array.from({ length: 7 }, () => ({
    total: new Decimal(0),
    count: 0,
  }));
  for (const entry of expenses) {
    const day = dayOf(entry);
    if (day < windowStart || day > windowEnd || !happened(entry)) continue;
    const bucket = weekdayTotals[new Date(`${day}T12:00:00Z`).getUTCDay()];
    bucket.total = bucket.total.plus(entry.amount);
    bucket.count += 1;
  }
  // Monday first, the way a Brazilian week is read.
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((index) => ({
    day: weekdayNames[index],
    total: weekdayTotals[index].total.toNumber(),
    count: weekdayTotals[index].count,
    occurrences: occurrences[index],
    average: occurrences[index]
      ? weekdayTotals[index].total.div(occurrences[index]).toNumber()
      : 0,
  }));

  // Last two weeks.
  const fourteenBack = addDays(referenceDay, -13);
  const dailyStart =
    trackingStart && trackingStart > fourteenBack
      ? trackingStart
      : fourteenBack;
  const daily: { day: string; label: string; total: number }[] = [];
  for (let day = dailyStart; day <= referenceDay; day = addDays(day, 1))
    daily.push({
      day,
      label: `${day.slice(8)}/${day.slice(5, 7)}`,
      total: sum(
        expenses.filter((entry) => dayOf(entry) === day && happened(entry)),
      ).toNumber(),
    });

  // Upcoming instalments, always measured from today.
  const future = expenses.filter(
    (entry) => Boolean(entry.installment_group_id) && !happened(entry),
  );
  const lastFutureMonth = future.map(dayOf).map(monthOf).sort().at(-1);
  const instalmentMonths: { month: string; label: string; total: number }[] =
    [];
  if (lastFutureMonth)
    for (
      let key = currentMonth;
      key <= lastFutureMonth && instalmentMonths.length < 12;
      key = addMonths(key, 1)
    )
      instalmentMonths.push({
        month: key,
        label: monthLabel(key),
        total: sum(
          future.filter((entry) => monthOf(dayOf(entry)) === key),
        ).toNumber(),
      });

  const largest =
    [...periodEntries].sort((a, b) => new Decimal(b.amount).cmp(a.amount))[0] ??
    null;

  return {
    kind,
    /** The period's key: YYYY-MM, YYYY, or "all". */
    period: kind === 'month' ? month : kind === 'year' ? year : 'all',
    month,
    year,
    isCurrentMonth,
    referenceDay,
    trackingStart,
    total: periodTotal.toNumber(),
    // Per recorded day, not per calendar day.
    dailyAverage: periodTotal.div(countedDays).toNumber(),
    countedDays,
    count: periodEntries.length,
    average: periodEntries.length
      ? periodTotal.div(periodEntries.length).toNumber()
      : 0,
    largest: largest
      ? {
          description: largest.description,
          amount: new Decimal(largest.amount).toNumber(),
          day: dayOf(largest),
        }
      : null,
    projection,
    comparison,
    pace,
    monthly,
    categories,
    categoryRanking,
    categoryChanges,
    merchants,
    accounts,
    payers,
    weekdays,
    weekdayWindowDays: windowDays,
    daily,
    instalments: {
      months: instalmentMonths,
      total: sum(future).toNumber(),
    },
  };
}

export type FinancialVisualizations = ReturnType<
  typeof buildFinancialVisualizations
>;
