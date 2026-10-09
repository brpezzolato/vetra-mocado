import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';
import { FinancialVisualizations } from '@/components/financial-visualizations';

export default async function ChartsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  // The cards say which account is a benefit card, which the charts need to
  // tell the owner's money from the employer's. Guessing from the name alone
  // works for "Flash" and fails for a card renamed to anything else.
  const [entries, cards] = await Promise.all([
    loadFinancialEntries(supabase),
    supabase.from('payment_cards').select('*').order('account'),
  ]);
  return (
    <FinancialVisualizations
      entries={(entries.data ?? []) as FinancialEntry[]}
      cards={(cards.data ?? []) as PaymentCard[]}
    />
  );
}
