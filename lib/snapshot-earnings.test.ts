import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { SnapshotRow, TransactionRow } from './domain';
import { snapshotEarnings } from './snapshot-earnings';

const snapshot = (
  snapshot_date: string,
  gross: string,
  net: string,
  extra: Partial<SnapshotRow> = {},
): SnapshotRow => ({
  id: snapshot_date,
  user_id: 'u',
  piggy_bank_id: 'b',
  snapshot_date,
  gross_balance: gross,
  net_balance: net,
  source: 'pluggy',
  created_at: snapshot_date,
  ...extra,
});

const movement = (
  kind: TransactionRow['kind'],
  amount: string,
  occurred_at: string,
): TransactionRow => ({
  id: occurred_at,
  user_id: 'u',
  piggy_bank_id: 'b',
  kind,
  amount,
  occurred_at,
  note: null,
  created_at: occurred_at,
  updated_at: occurred_at,
});

describe('rendimento = saldo do dia − saldo do dia anterior', () => {
  it('usa os números do banco, com a variação dos impostos', () => {
    const [earning] = snapshotEarnings(
      [
        snapshot('2026-09-29', '2119.88', '2112.99', {
          iof: '3.11',
          income_tax: '3.78',
        }),
        snapshot('2026-09-30', '2121.12', '2114.24', {
          iof: '2.75',
          income_tax: '4.13',
        }),
      ],
      [],
    );
    expect(earning.date).toBe('2026-09-30');
    expect(earning.netAmount.toFixed(2)).toBe('1.25');
    expect(earning.grossAmount?.toFixed(2)).toBe('1.24');
    expect(earning.taxes?.toFixed(2)).toBe('-0.01');
    expect(earning.iof?.toFixed(2)).toBe('-0.36');
    expect(earning.incomeTax?.toFixed(2)).toBe('0.35');
  });

  it('desconta aporte e retirada do intervalo', () => {
    const earnings = snapshotEarnings(
      [
        snapshot('2026-09-14', '1000', '1000'),
        snapshot('2026-09-15', '1221', '1221'),
        snapshot('2026-09-16', '1122.80', '1122.80'),
      ],
      [
        movement('deposit', '220', '2026-09-15T16:13:00Z'),
        movement('withdrawal', '98.40', '2026-09-16T13:00:00Z'),
      ],
    );
    expect(earnings.map((earning) => earning.netAmount.toFixed(2))).toEqual([
      '1.00',
      '0.20',
    ]);
  });

  it('o primeiro saldo não tem com o que comparar', () => {
    expect(snapshotEarnings([snapshot('2026-09-30', '10', '10')], [])).toEqual(
      [],
    );
  });

  it('sem divisão de impostos nos dois dias, não inventa IR nem IOF', () => {
    const [earning] = snapshotEarnings(
      [
        snapshot('2026-09-29', '10', '10'),
        snapshot('2026-09-30', '10.01', '10.01'),
      ],
      [],
    );
    expect(earning.iof).toBeUndefined();
    expect(earning.incomeTax).toBeUndefined();
  });
});

describe('intervalo de vários dias', () => {
  const rates = [
    { date: '2026-09-10', rate: '0.000551' },
    { date: '2026-09-11', rate: '0.000551' },
    { date: '2026-09-14', rate: '0.000551' },
  ];

  it('divide pelos dias úteis, fechando com o total do banco', () => {
    const earnings = snapshotEarnings(
      [
        snapshot('2026-09-10', '1840.25', '1840.25'),
        snapshot('2026-09-14', '1842.00', '1842.00'),
      ],
      [],
      rates,
    );
    expect(earnings.map((earning) => earning.date)).toEqual([
      '2026-09-11',
      '2026-09-14',
    ]);
    expect(earnings.every((earning) => earning.distributed)).toBe(true);
    expect(
      earnings
        .reduce((sum, earning) => sum.plus(earning.netAmount), new Decimal(0))
        .toFixed(2),
    ).toBe('1.75');
  });

  it('do primeiro aporte até a primeira conciliação também aparece', () => {
    const earnings = snapshotEarnings(
      [snapshot('2026-09-11', '1400.37', '1400.37')],
      [movement('deposit', '1400', '2026-09-10T15:00:00Z')],
      rates,
    );
    // O dia do aporte não rende: só 11/09.
    expect(
      earnings.map((earning) => [earning.date, earning.netAmount.toFixed(2)]),
    ).toEqual([['2026-09-11', '0.37']]);
  });
});
