import { describe, expect, it } from 'vitest';
import { bankPolicy, type BankName, type PiggyBank } from './domain';
import { calculate, parseDate } from './finance';

const rates = [
  '2026-08-28',
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
  '2026-09-08',
  '2026-09-09',
  '2026-09-10',
  '2026-09-11',
  '2026-09-14',
  '2026-09-15',
].map((date) => ({ date, rate: '0.051660' }));

const vault = (bankName: BankName): PiggyBank => {
  const policy = bankPolicy(bankName);
  return {
    id: 'vault',
    user_id: 'user',
    bank: bankName,
    name: bankName === 'Nubank' ? 'Minha Reserva' : 'Limite de Crédito',
    product: policy.product,
    cdi_percentage: policy.cdi,
    tax_rule: policy.taxRule,
    iof_rule: policy.iofRule,
    accrues_on_deposit_day: policy.accruesOnDepositDay,
    rate_limit: policy.limit,
    excess_rate: policy.excess,
    policy_version: policy.version,
    policy_started_at: null,
    policy_ends_at: null,
    archived_at: null,
    created_at: '2026-08-31T12:00:00Z',
    updated_at: '2026-09-16T12:00:00Z',
    transactions: [],
    snapshots: [],
    earningCredits: [],
  };
};

describe('conciliações reais mais recentes', () => {
  it('reproduz os saldos Nubank conciliados em 15 e 16 de setembro', () => {
    const subject = vault('Nubank');
    subject.transactions = [
      {
        id: 'initial',
        user_id: 'user',
        piggy_bank_id: 'vault',
        kind: 'deposit',
        amount: '1400',
        occurred_at: '2026-09-01T09:00:00-03:00',
        note: null,
        created_at: '2026-09-01T09:00:00-03:00',
        updated_at: '2026-09-01T09:00:00-03:00',
      },
      {
        id: 'september',
        user_id: 'user',
        piggy_bank_id: 'vault',
        kind: 'deposit',
        amount: '700',
        occurred_at: '2026-09-15T09:00:00-03:00',
        note: null,
        created_at: '2026-09-15T10:14:41-03:00',
        updated_at: '2026-09-15T10:14:41-03:00',
      },
    ];
    subject.snapshots = [
      ['2026-09-05', '1403.33', '1400.37'],
      ['2026-09-09', '1404.16', '1400.88'],
      ['2026-09-11', '1405.83', '1401.54'],
      ['2026-09-13', '1406.67', '1402.07'],
      ['2026-09-15', '2107.50', '2102.74'],
      ['2026-09-16', '2108.76', '2103.26'],
    ].map(([date, gross, net]) => ({
      id: date,
      user_id: 'user',
      piggy_bank_id: 'vault',
      snapshot_date: date,
      gross_balance: gross,
      net_balance: net,
      source: 'manual_statement',
      created_at: `${date}T10:15:00-03:00`,
    }));
    const result = calculate(subject, rates, parseDate('2026-09-16'), {
      now: parseDate('2026-09-16'),
    });
    const latest = result.earnings.find((entry) => entry.date === '2026-09-16');
    expect(result.grossBalance.toFixed(2)).toBe('2108.76');
    expect(result.netBalance.toFixed(2)).toBe('2103.26');
    expect(result.principal.toFixed(2)).toBe('2100.00');
    expect(result.lifetimeNetGain.toFixed(2)).toBe('3.26');
    expect(latest?.grossAmount?.toFixed(2)).toBe('1.26');
    expect(latest?.netAmount.toFixed(2)).toBe('0.52');
    expect(latest?.reconciled).toBe(true);
    expect(result.calibration.count).toBe(5);
    expect(result.calibration.status).toBe('collecting');
  });

  it('reproduz os saldos Mercado Pago conciliados em 14 e 16 de setembro', () => {
    const subject = vault('Mercado Pago');
    subject.transactions = [
      {
        id: 'initial',
        user_id: 'user',
        piggy_bank_id: 'vault',
        kind: 'deposit',
        amount: '1835',
        occurred_at: '2026-09-01T08:18:00-03:00',
        note: null,
        created_at: '2026-09-01T08:18:00-03:00',
        updated_at: '2026-09-01T08:18:00-03:00',
      },
    ];
    subject.snapshots = [
      ['2026-09-10', '1840.25', '1840.25'],
      ['2026-09-14', '1842.00', '1842.00'],
      ['2026-09-16', '1843.76', '1843.76'],
    ].map(([date, gross, net]) => ({
      id: date,
      user_id: 'user',
      piggy_bank_id: 'vault',
      snapshot_date: date,
      gross_balance: gross,
      net_balance: net,
      source: 'manual_statement',
      created_at: `${date}T10:15:00-03:00`,
    }));
    subject.earningCredits = [
      ['2026-09-02T04:42:00-03:00', '.87'],
      ['2026-09-03T04:45:00-03:00', '.87'],
      ['2026-09-04T04:00:00-03:00', '.88'],
      ['2026-09-08T04:24:00-03:00', '.88'],
      ['2026-09-09T05:23:00-03:00', '.87'],
      ['2026-09-10T04:41:00-03:00', '.88'],
    ].map(([occurredAt, amount], index) => ({
      id: `credit-${index}`,
      user_id: 'user',
      piggy_bank_id: 'vault',
      occurred_at: occurredAt,
      net_amount: amount,
      source: 'Extrato Mercado Pago',
      created_at: '2026-09-10T14:07:37-03:00',
    }));
    const result = calculate(subject, rates, parseDate('2026-09-16'), {
      now: parseDate('2026-09-16'),
    });
    const latest = result.earnings.find((entry) => entry.date === '2026-09-16');
    expect(result.grossBalance.toFixed(2)).toBe('1843.76');
    expect(result.netBalance.toFixed(2)).toBe('1843.76');
    expect(result.principal.toFixed(2)).toBe('1835.00');
    expect(result.lifetimeNetGain.toFixed(2)).toBe('8.76');
    expect(result.confirmedCreditCount).toBe(6);
    expect(latest?.netAmount.toFixed(2)).toBe('0.88');
    expect(latest?.reconciled).toBe(true);
    expect(result.calibration.count).toBe(3);
    expect(result.calibration.status).toBe('collecting');

    const suspicious = calculate(
      {
        ...subject,
        snapshots: [
          ...subject.snapshots,
          {
            ...subject.snapshots.at(-1)!,
            id: 'missing-cash-movement',
            snapshot_date: '2026-09-17',
            gross_balance: '1944.64',
            net_balance: '1944.64',
          },
        ],
      },
      [...rates, { date: '2026-09-16', rate: '0.051660' }],
      parseDate('2026-09-17'),
      { now: parseDate('2026-09-17') },
    );
    expect(suspicious.calibration.count).toBe(3);
  });
});
