import { redirect } from 'next/navigation';
import { PeriodSummaryView } from '@/components/period-summary-view';
import { loadCardInvoiceInputs } from '@/lib/card-invoices-query';
import type { AllowanceDay } from '@/lib/daily-allowance';
import type { RecurringExpense } from '@/lib/expense-insights';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';
import { loadUnidentifiedSpend } from '@/lib/unidentified-spend-query';
import { createClient } from '@/lib/supabase/server';

// Resumo e Calendário numa tela só (/calendario redireciona para cá).
export default async function SummaryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const [entries, cards, allowances, unidentified, invoices, subscriptions] =
    await Promise.all([
      loadFinancialEntries(supabase),
      supabase.from('payment_cards').select('*').order('account'),
      // Os valores do dia do "Hoje você pode", para o termômetro e a
      // sequência no azul de cada dia.
      supabase.from('daily_allowances').select('day, allowance'),
      // Gasto no cartão que o limite já mostra e a compra ainda não chegou.
      loadUnidentifiedSpend(supabase).catch(() => []),
      // As faturas com o mesmo carregamento da tela de Faturas, para o
      // vencimento no calendário ter o mesmo valor que lá.
      loadCardInvoiceInputs(supabase),
      supabase
        .from('recurring_expenses')
        .select('*')
        .eq('active', true)
        .order('next_date'),
    ]);
  return (
    <PeriodSummaryView
      entries={(entries.data ?? []) as FinancialEntry[]}
      cards={(cards.data ?? []) as PaymentCard[]}
      allowances={(allowances.data ?? []) as AllowanceDay[]}
      unidentified={unidentified}
      invoices={invoices.data ?? undefined}
      subscriptions={(subscriptions.data ?? []) as RecurringExpense[]}
    />
  );
}
