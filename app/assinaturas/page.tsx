import { redirect } from 'next/navigation';
import { SubscriptionsCenter } from '@/components/subscriptions-center';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import type { RecurringExpense } from '@/lib/expense-insights';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';
import { createClient } from '@/lib/supabase/server';

export default async function SubscriptionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const [subscriptions, cards, entries] = await Promise.all([
    supabase.from('recurring_expenses').select('*').order('next_date'),
    supabase.from('payment_cards').select('*').order('account'),
    loadFinancialEntries(supabase),
  ]);

  return (
    <SubscriptionsCenter
      userId={user.id}
      initialSubscriptions={(subscriptions.data ?? []) as RecurringExpense[]}
      cards={(cards.data ?? []) as PaymentCard[]}
      entries={(entries.data ?? []) as FinancialEntry[]}
      initialError={
        subscriptions.error?.message ??
        cards.error?.message ??
        entries.error?.message ??
        ''
      }
    />
  );
}
