import { scopeQuery } from './supabase/scoped';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  earlyPayments,
  type CardBill,
  type CardInvoicePayment,
  type CardLimitInfo,
  type CardPaymentEvent,
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
  const scoped = <Query>(query: Query) =>
    scopeQuery(query, { userId, accounts });

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

  const [cards, cycles, payments, bills, limits, pending, events] =
    await Promise.all([
      scoped(client.from('payment_cards').select('*')),
      scoped(client.from('card_cycles').select('*').eq('kind', 'credit')),
      scoped(client.from('card_invoice_payments').select('*')).order(
        'paid_at',
        {
          ascending: false,
        },
      ),
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
      // Pagamento antecipado visto na lista do cartão (`earlyPayments`).
      scoped(
        client.from('card_payment_events').select('account, paid_on, amount'),
      ),
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
      payments: [
        ...((payments.data ?? []) as CardInvoicePayment[]),
        ...earlyPayments(
          (events.data ?? []) as CardPaymentEvent[],
          (bills.data ?? []) as CardBill[],
          (payments.data ?? []) as CardInvoicePayment[],
          (cycles.data ?? []) as CardCycle[],
        ),
      ],
      bills: (bills.data ?? []) as CardBill[],
      limits: (limits.data ?? []) as CardInvoiceInputs['limits'],
    },
    error: null,
  };
}
