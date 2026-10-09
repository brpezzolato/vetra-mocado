import Decimal from 'decimal.js';
import type { FinancialEntry } from './financial-tracker';

export type CardCycle = {
  account: string;
  kind: 'credit' | 'benefit' | 'debit';
  closing_day: number;
  due_day: number;
  closing_offset_days?: number | null;
  /** O banco empurra vencimento de fim de semana/feriado (lib/card-due-dates.ts). */
  due_rolls_forward?: boolean | null;
};
export type RecurringExpense = {
  id: string;
  merchant: string;
  account: string;
  amount: string | number;
  next_date: string;
  billing_day: number;
  active: boolean;
  paid_by_me?: boolean;
  frequency?: 'monthly' | 'yearly';
  category?: string;
  notes?: string | null;
  updated_at?: string;
};
export const merchantKey = (s: string) => s.trim().toLowerCase();
export const saoDate = (d: string | Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(d));
const calendarDate = (y: number, m: number, day: number) => {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)))
    .toISOString()
    .slice(0, 10);
};
export function nextMonth(date: string, preferredDay?: number) {
  const [y, m, d] = date.split('-').map(Number);
  return calendarDate(y, m, preferredDay ?? d);
}
// Purchases on the closing date belong to the following cycle (conservative estimate).
export function invoiceFor(date: string, cycle: CardCycle) {
  const [y, m] = date.split('-').map(Number);
  if (cycle.closing_offset_days != null) {
    for (let month = m - 1; month <= m + 2; month++) {
      const due = calendarDate(y, month, cycle.due_day);
      const close = new Date(`${due}T12:00:00Z`);
      close.setUTCDate(close.getUTCDate() - cycle.closing_offset_days);
      const closing = close.toISOString().slice(0, 10);
      if (date < closing) return { closing, due };
    }
    throw new Error('Ciclo inválido');
  }
  let closing = calendarDate(y, m - 1, cycle.closing_day);
  if (date >= closing) closing = calendarDate(y, m, cycle.closing_day);
  const [cy, cm] = closing.split('-').map(Number);
  let due = calendarDate(cy, cm - 1, cycle.due_day);
  if (due <= closing) due = calendarDate(cy, cm, cycle.due_day);
  return { closing, due };
}
export function duplicatePairs(entries: FinancialEntry[]) {
  const sorted = entries
    .filter((e) => e.entry_type === 'expense')
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const result: { key: string; a: FinancialEntry; b: FinancialEntry }[] = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i],
        b = sorted[j];
      if (Date.parse(b.occurred_at) - Date.parse(a.occurred_at) > 300000) break;
      if (
        a.account === b.account &&
        merchantKey(a.description) === merchantKey(b.description) &&
        new Decimal(a.amount).eq(b.amount)
      )
        result.push({ key: [a.id, b.id].sort().join(':'), a, b });
    }
  return result;
}
export function recurringCandidates(entries: FinancialEntry[]) {
  const groups = new Map<string, FinancialEntry[]>();
  for (const e of entries.filter(
    (e) => e.entry_type === 'expense' && !e.installment_group_id,
  )) {
    const key = JSON.stringify([merchantKey(e.description), e.account]);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()].flatMap((group) => {
    group.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
    if (group.length < 3) return [];
    const recent = group.slice(-3),
      amounts = recent.map((e) => new Decimal(e.amount));
    const gaps = recent
      .slice(1)
      .map(
        (e, i) =>
          (Date.parse(e.occurred_at) - Date.parse(recent[i].occurred_at)) /
          86400000,
      );
    if (
      gaps.some((d) => d < 25 || d > 35) ||
      amounts.some((v) => v.minus(amounts[0]).abs().div(amounts[0]).gt(0.1))
    )
      return [];
    const last = recent[2];
    return [
      {
        merchant: merchantKey(last.description),
        account: last.account,
        amount: last.amount,
        next_date: nextMonth(saoDate(last.occurred_at)),
        billing_day: Number(saoDate(last.occurred_at).slice(-2)),
      },
    ];
  });
}
export const isInstallment = (e: FinancialEntry) =>
  Boolean(e.installment_group_id) || (e.installment_total ?? 0) > 1;
/**
 * Semana de domingo a sábado em São Paulo, comparada com a anterior até o
 * mesmo dia da semana. Parcelas ficam de fora.
 */
export function weeklySummary(entries: FinancialEntry[], now = new Date()) {
  const day = 86400000;
  const today = saoDate(now),
    end = Date.parse(`${today}T00:00:00Z`) + day;
  // Domingo a sábado, como o calendário. getUTCDay: domingo 0.
  const sinceSunday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = end - day - sinceSunday * day,
    previous = start - 7 * day;
  const eligible = entries.filter(
    (e) =>
      e.entry_type === 'expense' &&
      !isInstallment(e) &&
      Date.parse(e.occurred_at) <= now.getTime(),
  );
  const current = eligible.filter((e) => {
    const day = Date.parse(`${saoDate(e.occurred_at)}T00:00:00Z`);
    return day >= start && day < end;
  });
  const previousEnd = end - 7 * day;
  const prior = eligible.filter((e) => {
    const at = Date.parse(`${saoDate(e.occurred_at)}T00:00:00Z`);
    return at >= previous && at < previousEnd;
  });
  const sum = (list: FinancialEntry[]) =>
    list.reduce((s, e) => s.plus(e.amount), new Decimal(0)).toFixed(2);
  const categories = new Map<string, Decimal>();
  current.forEach((e) =>
    categories.set(
      e.category,
      (categories.get(e.category) ?? new Decimal(0)).plus(e.amount),
    ),
  );
  const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
  // Gasto de cada dia da semana; os futuros ficam sem valor.
  const perDay = new Map<string, Decimal>();
  for (const e of current) {
    const key = saoDate(e.occurred_at);
    perDay.set(key, (perDay.get(key) ?? new Decimal(0)).plus(e.amount));
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const key = iso(start + index * day);
    return {
      day: key,
      total:
        key > today ? null : (perDay.get(key) ?? new Decimal(0)).toFixed(2),
    };
  });
  return {
    days,
    total: sum(current),
    previous: sum(prior),
    count: current.length,
    start: iso(start),
    end: today,
    previousStart: iso(previous),
    previousEnd: iso(previousEnd - day),
    categories: [...categories]
      .sort((a, b) => b[1].comparedTo(a[1]))
      .map(([name, value]) => ({ name, total: value.toFixed(2) })),
  };
}
