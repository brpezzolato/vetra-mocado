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
  const [{ data, error }, params, { data: saved }] = await Promise.all([
    loadCardInvoiceInputs(supabase),
    searchParams,
    // A ordem dos cartões, da frente para trás (user_preferences).
    supabase
      .from('user_preferences')
      .select('value')
      .eq('key', 'wallet')
      .maybeSingle(),
  ]);
  const order = (saved?.value as { order?: unknown } | null)?.order;
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
      order={
        Array.isArray(order)
          ? order.filter((item): item is string => typeof item === 'string')
          : null
      }
      initialAccount={account ?? null}
      initialError={error ?? ''}
    />
  );
}
