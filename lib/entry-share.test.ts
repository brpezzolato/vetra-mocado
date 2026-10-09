import { describe, expect, it } from 'vitest';
import {
  countedAmount,
  fullAmount,
  myShare,
  toTotalsView,
} from './entry-share';
import type { FinancialEntry } from './financial-tracker';

const entry = (extra: Partial<FinancialEntry> = {}): FinancialEntry => ({
  id: 'a',
  user_id: 'u',
  entry_type: 'expense',
  amount: '100.00',
  description: 'Jantar',
  category: 'Alimentação',
  account: 'Nubank',
  occurred_at: '2026-10-05T23:00:00Z',
  source: 'pluggy',
  external_id: null,
  created_at: '',
  updated_at: '',
  ...extra,
});

describe('compra dividida', () => {
  it('sem divisão, a parte dele é o valor inteiro', () => {
    expect(myShare(entry()).toFixed(2)).toBe('100.00');
    expect(toTotalsView(entry()).amount).toBe('100.00');
  });

  it('dividida: o gasto é a parte dele, o valor cheio continua guardado', () => {
    const view = toTotalsView(entry({ split_share: '33.34', split_people: 3 }));
    expect(view.amount).toBe('33.34');
    expect(view.full_amount).toBe('100.00');
    // Lida de novo, não divide duas vezes.
    expect(myShare(view).toFixed(2)).toBe('33.34');
    expect(fullAmount(view).toFixed(2)).toBe('100.00');
  });

  it('a parte nunca passa do valor (o banco mudou o valor depois)', () => {
    expect(myShare(entry({ amount: '40.00', split_share: '50.00' })).toFixed(2)).toBe(
      '40.00',
    );
  });

  it('fora das contas não pesa nada, dividida ou não', () => {
    expect(
      countedAmount(
        entry({ split_share: '50.00', excluded_from_totals: true }),
      ).toFixed(2),
    ).toBe('0.00');
  });
});
