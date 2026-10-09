import { redirect } from 'next/navigation';
import { BenefitCardCenter } from '@/components/benefit-card-center';
import type { BenefitCardBalance } from '@/lib/benefit-cards';
import { FLASH_ACCOUNT } from '@/lib/flash-statement';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';
import { createClient } from '@/lib/supabase/server';

export default async function BenefitsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const [entries, balances, cards] = await Promise.all([
    supabase
      .from('financial_entries')
      .select('*')
      .eq('account', FLASH_ACCOUNT)
      .order('occurred_at', { ascending: false })
      .limit(500),
    supabase
      .from('benefit_card_balances')
      .select('*')
      .order('measured_at', { ascending: false }),
    supabase.from('payment_cards').select('*').order('account'),
  ]);
  return (
    <BenefitCardCenter
      userId={user.id}
      initialEntries={(entries.data ?? []) as FinancialEntry[]}
      initialBalances={(balances.data ?? []) as BenefitCardBalance[]}
      cards={(cards.data ?? []) as PaymentCard[]}
    />
  );
}
