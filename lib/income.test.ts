import { describe, expect, it } from 'vitest';
import type { FinancialEntry } from './financial-tracker';
import { incomeIn, incomeMonths } from './income';

const income = (
  id: string,
  description: string,
  day: string,
  amount = 100,
  extra: Partial<FinancialEntry> = {},
) =>
  ({
    id,
    user_id: 'u',
    entry_type: 'income',
    amount,
    description,
    category: 'Salário',
    account: 'Renda',
    occurred_at: `${day}T15:00:00Z`,
    source: 'pluggy',
    external_id: id,
    created_at: '',
    updated_at: '',
    ...extra,
  }) as FinancialEntry;

describe('mês em que a renda conta', () => {
  it('dois salários no mês: o do começo volta para o mês anterior', () => {
    const entries = [
      income('ago', 'Salário', '2026-09-01', 1101.32),
      income('set', 'Salário', '2026-09-30', 1101.32),
      income('adiant', 'Adiantamento salarial', '2026-09-16', 920, {
        category: 'Adiantamento',
      }),
    ];
    const months = incomeMonths(entries);
    expect(months.get('ago')).toBe('2026-08');
    expect(months.get('set')).toBe('2026-09');
    expect(months.get('adiant')).toBe('2026-09');
    expect(incomeIn(entries, '2026-08').map((entry) => entry.id)).toEqual([
      'ago',
    ]);
  });

  it('um salário só no mês fica no mês, mesmo no dia 1º', () => {
    expect(incomeMonths([income('s', 'Salário', '2026-11-02')]).get('s')).toBe(
      '2026-11',
    );
  });

  it('fora das contas e estorno não entram; o depósito do Flash entra', () => {
    expect(
      incomeIn(
        [
          income('fora', 'Fulano', '2026-09-10', 50, {
            excluded_from_totals: true,
          }),
          income('estorno', 'Loja', '2026-09-10', 50, {
            category: 'Estorno',
            account: 'Nubank',
          }),
          income('flash', 'Depósito Flash · Alimentação', '2026-09-22', 960, {
            account: 'Flash',
            category: 'Alimentação',
          }),
        ],
        '2026-09',
      ).map((entry) => entry.id),
    ).toEqual(['flash']);
  });

  it('o salário é reconhecido pela categoria, com qualquer nome', () => {
    const months = incomeMonths([
      income('a', 'Pagamento ACME', '2026-09-01'),
      income('b', 'Salário', '2026-09-30'),
    ]);
    expect(months.get('a')).toBe('2026-08');
    expect(months.get('b')).toBe('2026-09');
  });
});
