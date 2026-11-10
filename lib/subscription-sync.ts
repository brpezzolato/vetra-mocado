import type { SupabaseClient } from '@supabase/supabase-js';
import { saoDate, type RecurringExpense } from './expense-insights';
import {
  matchSubscriptions,
  subscriptionPatch,
  type ChargeEntry,
  type SubscriptionLike,
} from './subscription-charges';

/* Grava o vínculo das cobranças do banco com as assinaturas e faz cada uma
   virar o mês: a próxima data, o dia e o cartão passam a ser os da última
   cobrança (lib/subscription-charges.ts). Roda no fim de cada sincronização
   com os bancos e ao abrir Assinaturas. Melhor esforço: um erro aqui não
   derruba quem chamou. */

/** Quanto para trás procurar cobranças. */
const LOOKBACK_DAYS = 150;

export async function syncSubscriptionCharges(
  db: SupabaseClient,
  userId: string,
  today = saoDate(new Date()),
) {
  const result = { linked: 0, updated: 0 };
  const { data: subscriptions, error } = await db
    .from('recurring_expenses')
    .select(
      'id, merchant, account, amount, next_date, billing_day, frequency, paid_by_me, bank_label',
    )
    .eq('user_id', userId)
    .eq('active', true)
    .eq('paid_by_me', true);
  if (error || !subscriptions?.length) return result;

  const since = new Date(
    Date.parse(`${today}T12:00:00Z`) - LOOKBACK_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const { data: entries, error: entriesError } = await db
    .from('financial_entries')
    .select(
      'id, entry_type, amount, description, bank_description, account, occurred_at, installment_group_id, installment_total, recurring_expense_id, recurring_dismissed',
    )
    .eq('user_id', userId)
    .eq('entry_type', 'expense')
    .gte('occurred_at', `${since}T00:00:00-03:00`)
    .limit(20000);
  if (entriesError || !entries) return result;

  const items = subscriptions as SubscriptionLike[];
  const matches = matchSubscriptions(items, entries as ChargeEntry[], today);
  for (const item of items) {
    const match = matches.get(item.id);
    if (!match) continue;
    if (match.newLinks.length) {
      const { error: linkError } = await db
        .from('financial_entries')
        .update({ recurring_expense_id: item.id })
        .eq('user_id', userId)
        .is('recurring_expense_id', null)
        .in('id', match.newLinks);
      if (!linkError) result.linked += match.newLinks.length;
    }
    const patch = subscriptionPatch(item, match);
    if (Object.keys(patch).length) {
      const { error: patchError } = await db
        .from('recurring_expenses')
        .update(
          patch satisfies Partial<RecurringExpense> & {
            bank_label?: string;
          },
        )
        .eq('user_id', userId)
        .eq('id', item.id);
      if (!patchError) result.updated++;
    }
  }
  return result;
}
