import Decimal from 'decimal.js';
import { isFinancialBusinessDay } from './business-calendar';
import { monthDay } from './card-due-dates';
import type { RecurringExpense } from './expense-insights';
import { subscriptionDays } from './month-calendar';

/* "Posso gastar R$ X hoje?": por dia, até o último dia útil do mês:
     (barra "Ainda dá para gastar": saldos, Flash e limites escolhidos)
   − assinaturas que ainda caem até lá
   ÷ dias até lá, contando hoje.
   A fatura NÃO é descontada: o usuário guarda num cofrinho o valor dela.
   Passado o último dia útil, só resta hoje. */

export type SafeToSpend = {
  /** O último dia útil do mês (yyyy-mm-dd), ou hoje, se ele já passou. */
  until: string;
  /** Dias contando hoje (≥ 1). */
  days: number;
  room: string;
  subscriptions: { merchant: string; day: string; amount: string }[];
  subscriptionsTotal: string;
  /** O que sobra para o mês (pode ser negativo). */
  free: string;
  /** Por dia, nunca menos que zero. */
  perDay: string;
};

const DAY = 86_400_000;

/** Último dia útil do mês (lib/business-calendar.ts). */
export function lastBusinessDay(month: string) {
  const date = new Date(`${monthDay(month, 31)}T12:00:00Z`);
  while (!isFinancialBusinessDay(date)) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
const at = (day: string) => Date.parse(`${day}T12:00:00Z`);

export function safeToSpend({
  today,
  room,
  subscriptions,
}: {
  today: string;
  room: Decimal.Value;
  subscriptions: RecurringExpense[];
}): SafeToSpend {
  const month = today.slice(0, 7);
  const until = lastBusinessDay(month) < today ? today : lastBusinessDay(month);

  // As cobranças das assinaturas dele de hoje até o último dia útil.
  const charges: SafeToSpend['subscriptions'] = [];
  for (const item of subscriptions) {
    if (!item.active || item.paid_by_me === false) continue;
    for (const day of subscriptionDays(item, month))
      if (day >= today && day <= until)
        charges.push({
          merchant: item.merchant,
          day,
          amount: new Decimal(item.amount).toFixed(2),
        });
  }
  charges.sort((a, b) => a.day.localeCompare(b.day));
  const subscriptionsTotal = charges.reduce(
    (sum, charge) => sum.plus(charge.amount),
    new Decimal(0),
  );

  const days = Math.max(1, Math.round((at(until) - at(today)) / DAY) + 1);
  const free = new Decimal(room).minus(subscriptionsTotal);
  return {
    until,
    days,
    room: new Decimal(room).toFixed(2),
    subscriptions: charges,
    subscriptionsTotal: subscriptionsTotal.toFixed(2),
    free: free.toFixed(2),
    perDay: Decimal.max(free, 0)
      .div(days)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN)
      .toFixed(2),
  };
}
