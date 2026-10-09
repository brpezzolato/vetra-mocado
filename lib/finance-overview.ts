import Decimal from 'decimal.js';
import type { FinancialEntry } from './financial-tracker';
import { incomeIn } from './income';

const month = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
export function summarizeFinances(entries: FinancialEntry[], now = new Date()) {
  const selected = entries.filter(
    (entry) =>
      entry.entry_type === 'expense' &&
      month(new Date(entry.occurred_at)) === month(now) &&
      new Date(entry.occurred_at) <= now,
  );
  const expenses = selected
    .filter((e) => e.entry_type === 'expense')
    .reduce((sum, e) => sum.plus(e.amount), new Decimal(0));
  const categories = new Map<string, Decimal>();
  for (const entry of selected.filter((e) => e.entry_type === 'expense'))
    categories.set(
      entry.category,
      (categories.get(entry.category) ?? new Decimal(0)).plus(entry.amount),
    );
  // O que entrou no mês: só a renda de verdade, e o salário que escorregou
  // para o dia 1º conta no mês anterior (lib/income.ts).
  const income = incomeIn(
    entries.filter((entry) => new Date(entry.occurred_at) <= now),
    month(now),
  ).reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
  return {
    expenses,
    income,
    count: selected.length,
    categories: [...categories]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value.comparedTo(a.value)),
    recent: entries
      .filter(
        (e) => e.entry_type === 'expense' && new Date(e.occurred_at) <= now,
      )
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 5),
  };
}
