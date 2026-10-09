import { describe, it, expect } from 'vitest';
import {
  duplicatePairs,
  invoiceFor,
  nextMonth,
  recurringCandidates,
  weeklySummary,
  saoDate,
} from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
const e = (
  id: string,
  date: string,
  amount = '10.00',
  extra: Partial<FinancialEntry> = {},
): FinancialEntry => ({
  id,
  user_id: 'u',
  entry_type: 'expense',
  amount,
  description: 'Loja',
  category: 'Outros',
  account: 'Nubank',
  occurred_at: date,
  created_at: date,
  updated_at: date,
  source: 'apple_shortcuts',
  external_id: null,
  ...extra,
});
describe('expense assistant', () => {
  it('uses Sao Paulo at UTC midnight', () =>
    expect(saoDate('2026-09-10T01:00:00Z')).toBe('2026-09-09'));
  it('clamps month ends and leap years', () => {
    expect(nextMonth('2026-01-31')).toBe('2026-02-28');
    expect(nextMonth('2028-01-31')).toBe('2028-02-29');
    expect(nextMonth('2026-12-31')).toBe('2027-01-31');
  });
  const cycle = {
    account: 'Nu',
    kind: 'credit' as const,
    closing_day: 5,
    due_day: 12,
  };
  it('uses next cycle on closing day', () => {
    expect(invoiceFor('2026-09-04', cycle)).toEqual({
      closing: '2026-09-05',
      due: '2026-09-12',
    });
    expect(invoiceFor('2026-09-05', cycle)).toEqual({
      closing: '2026-10-05',
      due: '2026-10-12',
    });
  });
  it('rolls due date past closing and year', () =>
    expect(
      invoiceFor('2026-12-20', { ...cycle, closing_day: 25, due_day: 3 }),
    ).toEqual({ closing: '2026-12-25', due: '2027-01-03' }));
  it('handles day 31 in February', () =>
    expect(
      invoiceFor('2026-02-27', { ...cycle, closing_day: 31, due_day: 10 }),
    ).toEqual({ closing: '2026-02-28', due: '2026-03-10' }));
  it('flags candidates without modifying or removing entries', () => {
    const entries = [
      e('b', '2026-09-09T10:05:00Z'),
      e('a', '2026-09-09T10:00:00Z', '10', { description: ' LOJA ' }),
    ];
    expect(duplicatePairs(entries).map((p) => p.key)).toEqual(['a:b']);
    expect(entries[0].id).toBe('b');
  });
  it('does not flag other accounts, merchants, amounts, income or outside window', () => {
    const first = e('a', '2026-09-09T10:00:00Z');
    for (const second of [
      e('b', '2026-09-09T10:05:01Z'),
      e('b', first.occurred_at, '10', { account: 'Itau' }),
      e('b', first.occurred_at, '11'),
      e('b', first.occurred_at, '10', { description: 'Outra' }),
      e('b', first.occurred_at, '10', { entry_type: 'income' }),
    ])
      expect(duplicatePairs([first, second])).toHaveLength(0);
  });
  it('requires three similar monthly payments', () => {
    const list = [
      e('1', '2026-06-05T12:00:00Z'),
      e('2', '2026-07-05T12:00:00Z'),
      e('3', '2026-08-05T12:00:00Z'),
    ];
    expect(recurringCandidates(list.slice(1))).toHaveLength(0);
    expect(recurringCandidates(list)[0].next_date).toBe('2026-09-05');
    expect(
      recurringCandidates([...list.slice(0, 2), { ...list[2], amount: '30' }]),
    ).toHaveLength(0);
  });
  it('keeps recurring accounts separate', () =>
    expect(
      recurringCandidates([
        e('1', '2026-06-05T12:00:00Z'),
        e('2', '2026-07-05T12:00:00Z'),
        e('3', '2026-08-05T12:00:00Z', '10', { account: 'Itau' }),
      ]),
    ).toHaveLength(0));
  it('does not mistake installments for recurring subscriptions', () => {
    const installment = { installment_group_id: 'group' };
    expect(
      recurringCandidates([
        e('1', '2026-06-05T12:00:00Z', '10', installment),
        e('2', '2026-07-05T12:00:00Z', '10', installment),
        e('3', '2026-08-05T12:00:00Z', '10', installment),
      ]),
    ).toHaveLength(0);
  });
  it('weekly totals exclude future and income and sum cents exactly', () => {
    // Quarta, 09/09/2026: a semana começou no domingo, 06/09.
    const s = weeklySummary(
      [
        e('1', '2026-09-07T12:00:00Z', '0.10'),
        e('2', '2026-09-09T12:00:00Z', '0.20'),
        e('3', '2026-09-02T12:00:00Z', '5'),
        e('4', '2026-09-10T12:00:00Z', '80'),
        e('5', '2026-09-08T12:00:00Z', '90', { entry_type: 'income' }),
      ],
      new Date('2026-09-09T20:00:00Z'),
    );
    expect(s.total).toBe('0.30');
    expect(s.previous).toBe('5.00');
    expect(s.count).toBe(2);
    expect(s.start).toBe('2026-09-06');
    expect(s.end).toBe('2026-09-09');
    // Um valor por dia, de domingo a sábado; o que ainda não chegou, nulo.
    expect(s.days.map((day) => day.total)).toEqual([
      '0.00',
      '0.10',
      '0.00',
      '0.20',
      null,
      null,
      null,
    ]);
  });
  it('parcelas ficam fora da comparação semanal', () => {
    const now = new Date('2026-09-29T20:00:00Z');
    const s = weeklySummary(
      [
        e('avista', '2026-09-28T15:00:00Z', '5'),
        e('parcela', '2026-09-28T15:00:00Z', '50', {
          installment_group_id: 'g',
          installment_number: 2,
          installment_total: 3,
        }),
        e('parcela-sem-grupo', '2026-09-22T15:00:00Z', '40', {
          installment_total: 2,
        }),
      ],
      now,
    );
    expect(s.total).toBe('5.00');
    expect(s.count).toBe(1);
    expect(s.previous).toBe('0.00');
  });
  it('a semana vai de domingo a sábado e compara até o mesmo dia da anterior', () => {
    const entries = [
      e('sab-anterior', '2026-09-26T15:00:00Z', '7'), // sábado 26/09
      e('dom-anterior', '2026-09-20T15:00:00Z', '3'), // domingo 20/09
      e('sab-retrasado', '2026-09-19T15:00:00Z', '100'), // fora das duas
      e('dom', '2026-09-27T15:00:00Z', '2'), // domingo 27/09
      e('seg', '2026-09-28T15:00:00Z', '4'), // segunda 28/09
    ];
    const monday = weeklySummary(entries, new Date('2026-09-28T20:00:00Z'));
    expect([monday.start, monday.end]).toEqual(['2026-09-27', '2026-09-28']);
    expect(monday.total).toBe('6.00');
    // A semana passada até o mesmo dia: domingo e segunda, 20 e 21/09. O
    // sábado 26/09 fica de fora — ainda não chegou o sábado desta semana.
    expect([monday.previousStart, monday.previousEnd]).toEqual([
      '2026-09-20',
      '2026-09-21',
    ]);
    expect(monday.previous).toBe('3.00');

    // No sábado a semana ainda é a mesma: começou no domingo.
    const saturday = weeklySummary(entries, new Date('2026-09-26T20:00:00Z'));
    expect([saturday.start, saturday.end]).toEqual([
      '2026-09-20',
      '2026-09-26',
    ]);
    expect(saturday.total).toBe('10.00');

    // No domingo a semana tem um dia só. 00h30 de domingo em São Paulo ainda
    // é sábado à noite em UTC, e conta como domingo.
    const sunday = weeklySummary(entries, new Date('2026-09-27T03:30:00Z'));
    expect([sunday.start, sunday.end]).toEqual(['2026-09-27', '2026-09-27']);
    expect([sunday.previousStart, sunday.previousEnd]).toEqual([
      '2026-09-20',
      '2026-09-20',
    ]);
    expect(sunday.previous).toBe('3.00');

    // No sábado as duas semanas estão completas: a comparação é a semana
    // passada inteira.
    expect([saturday.previousStart, saturday.previousEnd]).toEqual([
      '2026-09-13',
      '2026-09-19',
    ]);
  });
});
