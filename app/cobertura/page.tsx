import { redirect } from 'next/navigation';
import { VaultCoverage } from '@/components/vault-coverage';
import { loadCardInvoiceInputs } from '@/lib/card-invoices-query';
import { loadFlashWalletBalances } from '@/lib/flash-balances-query';
import { createClient } from '@/lib/supabase/server';

export default async function CoveragePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  // As mesmas faturas de /faturas; os cofrinhos carregam no navegador.
  const [{ data, error }, benefits] = await Promise.all([
    loadCardInvoiceInputs(supabase),
    loadFlashWalletBalances(supabase, user.id).catch(() => []),
  ]);
  return (
    <VaultCoverage
      inputs={data}
      benefits={benefits}
      initialError={error ?? ''}
    />
  );
}
