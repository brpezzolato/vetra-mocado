import { redirect } from 'next/navigation';
import { CardWallet } from '@/components/card-wallet';
import { loadCardInvoiceInputs } from '@/lib/card-invoices-query';
import { createClient } from '@/lib/supabase/server';

// Carteira (teste): as mesmas faturas de /faturas, em pilha de cartões.
export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ cartao?: string | string[] }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const [{ data, error }, params] = await Promise.all([
    loadCardInvoiceInputs(supabase),
    searchParams,
  ]);
  const account = Array.isArray(params.cartao)
    ? params.cartao[0]
    : params.cartao;
  return (
    <CardWallet
      inputs={
        data ?? {
          entries: [],
          cards: [],
          cycles: [],
          payments: [],
          bills: [],
          limits: [],
        }
      }
      initialAccount={account ?? null}
      initialError={error ?? ''}
    />
  );
}
