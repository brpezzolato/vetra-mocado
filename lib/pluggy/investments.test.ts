import { describe, expect, it } from 'vitest';
import { piggySnapshotFromLots } from './investments';
import type { PluggyInvestmentLot } from './types';

// Lotes inventados no formato real da Pluggy (Nubank, 2026-09-30): cada
// depósito da caixinha é um CDB, e os resgatados ficam na lista zerados.
const lot = (
  extra: Partial<PluggyInvestmentLot> = {},
): PluggyInvestmentLot => ({
  id: 'lote',
  purchaseDate: '2026-09-01T00:00:00.000Z',
  type: 'FIXED_INCOME',
  status: 'ACTIVE',
  rateType: 'CDI',
  rate: 115,
  date: '2026-09-30T00:00:00.000Z',
  amount: 1000,
  balance: 1000,
  iof: 0,
  incomeTax: 0,
  ...extra,
});

describe('saldo do cofrinho a partir dos lotes da Pluggy', () => {
  it('soma bruto, líquido, IOF e IR dos lotes ativos', () => {
    expect(
      piggySnapshotFromLots([
        lot({ amount: 1416.6, balance: 1412.48, incomeTax: 3.63, iof: 0.49 }),
        lot({ amount: 704.52, balance: 701.76, incomeTax: 0.5, iof: 2.26 }),
      ]),
    ).toEqual({
      snapshotDate: '2026-09-30',
      gross: '2121.12',
      net: '2114.24',
      iof: '2.75',
      incomeTax: '4.13',
    });
  });

  it('ignora lote resgatado e investimento que não é renda fixa', () => {
    const snapshot = piggySnapshotFromLots([
      lot({ amount: 500, balance: 499, incomeTax: 1, iof: 0 }),
      lot({ status: 'TOTAL_WITHDRAWAL', amount: 0, balance: 0 }),
      lot({ type: 'EQUITY', amount: 9000, balance: 9000 }),
    ]);
    expect(snapshot?.gross).toBe('500.00');
    expect(snapshot?.net).toBe('499.00');
  });

  it('sem lote ativo não inventa um saldo zero', () => {
    expect(
      piggySnapshotFromLots([
        lot({ status: 'TOTAL_WITHDRAWAL', amount: 0, balance: 0 }),
      ]),
    ).toBeNull();
    expect(piggySnapshotFromLots([])).toBeNull();
  });

  it('recusa lotes de dias diferentes, que seriam uma atualização pela metade', () => {
    expect(
      piggySnapshotFromLots([lot(), lot({ date: '2026-09-29T00:00:00.000Z' })]),
    ).toBeNull();
  });

  it('recusa líquido maior que o bruto', () => {
    expect(
      piggySnapshotFromLots([lot({ amount: 100, balance: 101 })]),
    ).toBeNull();
  });

  it('guarda o saldo mas descarta a divisão de impostos que não fecha', () => {
    const snapshot = piggySnapshotFromLots([
      lot({ amount: 100, balance: 99, incomeTax: 0.5, iof: 0.2 }),
    ]);
    expect(snapshot).toMatchObject({
      gross: '100.00',
      net: '99.00',
      iof: null,
      incomeTax: null,
    });
  });

  it('sem imposto informado, não afirma que foi zero', () => {
    expect(
      piggySnapshotFromLots([lot({ amount: 100, balance: 100, iof: null })]),
    ).toMatchObject({ iof: null, incomeTax: null });
  });
});
