import Decimal from 'decimal.js';
import type { FinancialEntry } from './financial-tracker';

/* Compra dividida: o valor cheio fica onde o banco cobra (fatura, saldo da
   Flash); a parte do usuário é o que entra nas contas de gasto. */

type Shareable = Pick<
  FinancialEntry,
  'amount' | 'split_share' | 'full_amount' | 'excluded_from_totals'
>;

/** O valor cheio da compra, venha ela de qualquer leitura. */
export const fullAmount = (entry: Shareable) =>
  new Decimal(entry.full_amount ?? entry.amount);

/** A compra está dividida? */
export const isSplit = (entry: Shareable) =>
  entry.split_share !== null && entry.split_share !== undefined;

/** A parte do usuário (limitada ao valor), ou o valor inteiro. */
export function myShare(entry: Shareable) {
  const full = fullAmount(entry);
  return isSplit(entry)
    ? Decimal.min(new Decimal(entry.split_share!), full)
    : full;
}

/** Peso no gasto: zero se fora das contas, senão a parte do usuário. */
export const countedAmount = (entry: Shareable) =>
  entry.excluded_from_totals ? new Decimal(0) : myShare(entry);

/**
 * Visão das contas de gasto: `amount` vira a parte e o cheio vai para
 * `full_amount` (o que `loadFinancialEntries` devolve).
 */
export function toTotalsView<T extends FinancialEntry>(entry: T): T {
  if (!isSplit(entry)) return entry;
  return {
    ...entry,
    full_amount: fullAmount(entry).toFixed(2),
    amount: myShare(entry).toFixed(2),
  };
}
