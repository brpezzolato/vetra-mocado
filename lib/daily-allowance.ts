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
 * contas", parcelas ou futuros.
 */
export function spentByDayOf(entries: FinancialEntry[], now = Date.now()) {
  const spent: Record<string, Decimal> = {};
  for (const entry of entries) {
    if (entry.entry_type !== 'expense' || entry.excluded_from_totals) continue;
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

/** Dias acima do valor por semana que não quebram a sequência. */
export const STREAK_SAVES_PER_WEEK = 2;

/** Domingo da semana do dia (semana de domingo a sábado). */
export const weekOf = (day: string) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};

/**
 * Classifica cada dia: soma, salvo por recuperação ou quebra. Dia acima do
 * valor usa uma recuperação da semana, se houver, sem somar.
 */
function walkStreak(
  days: AllowanceDay[],
  spentByDay: Record<string, Decimal.Value>,
) {
  const used = new Map<string, number>();
  return days.map((item) => {
    if (withinAllowance(item.allowance, spentByDay[item.day]))
      return { day: item.day, outcome: 'counts' as const };
    const week = weekOf(item.day);
    const spent = used.get(week) ?? 0;
    if (spent < STREAK_SAVES_PER_WEEK) {
      used.set(week, spent + 1);
      return { day: item.day, outcome: 'saved' as const };
    }
    return { day: item.day, outcome: 'breaks' as const };
  });
}

/**
 * Sequência atual (até ontem, mais hoje se no azul) e recorde.
 * `provisional`: inclui dias ainda na janela de 3 dias úteis.
 */
export function allowanceStreak({
  today,
  allowances,
  spentByDay,
  now = today,
}: {
  today: string;
  allowances: AllowanceDay[];
  /** yyyy-mm-dd → gasto do dia. */
  spentByDay: Record<string, Decimal.Value>;
  /** Dia real (para a janela), quando `today` é um dia passado do resumo. */
  now?: string;
}) {
  const since = provisionalSince(now);
  const days = [...allowances]
    .sort((a, b) => a.day.localeCompare(b.day))
    .filter((item) => item.day <= today);
  // Hoje: só soma se já no azul; não gasta recuperação nem quebra.
  const open = today === now && days.at(-1)?.day === today;
  const closed = open ? days.slice(0, -1) : days;
  let best = 0;
  let run = 0;
  let runStart: string | null = null;
  const saved: string[] = [];
  for (const step of walkStreak(closed, spentByDay)) {
    if (step.outcome === 'counts') {
      if (run === 0 && runStart === null) runStart = step.day;
      run++;
    } else if (step.outcome === 'saved') {
      // Salva a sequência que vinha; sem sequência, não há o que salvar.
      if (run > 0) saved.push(step.day);
    } else {
      run = 0;
      runStart = null;
      saved.length = 0;
    }
    best = Math.max(best, run);
  }
  if (open && withinAllowance(days.at(-1)!.allowance, spentByDay[today])) {
    if (run === 0) runStart = today;
    run++;
    best = Math.max(best, run);
  }
  // As recuperações que restam na semana de hoje.
  const week = weekOf(now);
  const savesLeft = Math.max(
    0,
    STREAK_SAVES_PER_WEEK -
      walkStreak(closed, spentByDay).filter(
        (step) => step.outcome !== 'counts' && weekOf(step.day) === week,
      ).length,
  );
  // Provisória se o dia mais recente ainda está na janela.
  const lastCounted = days.at(-1)?.day;
  const provisional =
    (runStart !== null && today >= since) ||
    (lastCounted !== undefined && lastCounted >= since);
  return {
    current: run,
    best,
    provisional,
    settledBefore: since,
    /** Os dias acima do valor que a sequência atual atravessou. */
    saved,
    savesLeft,
  };
}

/** Maior sequência no azul dentro de um mês (retrospectiva). */
export function bestStreakInMonth(
  month: string,
  allowances: AllowanceDay[],
  spentByDay: Record<string, Decimal.Value>,
) {
  let best = 0;
  let run = 0;
  // A mesma regra da sequência: o dia acima do valor gasta uma recuperação.
  for (const step of walkStreak(
    [...allowances]
      .filter((entry) => entry.day.startsWith(month))
      .sort((a, b) => a.day.localeCompare(b.day)),
    spentByDay,
  )) {
    if (step.outcome === 'counts') run++;
    else if (step.outcome === 'breaks') run = 0;
    best = Math.max(best, run);
  }
  return best;
}
