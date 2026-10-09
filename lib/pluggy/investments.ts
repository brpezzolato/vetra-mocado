// Saldo de um cofrinho pelos lotes de investimento da Pluggy. Puro.
// Nubank: cada depósito é um CDB; `amount` bruto, `balance` líquido; `taxes`
// = IR, `taxes2` = IOF; lote resgatado fica na lista como TOTAL_WITHDRAWAL.
import Decimal from 'decimal.js';
import type { PluggyInvestmentLot } from './types';

export type PiggySnapshot = {
  snapshotDate: string;
  gross: string;
  net: string;
  iof: string | null;
  incomeTax: string | null;
};

const money = (value: number | null) =>
  new Decimal(value ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Os lotes que ainda têm dinheiro: renda fixa, não resgatada e com bruto. */
export function activeLots(lots: PluggyInvestmentLot[]): PluggyInvestmentLot[] {
  return lots.filter(
    (lot) =>
      lot.type === 'FIXED_INCOME' &&
      lot.status !== 'TOTAL_WITHDRAWAL' &&
      (lot.amount ?? 0) > 0,
  );
}

/**
 * Soma os lotes ativos. `null` quando não dá para confiar: nenhum lote ativo
 * (lista vazia por falha), datas diferentes ou líquido maior que o bruto.
 */
export function piggySnapshotFromLots(
  lots: PluggyInvestmentLot[],
): PiggySnapshot | null {
  const active = activeLots(lots);
  if (!active.length) return null;

  const dates = new Set(active.map((lot) => lot.date?.slice(0, 10) ?? ''));
  if (dates.size !== 1) return null;
  const [snapshotDate] = dates;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return null;

  let gross = new Decimal(0);
  let net = new Decimal(0);
  let iof = new Decimal(0);
  let incomeTax = new Decimal(0);
  let taxesKnown = true;
  for (const lot of active) {
    gross = gross.plus(money(lot.amount));
    net = net.plus(money(lot.balance));
    if (lot.iof === null || lot.incomeTax === null) taxesKnown = false;
    iof = iof.plus(money(lot.iof));
    incomeTax = incomeTax.plus(money(lot.incomeTax));
  }
  if (net.gt(gross) || net.isNegative()) return null;

  // IOF + IR tem de fechar bruto − líquido; senão o saldo vale sem a divisão.
  const split =
    taxesKnown && iof.plus(incomeTax).eq(gross.minus(net))
      ? { iof: iof.toFixed(2), incomeTax: incomeTax.toFixed(2) }
      : { iof: null, incomeTax: null };

  return {
    snapshotDate,
    gross: gross.toFixed(2),
    net: net.toFixed(2),
    ...split,
  };
}
