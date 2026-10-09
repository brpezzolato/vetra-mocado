import { redirect } from 'next/navigation';
import { ReviewQueueView } from '@/components/review-queue-view';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';
import { createClient } from '@/lib/supabase/server';

export default async function ReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const [entries, cards, skipped, rules] = await Promise.all([
    loadFinancialEntries(supabase),
    supabase.from('payment_cards').select('*'),
    // As lojas puladas ou já resolvidas na fila (lib/review-queue.ts,
    // prefixo `rv:`).
    supabase
      .from('expense_reviews')
      .select('pair_key')
      .like('pair_key', 'rv:%'),
    // As lojas que ele já categorizou: nome estranho sozinho não as traz.
    supabase.from('merchant_rules').select('merchant'),
  ]);
  return (
    <ReviewQueueView
      entries={(entries.data ?? []) as FinancialEntry[]}
      cards={(cards.data ?? []) as PaymentCard[]}
      skipped={(skipped.data ?? []).map((row) => row.pair_key as string)}
      taught={(rules.data ?? []).map((row) => String(row.merchant))}
    />
  );
}
