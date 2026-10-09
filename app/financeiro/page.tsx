import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { FinancialEntry, ShortcutToken } from '@/lib/financial-tracker';
import { FinancialTracker } from '@/components/financial-tracker';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import type { PaymentCard } from '@/lib/payment-cards';
import type { CardCycle } from '@/lib/expense-insights';

export default async function FinancialPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const [entries, tokens, cards, cycles] = await Promise.all([
    loadFinancialEntries(supabase, { includeExcluded: true }),
    supabase
      .from('shortcut_tokens')
      .select('id,name,last_used_at,revoked_at,created_at')
      .order('created_at', { ascending: false }),
    supabase.from('payment_cards').select('*').order('account'),
    // O ciclo de cada cartão: o extrato põe cada parcela no mês de gasto da
    // fatura dela (lib/card-invoices.ts, `invoiceSpendingMonth`).
    supabase.from('card_cycles').select('*').eq('kind', 'credit'),
  ]);
  return (
    <FinancialTracker
      userId={user.id}
      initialEntries={(entries.data ?? []) as FinancialEntry[]}
      initialTokens={(tokens.data ?? []) as ShortcutToken[]}
      initialCards={(cards.data ?? []) as PaymentCard[]}
      cycles={(cycles.data ?? []) as CardCycle[]}
      initialError={
        entries.error?.message ??
        tokens.error?.message ??
        cards.error?.message ??
        ''
      }
    />
  );
}
