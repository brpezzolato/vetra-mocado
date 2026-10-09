import { describe, expect, it } from 'vitest';
import type { FinancialEntry } from './financial-tracker';
import { monthlyRecap, recapDefaultMonth, recapIsFresh } from './monthly-recap';

const e = (
  id: string,
  day: string,
  amount: string,
  extra: Partial<FinancialEntry> = {},
): FinancialEntry => ({
  id,
  user_id: 'u',
  entry_type: 'expense',
  amount,
  description: 'Loja',
  category: 'Outros',
  account: 'Nubank',
  occurred_at: `${day}T15:00:00Z`,
  source: 'manual',
  external_id: null,
  created_at: '',
  updated_at: '',
  ...extra,
});

const end = new Date('2026-10-01T12:00:00Z');

describe('monthlyRecap', () => {
  it('acha a maior compra, contando a parcelada pelo total', () => {
    const recap = monthlyRecap(
      [
        e('a', '2026-09-03', '300', { description: 'Mercado' }),
        e('b', '2026-09-10', '100', {
          description: 'Tênis',
          installment_group_id: 'g',
          installment_number: 1,
          installment_total: 5,
          installment_purchase_total: '500',
        }),
        e('c', '2026-09-12', '900', {
          description: 'Notebook',
          installment_group_id: 'h',
          installment_number: 4,
          installment_total: 10,
        }),
      ],
      '2026-09',
      end,
    );
    expect(recap.biggestPurchase).toMatchObject({
      description: 'Tênis',
      amount: '500.00',
      installments: 5,
    });
  });

  it('compara categorias com o mês anterior', () => {
    const recap = monthlyRecap(
      [
        e('a1', '2026-08-05', '100', { category: 'Delivery' }),
        e('a2', '2026-08-06', '200', { category: 'Mercado' }),
        e('b1', '2026-09-05', '250', { category: 'Delivery' }),
        e('b2', '2026-09-06', '210', { category: 'Mercado' }),
        e('b3', '2026-09-07', '50', { category: 'Lazer' }),
      ],
      '2026-09',
      end,
    );
    expect(recap.risingCategory).toEqual({
      name: 'Delivery',
      total: '250.00',
      previous: '100.00',
      delta: '150.00',
    });
    expect(recap.topCategory?.name).toBe('Delivery');
    expect(recap.previous?.spent).toBe('300.00');
  });

  it('conta a maior sequência sem gastos, ignorando parcelas antigas', () => {
    const recap = monthlyRecap(
      [
        e('a', '2026-09-01', '10'),
        e('parcela', '2026-09-05', '80', {
          installment_group_id: 'g',
          installment_number: 3,
          installment_total: 6,
        }),
        e('b', '2026-09-10', '10'),
        e('c', '2026-09-30', '10'),
      ],
      '2026-09',
      end,
    );
    expect(recap.noSpendStreak).toEqual({
      days: 19,
      start: '2026-09-11',
      end: '2026-09-29',
    });
    expect(recap.noSpendDays).toBe(27);
  });

  it('no mês corrente conta os dias só até ontem', () => {
    const recap = monthlyRecap(
      [e('a', '2026-09-01', '10')],
      '2026-09',
      new Date('2026-09-05T15:00:00Z'),
    );
    expect(recap.partial).toBe(true);
    expect(recap.noSpendDays).toBe(3);
  });

  it('a loja favorita é a de mais idas', () => {
    const recap = monthlyRecap(
      [
        e('a', '2026-09-01', '500', { description: 'Loja grande' }),
        e('b', '2026-09-02', '20', { description: 'Padaria' }),
        e('c', '2026-09-03', '15', { description: 'Padaria' }),
      ],
      '2026-09',
      end,
    );
    expect(recap.favoritePlace).toEqual({
      name: 'Padaria',
      count: 2,
      total: '35.00',
    });
  });

  it('abre no mês anterior e é novidade até o dia 3', () => {
    expect(recapDefaultMonth(new Date('2026-10-01T03:30:00Z'))).toBe('2026-09');
    // 03h30 UTC é 00h30 de 1º/10 em São Paulo: setembro já fechou.
    expect(recapIsFresh(new Date('2026-10-03T20:00:00Z'))).toBe(true);
    expect(recapIsFresh(new Date('2026-10-04T12:00:00Z'))).toBe(false);
  });
});
