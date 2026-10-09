import { redirect } from 'next/navigation';
import { PurchaseSimulator } from '@/components/purchase-simulator';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import type { CardCycle, RecurringExpense } from '@/lib/expense-insights';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';
import { createClient } from '@/lib/supabase/server';

export default async function SimulatorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const [entries, cards, cycles, subscriptions] = await Promise.all([
    loadFinancialEntries(supabase),
    supabase.from('payment_cards').select('*'),
    supabase.from('card_cycles').select('*').eq('kind', 'credit'),
    supabase
      .from('recurring_expenses')
      .select('*')
      .eq('active', true)
      .eq('paid_by_me', true),
  ]);
  return (
    <PurchaseSimulator
      entries={(entries.data ?? []) as FinancialEntry[]}
      cards={(cards.data ?? []) as PaymentCard[]}
      cycles={(cycles.data ?? []) as CardCycle[]}
      subscriptions={(subscriptions.data ?? []) as RecurringExpense[]}
      initialError={
        entries.error?.message ??
        cards.error?.message ??
        cycles.error?.message ??
        subscriptions.error?.message ??
        ''
      }
    />
  );
}
