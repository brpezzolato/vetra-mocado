import { describe, expect, it } from 'vitest';
import { summarizeFinances } from './finance-overview';
import type { FinancialEntry } from './financial-tracker';
const entry = (
  id: string,
  type: 'income' | 'expense',
  amount: string,
  occurred_at: string,
  category = 'Outros',
): FinancialEntry => ({
  id,
  entry_type: type,
  amount,
  occurred_at,
  category,
  user_id: 'user',
  description: id,
  account: 'Cartão',
  source: 'manual',
  external_id: null,
  created_at: occurred_at,
  updated_at: occurred_at,
});
describe('overview financial summary', () => {
  it('excludes receipts and future expenses using exact cents and São Paulo dates', () => {
    const result = summarizeFinances(
      [
        entry('income', 'income', '100.10', '2026-09-01T12:00:00Z'),
        entry('expense', 'expense', '0.20', '2026-09-02T12:00:00Z'),
        entry('previous-month', 'expense', '90', '2026-09-01T02:59:00Z'),
        entry('future', 'income', '999', '2026-09-10T12:00:00Z'),
        entry('future-expense', 'expense', '999', '2026-09-10T12:00:00Z'),
      ],
      new Date('2026-09-09T12:00:00Z'),
    );
    expect(result.expenses.toFixed(2)).toBe('0.20');
    expect(result.count).toBe(1);
    expect(result.recent.every((e) => e.entry_type === 'expense')).toBe(true);
    expect(result.recent.map((e) => e.id)).not.toContain('future-expense');
    expect(result.recent.map((e) => e.id)).not.toContain('future');
  });
  it('groups categories and handles an empty account', () => {
    const result = summarizeFinances(
      [
        entry('a', 'expense', '10.15', '2026-09-02T12:00:00Z', 'Alimentação'),
        entry('b', 'expense', '5.10', '2026-09-03T12:00:00Z', 'Alimentação'),
        entry('c', 'expense', '2', '2026-09-04T12:00:00Z', 'Transporte'),
      ],
      new Date('2026-09-09T12:00:00Z'),
    );
    expect(result.categories[0].value.toFixed(2)).toBe('15.25');
    expect(result.expenses.toFixed(2)).toBe('17.25');
    expect(summarizeFinances([]).expenses.toFixed(2)).toBe('0.00');
  });
});
