import Decimal from 'decimal.js';
import { invoiceFor, type CardCycle } from './expense-insights';

function addMonths(value: string, amount: number) {
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1 + amount, 1));
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result.toISOString().slice(0, 10);
}

export function splitInstallments(total: Decimal.Value, count: number) {
  const cents = new Decimal(total).times(100).round().toNumber();
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return Array.from({ length: count }, (_, index) =>
    new Decimal(base + (index < remainder ? 1 : 0)).div(100).toFixed(2),
  );
}

export function simulatePurchaseInvoices({
  total,
  installments,
  purchaseDate,
  cycle,
}: {
  total: Decimal.Value;
  installments: number;
  purchaseDate: string;
  cycle: CardCycle;
}) {
  const first = invoiceFor(purchaseDate, cycle);
  return splitInstallments(total, installments).map((amount, index) => ({
    installment: index + 1,
    amount,
    due: addMonths(first.due, index),
  }));
}
