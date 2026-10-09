import type { SupabaseClient } from '@supabase/supabase-js';
import { spentByDayOf, type AllowanceDay } from './daily-allowance';
import { saoDate, type RecurringExpense } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import Decimal from 'decimal.js';
import type { UnidentifiedSpend } from './unidentified-spend';
import { loadUnidentifiedSpend } from './unidentified-spend-query';

/** Quantos dias de histórico a sequência no azul olha. */
const HISTORY_DAYS = 120;

/**
 * Entradas do "Posso gastar hoje?" além da barra: assinaturas, gasto por dia
 * e valores guardados. A conta roda na tela.
 */
export async function loadSafeToSpendInputs(
  admin: SupabaseClient,
  userId: string,
): Promise<{
  subscriptions: RecurringExpense[];
  /** yyyy-mm-dd → gasto do dia (parte do usuário, sem "fora das contas"). */
  spentByDay: Record<string, string>;
  allowances: AllowanceDay[];
  /** Gasto sem compra ainda (lib/unidentified-spend.ts); já em `spentByDay`. */
  unidentified: UnidentifiedSpend[];
}> {
  const since = saoDate(new Date(Date.now() - HISTORY_DAYS * 86_400_000));
  const [{ data: subscriptions }, { data: entries }, { data: allowances }] =
    await Promise.all([
      admin
        .from('recurring_expenses')
        .select(
          'id, merchant, account, amount, next_date, billing_day, active, paid_by_me, frequency',
        )
        .eq('user_id', userId)
        .eq('active', true),
      admin
        .from('financial_entries')
        .select(
          'entry_type, amount, occurred_at, split_share, excluded_from_totals, installment_group_id, installment_total',
        )
        .eq('user_id', userId)
        .eq('entry_type', 'expense')
        .eq('excluded_from_totals', false)
        .gte('occurred_at', `${since}T00:00:00-03:00`)
        .limit(5000),
      admin
        .from('daily_allowances')
        .select('day, allowance')
        .eq('user_id', userId)
        .gte('day', since),
    ]);
  const spent = spentByDayOf((entries ?? []) as FinancialEntry[]);
  // O que o limite mostra que já foi gasto e ainda não chegou: entra no dia,
  // e some sozinho quando a compra chega.
  const unidentified = await loadUnidentifiedSpend(admin, userId).catch(
    () => [] as UnidentifiedSpend[],
  );
  for (const item of unidentified)
    spent[item.day] = (spent[item.day] ?? new Decimal(0)).plus(item.amount);
  return {
    subscriptions: (subscriptions ?? []) as RecurringExpense[],
    spentByDay: Object.fromEntries(
      Object.entries(spent).map(([day, value]) => [day, value.toFixed(2)]),
    ),
    allowances: (allowances ?? []) as AllowanceDay[],
    unidentified,
  };
}
