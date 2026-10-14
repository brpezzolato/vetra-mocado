import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { FinancialTracker } from '@/components/financial-tracker';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import type { FinancialEntry, ShortcutToken } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';

export default async function SettingsPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/auth');
  const [entries, tokens, cards] = await Promise.all([
    loadFinancialEntries(db),
    db
      .from('shortcut_tokens')
      .select('id,name,last_used_at,revoked_at,created_at')
      .order('created_at', { ascending: false }),
    db.from('payment_cards').select('*').order('account'),
  ]);
  return (
    <FinancialTracker
      userId={user.id}
      initialEntries={(entries.data ?? []) as FinancialEntry[]}
      initialTokens={(tokens.data ?? []) as ShortcutToken[]}
      initialCards={(cards.data ?? []) as PaymentCard[]}
      initialError={
        entries.error?.message ??
        tokens.error?.message ??
        cards.error?.message ??
        ''
      }
      aiEnabled={Boolean(process.env.GEMINI_API_KEY)}
    />
  );
}
