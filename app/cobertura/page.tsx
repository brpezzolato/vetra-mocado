import { redirect } from 'next/navigation';
import { VaultCoverage } from '@/components/vault-coverage';
import { loadCardInvoiceInputs } from '@/lib/card-invoices-query';
import { createClient } from '@/lib/supabase/server';

export default async function CoveragePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  // As mesmas faturas de /faturas; os cofrinhos carregam no navegador.
  const { data, error } = await loadCardInvoiceInputs(supabase);
  return <VaultCoverage inputs={data} initialError={error ?? ''} />;
}
