import type { SupabaseClient } from '@supabase/supabase-js';
import { invoiceFor, type CardCycle } from '../expense-insights';
import type { PluggyClient } from './client';
import type { PluggyTransaction } from './types';

/* Pagamento de fatura que só aparece na conta corrente (o Itaú não o lista no
   cartão; 14/10/2026, R$ 42,65 no Platinum): a saída "Credit card payment" da
   corrente vira pagamento da fatura do cartão cujo limite usado caiu o mesmo
   valor. Grava em `card_invoice_payments` (as Faturas contam como pago) e em
   `card_payment_events` (a compra a chegar não confunde a queda). */

/** Diferença aceita entre o pagamento e a queda do limite. */
const TOLERANCE = 0.05;
const DAY = 86_400_000;
/** Quantos dias para trás a corrente é olhada. */
const LOOKBACK_DAYS = 45;

export type CheckingPayment = { id: string; date: string; amount: number };
export type LimitPoint = { account: string; seen: string; used: number };

/** Saídas da corrente que pagam fatura de cartão. */
export function checkingBillPayments(
  transactions: PluggyTransaction[],
): CheckingPayment[] {
  return transactions
    .filter(
      (transaction) =>
        transaction.type === 'DEBIT' &&
        transaction.category === 'Credit card payment' &&
        Number.isFinite(transaction.amount) &&
        transaction.amount !== 0,
    )
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      amount: Math.abs(transaction.amount),
    }));
}

/**
 * O cartão pago: o único do banco cuja foto do limite mostra o uso caindo o
 * valor do pagamento entre um dia antes e três depois dele. Mesmo com um
 * cartão só exige a queda: a corrente pode pagar a fatura de outro banco.
 * Sem cartão certo, `null` (nada é gravado).
 */
export function paidCard(
  payment: CheckingPayment,
  cards: string[],
  points: LimitPoint[],
): string | null {
  const at = Date.parse(payment.date);
  const matches = cards.filter((card) => {
    const shots = points
      .filter(
        (point) =>
          point.account === card &&
          Date.parse(point.seen) >= at - DAY &&
          Date.parse(point.seen) <= at + 3 * DAY,
      )
      .sort((a, b) => a.seen.localeCompare(b.seen));
    return shots.some((shot, index) => {
      const next = shots[index + 1];
      return (
        next !== undefined &&
        Math.abs(shot.used - next.used - payment.amount) <= TOLERANCE
      );
    });
  });
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * A fatura que o pagamento abate: a fechada que ainda não venceu, se houver;
 * senão, a aberta.
 */
export function invoiceDueForPayment(day: string, cycle: CardCycle) {
  const back = new Date(`${day}T12:00:00Z`);
  for (let days = 0; days <= 45; days++) {
    const date = new Date(back.getTime() - days * DAY)
      .toISOString()
      .slice(0, 10);
    const invoice = invoiceFor(date, cycle);
    if (invoice.closing <= day && invoice.due >= day) return invoice.due;
  }
  return invoiceFor(day, cycle).due;
}

const saoPauloDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(iso),
  );

/** Procura e grava os pagamentos de fatura feitos pela corrente. */
export async function syncCheckingBillPayments(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  links: {
    user_id: string;
    account: string;
    pluggy_item_id: string;
    kind: string;
  }[],
) {
  let saved = 0;
  const credit = links.filter((link) => link.kind === 'credit');
  const items = new Map<string, typeof credit>();
  for (const link of credit)
    items.set(link.pluggy_item_id, [
      ...(items.get(link.pluggy_item_id) ?? []),
      link,
    ]);
  const today = new Date();
  const from = new Date(today.getTime() - LOOKBACK_DAYS * DAY)
    .toISOString()
    .slice(0, 10);
  const to = today.toISOString().slice(0, 10);

  for (const [itemId, cards] of items) {
    const userId = cards[0]!.user_id;
    const accounts = await pluggy.listAccounts(itemId);
    const payments: CheckingPayment[] = [];
    for (const account of accounts.filter((item) => item.type === 'BANK'))
      payments.push(
        ...checkingBillPayments(
          await pluggy.listTransactions(account.id, from, to),
        ),
      );
    if (!payments.length) continue;
    const names = cards.map((card) => card.account);
    const [{ data: shots }, { data: events }, { data: cycles }] =
      await Promise.all([
        admin
          .from('card_limit_snapshots')
          .select('account, taken_at, data_at, credit_limit, available')
          .eq('user_id', userId)
          .in('account', names)
          .gte('taken_at', new Date(Date.parse(from) - DAY).toISOString()),
        admin
          .from('card_payment_events')
          .select('account, transaction_id, paid_on, amount')
          .eq('user_id', userId)
          .in('account', names),
        admin
          .from('card_cycles')
          .select('*')
          .eq('user_id', userId)
          .eq('kind', 'credit')
          .in('account', names),
      ]);
    const points: LimitPoint[] = (shots ?? []).map((shot) => ({
      account: shot.account as string,
      seen: (shot.data_at ?? shot.taken_at) as string,
      used: Number(shot.credit_limit) - Number(shot.available),
    }));
    for (const payment of payments) {
      const account = paidCard(payment, names, points);
      if (!account) continue;
      const day = saoPauloDay(payment.date);
      // O banco já mostrou este pagamento no cartão (Nubank): não duplica.
      const seen = (events ?? []).some(
        (event) =>
          event.account === account &&
          event.transaction_id !== payment.id &&
          event.paid_on === day &&
          Math.abs(Number(event.amount) - payment.amount) <= TOLERANCE,
      );
      if (seen) continue;
      const cycle = (cycles ?? []).find((item) => item.account === account) as
        CardCycle | undefined;
      if (!cycle) continue;
      const { error: paymentError } = await admin
        .from('card_invoice_payments')
        .upsert(
          {
            user_id: userId,
            account,
            invoice_due: invoiceDueForPayment(day, cycle),
            amount: payment.amount.toFixed(2),
            paid_at: payment.date,
            notes: 'Pago pela conta corrente (visto no banco)',
            pluggy_transaction_id: payment.id,
          },
          { onConflict: 'user_id,pluggy_transaction_id' },
        );
      if (paymentError) continue;
      await admin.from('card_payment_events').upsert(
        {
          user_id: userId,
          account,
          transaction_id: payment.id,
          paid_on: day,
          amount: payment.amount.toFixed(2),
        },
        { onConflict: 'user_id,transaction_id' },
      );
      saved++;
    }
  }
  return saved;
}
