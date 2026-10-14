import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { SnapshotRow, TransactionRow } from './domain';
import { learnForecast } from './forecast-learning';

const snap = (date: string, gross: string): SnapshotRow =>
  ({ id: date, snapshot_date: date, gross_balance: gross }) as SnapshotRow;
const audit = (date: string, gross: string, diff: string) => ({
  snapshot: snap(date, gross),
  grossDifference: new Decimal(diff),
});

describe('learnForecast', () => {
  it('aprende que o banco paga menos que o motor previa', () => {
    // O banco paga 1,00 por dia; o motor previa 1,02 (2% a mais).
    const snapshots = [
      snap('2026-09-24', '100'),
      snap('2026-09-25', '101'),
      snap('2026-09-28', '102'),
      snap('2026-09-29', '103'),
      snap('2026-09-30', '104'),
    ];
    const audits = snapshots
      .slice(1)
      .map((s) => audit(s.snapshot_date, String(s.gross_balance), '0.02'));
    const learned = learnForecast(audits, snapshots, []);
    expect(learned.samples).toBe(4);
    expect(learned.factor.toFixed(4)).toBe('0.9804');
    expect(learned.errorBefore!.toFixed(2)).toBe('0.02');
    expect(learned.errorAfter!.toFixed(2)).toBe('0.00');
    expect(learned.accuracy!.toFixed(3)).toBe('1.000');
  });

  it('desconta aporte e não aprende com poucos saldos', () => {
    const snapshots = [snap('2026-09-29', '100'), snap('2026-09-30', '151')];
    const deposit = {
      kind: 'deposit',
      amount: '50',
      occurred_at: '2026-09-30T12:00:00Z',
    } as TransactionRow;
    const learned = learnForecast(
      [audit('2026-09-30', '151', '0')],
      snapshots,
      [deposit],
    );
    expect(learned.samples).toBe(1);
    expect(learned.factor.toString()).toBe('1');
  });

  it('ignora um fator absurdo', () => {
    const snapshots = [
      snap('2026-09-25', '100'),
      snap('2026-09-28', '101'),
      snap('2026-09-29', '102'),
      snap('2026-09-30', '103'),
    ];
    const audits = snapshots
      .slice(1)
      .map((s) => audit(s.snapshot_date, String(s.gross_balance), '1'));
    expect(learnForecast(audits, snapshots, []).factor.toString()).toBe('1');
  });
});
