import { describe, it, expect } from 'vitest';
import { invoiceFor } from './expense-insights';
import { BILLING_RULES } from './card-billing';
const cycle = {
  account: 'Nu',
  kind: 'credit' as const,
  due_day: 5,
  closing_day: 1,
  closing_offset_days: 7,
};
describe('bank billing dates', () => {
  it('uses calendar subtraction across months', () =>
    expect(invoiceFor('2026-01-25', cycle)).toEqual({
      closing: '2026-01-29',
      due: '2026-02-05',
    }));
  it('moves closing-day purchases to the next cycle', () =>
    expect(invoiceFor('2026-01-29', cycle)).toEqual({
      closing: '2026-02-26',
      due: '2026-03-05',
    }));
  it('supports leap years', () =>
    expect(invoiceFor('2028-02-20', cycle)).toEqual({
      closing: '2028-02-27',
      due: '2028-03-05',
    }));
  it('handles year rollover', () =>
    expect(invoiceFor('2026-12-30', cycle)).toEqual({
      closing: '2027-01-29',
      due: '2027-02-05',
    }));
  it('clamps due dates before subtracting', () =>
    expect(invoiceFor('2026-02-01', { ...cycle, due_day: 31 })).toEqual({
      closing: '2026-02-21',
      due: '2026-02-28',
    }));
  it('does not invent a bill for Flash benefits', () =>
    expect(BILLING_RULES.flash.days).toBeNull());
  it('restricts PicPay to the official due date choices', () =>
    expect(BILLING_RULES.picpay.dueDays).toEqual([5, 10, 15, 20, 25]));
  it('distinguishes exact and estimated closing rules', () => {
    expect(BILLING_RULES.nubank.accuracy).toBe('exact');
    expect(BILLING_RULES.picpay.accuracy).toBe('estimate');
    expect(BILLING_RULES.itau.accuracy).toBe('estimate');
  });
});
