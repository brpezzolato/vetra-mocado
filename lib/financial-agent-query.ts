import type { SupabaseClient } from '@supabase/supabase-js';
import type { BenefitCardBalance } from './benefit-cards';
import type { CardBill, CardInvoicePayment } from './card-invoices';
import type {
  BankEarningCredit,
  PiggyBankRow,
  SnapshotRow,
  TransactionRow,
} from './domain';
import type { CardCycle, RecurringExpense } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import { loadFinancialEntries } from './financial-entries-query';
import type { PaymentCard } from './payment-cards';
import { pendingEntries } from './unidentified-spend';
import { loadUnidentifiedSpend } from './unidentified-spend-query';

export type FinancialAgentVault = PiggyBankRow & {
  transactions: TransactionRow[];
  balance_snapshots: SnapshotRow[];
  bank_earning_credits: BankEarningCredit[];
};

/** O limite do cartão como o banco informa pela Pluggy. */
export type FinancialAgentCardLimit = {
  account: string;
  credit_limit: number | string | null;
  available_limit: number | string | null;
};

export type FinancialAgentData = {
  /** Sem os lançamentos "fora das contas": base de todo cálculo de gasto. */
  entries: FinancialEntry[];
  /** Com eles: só para a fatura, que tem de bater com o que o banco cobra —
   * a mesma base da tela de Faturas. */
  invoiceEntries: FinancialEntry[];
  bills: CardBill[];
  cardLimits: FinancialAgentCardLimit[];
  cards: PaymentCard[];
  cycles: CardCycle[];
  invoicePayments: CardInvoicePayment[];
  vaults: FinancialAgentVault[];
  subscriptions: RecurringExpense[];
  benefitBalances: BenefitCardBalance[];
};

export async function loadFinancialAgentData(client: SupabaseClient) {
  const [
    entries,
    invoiceEntries,
    bills,
    cardLimits,
    cards,
    cycles,
    invoicePayments,
    vaults,
    subscriptions,
    benefitBalances,
    pending,
  ] = await Promise.all([
    loadFinancialEntries(client),
    loadFinancialEntries(client, { includeExcluded: true }),
    client
      .from('card_bills')
      .select('account, due_date, closing_date, total, minimum, paid, payments'),
    client
      .from('pluggy_card_links')
      .select('account, credit_limit, available_limit'),
    client.from('payment_cards').select('*').order('account'),
    client.from('card_cycles').select('*').order('account'),
    client
      .from('card_invoice_payments')
      .select('*')
      .order('paid_at', { ascending: false }),
    client
      .from('piggy_banks')
      .select(
        '*, transactions(*), balance_snapshots(*), bank_earning_credits(*)',
      )
      .order('created_at'),
    client
      .from('recurring_expenses')
      .select('*')
      .eq('active', true)
      .eq('paid_by_me', true)
      .order('next_date'),
    client
      .from('benefit_card_balances')
      .select('*')
      .order('measured_at', { ascending: false }),
    // O gasto no cartão que ainda não chegou como compra, como "Compra a
    // chegar" — o mesmo que a home e as faturas mostram, para o Vetra AI
    // somar igual a elas. Falhar aqui não derruba a conversa.
    loadUnidentifiedSpend(client).catch(() => []),
  ]);
  const error =
    entries.error ??
    invoiceEntries.error ??
    bills.error ??
    cardLimits.error ??
    cards.error ??
    cycles.error ??
    invoicePayments.error ??
    vaults.error ??
    subscriptions.error ??
    benefitBalances.error;
  if (error) return { data: null, error };
  return {
    data: {
      entries: [...(entries.data ?? []), ...pendingEntries(pending)],
      invoiceEntries: [
        ...(invoiceEntries.data ?? []),
        ...pendingEntries(pending),
      ],
      bills: (bills.data ?? []) as CardBill[],
      cardLimits: (cardLimits.data ?? []) as FinancialAgentCardLimit[],
      cards: (cards.data ?? []) as PaymentCard[],
      cycles: (cycles.data ?? []) as CardCycle[],
      invoicePayments: (invoicePayments.data ?? []) as CardInvoicePayment[],
      vaults: (vaults.data ?? []) as FinancialAgentVault[],
      subscriptions: (subscriptions.data ?? []) as RecurringExpense[],
      benefitBalances: (benefitBalances.data ?? []) as BenefitCardBalance[],
    } satisfies FinancialAgentData,
    error: null,
  };
}
