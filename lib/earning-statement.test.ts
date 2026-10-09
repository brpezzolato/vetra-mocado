import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { mergeEarningStatement } from './earning-statement';
import type { BankEarningCredit } from './domain';

const credit = (id: string, occurred_at: string): BankEarningCredit => ({
  id,
  occurred_at,
  user_id: 'user',
  piggy_bank_id: 'mp',
  net_amount: '0.87',
  source: 'Extrato',
  created_at: occurred_at,
});
const estimate = (date: string) => ({
  date,
  grossAmount: new Decimal('1.12'),
  netAmount: new Decimal('0.86'),
  taxes: new Decimal('0.26'),
});

describe('bank-confirmed earning statement', () => {
  it('keeps the engine ledger consistent and attaches the MP screenshot as a comparison', () => {
    const entries = mergeEarningStatement(
      [estimate('2026-09-02'), estimate('2026-09-03'), estimate('2026-09-04')],
      [
        credit('a', '2026-09-02T07:42:00Z'),
        credit('b', '2026-09-03T07:45:00Z'),
      ],
    );
    expect(entries).toHaveLength(3);
    const referenced = entries.filter(
      (entry) => entry.referenceNetAmount !== undefined,
    );
    expect(
      referenced
        .reduce(
          (sum, entry) => sum.plus(entry.referenceNetAmount!),
          new Decimal(0),
        )
        .toFixed(2),
    ).toBe('1.74');
    expect(
      referenced.every(
        (entry) => entry.netAmount.eq('0.86') && entry.grossAmount?.eq('1.12'),
      ),
    ).toBe(true);
    expect(entries.filter((entry) => entry.confirmed)).toHaveLength(0);
  });
  it('uses São Paulo credit day and retains multiple credits on the same day', () => {
    const entries = mergeEarningStatement(
      [estimate('2026-09-02')],
      [
        credit('a', '2026-09-03T01:00:00Z'),
        credit('b', '2026-09-03T02:00:00Z'),
      ],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe('2026-09-02');
    expect(entries[0].referenceCredits).toHaveLength(2);
    expect(entries[0].referenceNetAmount?.toFixed(2)).toBe('1.74');
  });
  it('retains unmatched credits without inventing gross and taxes', () => {
    const [entry] = mergeEarningStatement(
      [],
      [credit('a', '2026-09-02T07:42:00Z')],
    );
    expect(entry.confirmed).toBe(true);
    expect(entry.grossAmount).toBeNull();
    expect(entry.taxes).toBeNull();
    expect(entry.netAmount.toFixed(2)).toBe('0.87');
  });
  it('preserves estimates for banks and cached payloads without confirmed records', () => {
    expect(
      mergeEarningStatement([estimate('2026-09-02')])[0].netAmount.toFixed(2),
    ).toBe('0.86');
  });
});
