import { redirect } from 'next/navigation';
import { InvoiceOverviewOptions } from '@/components/invoice-overview-options';
import { loadCardInvoiceInputs } from '@/lib/card-invoices-query';
import { createClient } from '@/lib/supabase/server';

// Teste: quatro redesenhos da visão "Todas" de /faturas, com os mesmos dados.
export default async function InvoiceOptionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  // As faturas fechadas e o limite vêm do banco, pela Pluggy; o resto, do
  // app. O mesmo carregamento do calendário e da página de cada banco.
  const { data, error } = await loadCardInvoiceInputs(supabase);
  return (
    <InvoiceOverviewOptions
      entries={data?.entries ?? []}
      cards={data?.cards ?? []}
      cycles={data?.cycles ?? []}
      payments={data?.payments ?? []}
      bills={data?.bills ?? []}
      limits={data?.limits ?? []}
      initialError={error ?? ''}
    />
  );
}
