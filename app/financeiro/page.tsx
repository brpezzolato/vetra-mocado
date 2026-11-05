import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { ExpenseLedger } from '@/components/expense-ledger';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import { loadUnidentifiedSpend } from '@/lib/unidentified-spend-query';
import type { PaymentCard } from '@/lib/payment-cards';
import type { CardCycle } from '@/lib/expense-insights';

export default async function FinancialPage({
  searchParams,
}: {
  searchParams: Promise<{ lancamento?: string | string[] }>;
}) {
  // `?lancamento=<id>`: o toque no aviso de compra abre o detalhe dela.
  const { lancamento } = await searchParams;
  const openEntryId = typeof lancamento === 'string' ? lancamento : undefined;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const [entries, cards, cycles, pending] = await Promise.all([
    loadFinancialEntries(supabase, { includeExcluded: true }),
    supabase.from('payment_cards').select('*').order('account'),
    // O ciclo de cada cartão: o extrato põe cada parcela no mês de gasto da
    // fatura dela (lib/card-invoices.ts, `invoiceSpendingMonth`).
    supabase.from('card_cycles').select('*').eq('kind', 'credit'),
    // As compras a chegar, para o filtro "Pendentes".
    loadUnidentifiedSpend(supabase).catch(() => []),
  ]);
  return (
    <ExpenseLedger
      // Outro aviso tocado com a tela já aberta: monta de novo com ele aberto.
      key={openEntryId ?? ''}
      openEntryId={openEntryId}
      userId={user.id}
      initialEntries={(entries.data ?? []) as FinancialEntry[]}
      initialCards={(cards.data ?? []) as PaymentCard[]}
      initialPending={pending}
      cycles={(cycles.data ?? []) as CardCycle[]}
      initialError={entries.error?.message ?? cards.error?.message ?? ''}
    />
  );
}
