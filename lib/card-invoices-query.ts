import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CardBill,
  CardInvoicePayment,
  CardLimitInfo,
} from './card-invoices';
import type { CardCycle } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import type { PaymentCard } from './payment-cards';
import { pendingEntries } from './unidentified-spend';
import { loadUnidentifiedSpend } from './unidentified-spend-query';

// Tudo o que as faturas precisam, de um lugar só, para Faturas, calendário e
// página do banco mostrarem os mesmos números. Com a sessão o RLS filtra o
// usuário; com a service role, passe `userId`.

export type CardInvoiceInputs = {
  /** Inclui "fora das contas": a fatura tem de bater com o banco. */
  entries: FinancialEntry[];
  cards: PaymentCard[];
  cycles: CardCycle[];
  payments: CardInvoicePayment[];
  bills: CardBill[];
  limits: (CardLimitInfo & { synced_at?: string | null })[];
};

export async function loadCardInvoiceInputs(
  client: SupabaseClient,
  { userId, accounts }: { userId?: string; accounts?: string[] } = {},
): Promise<{ data: CardInvoiceInputs | null; error: string | null }> {
  // Os mesmos filtros em toda tabela: todas têm `user_id` e `account`.
  type Filterable = {
    eq(column: string, value: string): Filterable;
    in(column: string, values: string[]): Filterable;
  };
  const scoped = <Query>(query: Query): Query => {
    let result = query as unknown as Filterable;
    if (userId) result = result.eq('user_id', userId);
    if (accounts) result = result.in('account', accounts);
    return result as unknown as Query;
  };

  const entries: FinancialEntry[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await scoped(
      client.from('financial_entries').select('*'),
    )
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) return { data: null, error: error.message };
    entries.push(...((data ?? []) as FinancialEntry[]));
    if (!data || data.length < pageSize) break;
  }

  const [cards, cycles, payments, bills, limits, pending] = await Promise.all([
    scoped(client.from('payment_cards').select('*')),
    scoped(client.from('card_cycles').select('*').eq('kind', 'credit')),
    scoped(client.from('card_invoice_payments').select('*')).order('paid_at', {
      ascending: false,
    }),
    scoped(
      client
        .from('card_bills')
        .select(
          'account, due_date, closing_date, total, minimum, paid, payments',
        ),
    ),
    scoped(
      client
        .from('pluggy_card_links')
        .select('account, credit_limit, available_limit, synced_at')
        .eq('kind', 'credit'),
    ),
    // "Compra a chegar" na fatura aberta (lib/unidentified-spend.ts); falha não
    // derruba a fatura.
    loadUnidentifiedSpend(client, userId).catch(() => []),
  ]);
  const error =
    cards.error ??
    cycles.error ??
    payments.error ??
    bills.error ??
    limits.error;
  if (error) return { data: null, error: error.message };
  return {
    data: {
      entries: [
        ...entries,
        ...pendingEntries(
          pending.filter(
            (item) => !accounts || accounts.includes(item.account),
          ),
        ),
      ],
      // Cartão desligado em "Mostrar em Faturas" some de toda tela de fatura.
      cards: ((cards.data ?? []) as PaymentCard[]).filter(
        (card) => card.show_in_invoices !== false,
      ),
      cycles: (cycles.data ?? []) as CardCycle[],
      payments: (payments.data ?? []) as CardInvoicePayment[],
      bills: (bills.data ?? []) as CardBill[],
      limits: (limits.data ?? []) as CardInvoiceInputs['limits'],
    },
    error: null,
  };
}
