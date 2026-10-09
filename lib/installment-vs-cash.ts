import Decimal from 'decimal.js';
import { isFinancialBusinessDay } from './business-calendar';
import { IOF_RATES, irRate } from './finance';

/**
 * Parcelar sem juros ou pagar à vista?
 * Parcelado: cada parcela sai do cofrinho só no vencimento. À vista no cartão:
 * rende até a primeira fatura. Pix: desconto, mas sai hoje.
 * Estimativa com o CDI mais recente, a taxa do cofrinho, IR regressivo e, no
 * Nubank, IOF regressivo (come o rendimento de parcela com menos de 30 dias).
 */

export type VaultRate = {
  /** % do CDI dentro do limite promocional. */
  cdiPercentage: number;
  /** % do CDI acima do limite. */
  excessRate: number;
  /** Limite promocional em reais; `null` quando não há. */
  rateLimit: number | null;
  /** Quanto já está no cofrinho, que ocupa o limite antes da compra. */
  alreadyInVault: number;
  /** IOF regressivo nos primeiros 30 dias (Nubank) ou isento (Mercado Pago). */
  iofRegressive: boolean;
  taxExempt: boolean;
};

export type Tranche = { due: string; amount: Decimal.Value };

const DAY = 86400000;
const daysApart = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY,
  );

/** Dias úteis de rendimento: de hoje até a véspera do vencimento. */
export function businessDaysBetween(from: string, to: string) {
  let count = 0;
  for (
    let date = new Date(`${from}T12:00:00Z`);
    date < new Date(`${to}T12:00:00Z`);
    date = new Date(date.getTime() + DAY)
  )
    if (isFinancialBusinessDay(date)) count += 1;
  return count;
}

/** % do CDI da compra inteira: taxa cheia dentro do limite, excesso fora. */
export function blendedPercentage(total: Decimal.Value, vault: VaultRate) {
  const amount = new Decimal(total);
  if (amount.lte(0)) return new Decimal(vault.cdiPercentage);
  if (vault.rateLimit === null) return new Decimal(vault.cdiPercentage);
  const room = Decimal.max(
    0,
    new Decimal(vault.rateLimit).minus(vault.alreadyInVault),
  );
  const bonus = Decimal.min(amount, room);
  return bonus
    .mul(vault.cdiPercentage)
    .plus(amount.minus(bonus).mul(vault.excessRate))
    .div(amount);
}

/** Rendimento líquido de deixar cada parcela no cofrinho até o vencimento. */
export function netYield({
  tranches,
  today,
  dailyCdi,
  vault,
}: {
  tranches: Tranche[];
  today: string;
  /** CDI de um dia útil, em % (como a série SGS 12 do Banco Central). */
  dailyCdi: Decimal.Value;
  vault: VaultRate;
}) {
  const total = tranches.reduce(
    (sum, tranche) => sum.plus(tranche.amount),
    new Decimal(0),
  );
  const daily = new Decimal(dailyCdi)
    .div(100)
    .mul(blendedPercentage(total, vault))
    .div(100);
  return tranches.reduce((sum, tranche) => {
    if (tranche.due <= today) return sum;
    const gross = new Decimal(tranche.amount).mul(
      daily.plus(1).pow(businessDaysBetween(today, tranche.due)).minus(1),
    );
    const age = daysApart(today, tranche.due);
    const iof =
      vault.iofRegressive && age < 30
        ? gross.mul(IOF_RATES[Math.max(0, age)] ?? 0)
        : new Decimal(0);
    const incomeTax = vault.taxExempt
      ? new Decimal(0)
      : gross.minus(iof).mul(irRate(age));
    return sum.plus(gross.minus(iof).minus(incomeTax));
  }, new Decimal(0));
}

export type PaymentOption = 'installments' | 'single' | 'cash';

export function compareInstallmentsWithCash({
  installments,
  singleDue,
  today,
  dailyCdi,
  vault,
  cashDiscountPercent = 0,
}: {
  /** As parcelas, com o vencimento da fatura de cada uma. */
  installments: Tranche[];
  /** Vencimento da fatura se a compra for em 1x no cartão. */
  singleDue: string;
  today: string;
  dailyCdi: Decimal.Value;
  vault: VaultRate;
  /** Desconto para pagar à vista no Pix, em %. */
  cashDiscountPercent?: Decimal.Value;
}) {
  const total = installments.reduce(
    (sum, tranche) => sum.plus(tranche.amount),
    new Decimal(0),
  );
  const installmentYield = netYield({
    tranches: installments,
    today,
    dailyCdi,
    vault,
  });
  const singleYield = netYield({
    tranches: [{ due: singleDue, amount: total }],
    today,
    dailyCdi,
    vault,
  });
  const cashCost = total.mul(
    new Decimal(1).minus(new Decimal(cashDiscountPercent).div(100)),
  );
  // Custo real: o que sai do bolso menos o que rendeu esperando.
  const costs: Record<PaymentOption, Decimal> = {
    installments: total.minus(installmentYield),
    single: total.minus(singleYield),
    cash: cashCost,
  };
  const ranked = (Object.keys(costs) as PaymentOption[]).sort((a, b) =>
    costs[a].cmp(costs[b]),
  );
  const round = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);
  return {
    total: round(total),
    installmentYield: round(installmentYield),
    singleYield: round(singleYield),
    cashDiscount: round(total.minus(cashCost)),
    costs: {
      installments: round(costs.installments),
      single: round(costs.single),
      cash: round(costs.cash),
    },
    best: ranked[0]!,
    /** Quanto o melhor caminho economiza sobre o segundo melhor. */
    advantage: round(costs[ranked[1]!].minus(costs[ranked[0]!])),
    /** Primeira parcela antes de 30 dias em cofrinho com IOF regressivo: avisa. */
    iofBites:
      vault.iofRegressive &&
      installments.some(
        (tranche) => tranche.due > today && daysApart(today, tranche.due) < 30,
      ),
  };
}
