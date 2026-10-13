import Decimal from 'decimal.js';
import { isFinancialBusinessDay } from './business-calendar';
import { countedAmount } from './entry-share';
import { saoDate, type RecurringExpense } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import { safeToSpend } from './safe-to-spend';

/* "Posso gastar hoje":
   - Valor do dia: (saldo atual + gasto de hoje) ÷ dias até o último dia útil.
     Congelado no primeiro cálculo do dia (`daily_allowances`).
   - A sobra fica no saldo e entra no valor de amanhã.
   - Termômetro: gasto do dia vs. valor do dia.
   - Sequência no azul: dias sem valor guardado não contam nem quebram.
   Janela de 3 dias úteis (atraso da Pluggy): o gasto se corrige sozinho, o
   valor só pode DIMINUIR (`adjustAllowances`) e os dias são provisórios. */

export type AllowanceDay = { day: string; allowance: number | string };

/** Quantos dias úteis uma compra no cartão pode levar para chegar. */
export const SETTLE_BUSINESS_DAYS = 3;

/** O valor do dia, como o dia começou. */
export function allowanceForToday({
  today,
  room,
  spentToday,
  subscriptions,
}: {
  today: string;
  room: Decimal.Value;
  spentToday: Decimal.Value;
  subscriptions: RecurringExpense[];
}) {
  return safeToSpend({
    today,
    room: new Decimal(room).plus(spentToday),
    subscriptions,
  });
}

/**
 * Gasto do dia como o valor o mede: a parte do usuário, sem "fora das
 * contas", parcelas, compras marcadas como fora do valor do dia ou futuros.
 */
export function spentByDayOf(entries: FinancialEntry[], now = Date.now()) {
  const spent: Record<string, Decimal> = {};
  for (const entry of entries) {
    if (
      entry.entry_type !== 'expense' ||
      entry.excluded_from_totals ||
      entry.excluded_from_daily
    )
      continue;
    if (entry.installment_group_id || (entry.installment_total ?? 0) > 1)
      continue;
    if (Date.parse(entry.occurred_at) > now) continue;
    const day = saoDate(entry.occurred_at);
    spent[day] = (spent[day] ?? new Decimal(0)).plus(countedAmount(entry));
  }
  return spent;
}

/** Primeiro dia provisório: `SETTLE_BUSINESS_DAYS` dias úteis antes de hoje. */
export function provisionalSince(today: string) {
  const date = new Date(`${today}T12:00:00Z`);
  let left = SETTLE_BUSINESS_DAYS;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (isFinancialBusinessDay(date)) left--;
  }
  return date.toISOString().slice(0, 10);
}

/** Dia em que deixa de ser provisório. */
export function settlesOn(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  let left = SETTLE_BUSINESS_DAYS;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isFinancialBusinessDay(date)) left--;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Recalcula os valores da janela provisória com o que chegou depois e fica
 * com o menor. Devolve a lista e os dias que mudaram.
 */
export function adjustAllowances({
  today,
  room,
  allowances,
  spentByDay,
  subscriptions,
}: {
  today: string;
  room: Decimal.Value;
  allowances: AllowanceDay[];
  spentByDay: Record<string, Decimal.Value>;
  subscriptions: RecurringExpense[];
}) {
  const since = provisionalSince(today);
  const changed: AllowanceDay[] = [];
  const adjusted = allowances.map((item) => {
    if (item.day < since || item.day > today) return item;
    const spentSince = Object.entries(spentByDay)
      .filter(([day]) => day >= item.day && day <= today)
      .reduce((sum, [, value]) => sum.plus(value), new Decimal(0));
    const recomputed = new Decimal(
      safeToSpend({
        today: item.day,
        room: new Decimal(room).plus(spentSince),
        subscriptions,
      }).perDay,
    );
    if (!recomputed.lt(item.allowance)) return item;
    const next = { day: item.day, allowance: recomputed.toFixed(2) };
    changed.push(next);
    return next;
  });
  return { adjusted, changed };
}

/** O dia dentro do valor? (gasto até o valor, ao centavo) */
const withinAllowance = (
  allowance: Decimal.Value,
  spent: Decimal.Value | undefined,
) => new Decimal(spent ?? 0).lte(allowance);

/**
 * Dias no azul desde o começo: cada dia com valor guardado em que o gasto
 * ficou dentro dele. Um dia acima só não soma; nada zera. Hoje (ainda
 * aberto) conta se até agora está no azul.
 * `provisional`: algum dia contado ainda está na janela de 3 dias úteis.
 */
export function daysInTheBlue({
  today,
  allowances,
  spentByDay,
  now = today,
}: {
  /** Até que dia contar (o resumo pode pedir um dia passado). */
  today: string;
  allowances: AllowanceDay[];
  /** yyyy-mm-dd → gasto do dia. */
  spentByDay: Record<string, Decimal.Value>;
  /** Dia real (para a janela), quando `today` é um dia passado do resumo. */
  now?: string;
}) {
  const since = provisionalSince(now);
  let total = 0;
  let provisional = false;
  for (const item of allowances) {
    if (item.day > today) continue;
    if (!withinAllowance(item.allowance, spentByDay[item.day])) continue;
    total++;
    if (item.day >= since) provisional = true;
  }
  return { total, provisional };
}
