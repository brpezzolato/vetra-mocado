import { describe, expect, it } from 'vitest';
import {
  blendedPercentage,
  businessDaysBetween,
  compareInstallmentsWithCash,
  netYield,
  type VaultRate,
} from './installment-vs-cash';
import { splitInstallments } from './purchase-simulator';

const mercadoPago: VaultRate = {
  cdiPercentage: 119.03,
  excessRate: 100,
  rateLimit: 10000,
  alreadyInVault: 1850,
  iofRegressive: false,
  taxExempt: false,
};
const nubank: VaultRate = {
  cdiPercentage: 115,
  excessRate: 100,
  rateLimit: 5000,
  alreadyInVault: 2100,
  iofRegressive: true,
  taxExempt: false,
};
const CDI = '0.050788';

const plan = (total: string, count: number, firstDue: string) =>
  splitInstallments(total, count).map((amount, index) => {
    const date = new Date(`${firstDue}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + index);
    return { amount, due: date.toISOString().slice(0, 10) };
  });

describe('parcelar ou pagar à vista', () => {
  it('conta só os dias úteis até a véspera do vencimento', () => {
    // 29/09 (ter) a 06/10 (ter): 29, 30, 01, 02, 05 — o dia 06 já é o
    // pagamento.
    expect(businessDaysBetween('2026-09-29', '2026-10-06')).toBe(5);
  });

  it('a parte além do limite promocional rende a taxa de excesso', () => {
    // 2.900 cabem no limite de 5.000 com 2.100 já dentro; 100 ficam de fora.
    expect(
      blendedPercentage(3000, nubank).toDecimalPlaces(4).toNumber(),
    ).toBeCloseTo((2900 * 115 + 100 * 100) / 3000, 4);
  });

  it('parcelar rende mais que 1x, porque o dinheiro fica mais tempo', () => {
    const result = compareInstallmentsWithCash({
      installments: plan('3000.00', 10, '2026-11-06'),
      singleDue: '2026-11-06',
      today: '2026-09-29',
      dailyCdi: CDI,
      vault: mercadoPago,
    });
    expect(Number(result.installmentYield)).toBeGreaterThan(
      Number(result.singleYield),
    );
    expect(result.best).toBe('installments');
    // Sem desconto no Pix, pagar hoje é o pior: o dinheiro não rende nada.
    expect(result.costs.cash).toBe('3000.00');
  });

  it('um bom desconto no Pix ganha do parcelamento', () => {
    const result = compareInstallmentsWithCash({
      installments: plan('3000.00', 10, '2026-11-06'),
      singleDue: '2026-11-06',
      today: '2026-09-29',
      dailyCdi: CDI,
      vault: mercadoPago,
      cashDiscountPercent: 8,
    });
    expect(result.best).toBe('cash');
    expect(result.cashDiscount).toBe('240.00');
  });

  it('o IOF do Nubank come o rendimento de quem sai antes de 30 dias', () => {
    const soon = [{ due: '2026-10-06', amount: '1000.00' }];
    const withIof = netYield({
      tranches: soon,
      today: '2026-09-29',
      dailyCdi: CDI,
      vault: nubank,
    });
    const withoutIof = netYield({
      tranches: soon,
      today: '2026-09-29',
      dailyCdi: CDI,
      vault: { ...nubank, iofRegressive: false },
    });
    // 7 dias: IOF de 80% do rendimento.
    expect(withIof.toNumber()).toBeLessThan(withoutIof.toNumber() * 0.25);
    expect(
      compareInstallmentsWithCash({
        installments: soon,
        singleDue: '2026-10-06',
        today: '2026-09-29',
        dailyCdi: CDI,
        vault: nubank,
      }).iofBites,
    ).toBe(true);
  });
});
