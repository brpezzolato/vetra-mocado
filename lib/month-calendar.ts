import Decimal from 'decimal.js';
import { expectedNextDeposit } from './benefit-cards';
import {
  buildCreditCardInvoices,
  type CardBill,
  type CardInvoicePayment,
  type CardLimitInfo,
} from './card-invoices';
import {
  nextMonth,
  saoDate,
  type CardCycle,
  type RecurringExpense,
} from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import { FLASH_ACCOUNT } from './flash-statement';
import type { PaymentCard } from './payment-cards';

/**
 * Calendário do mês: vencimentos de fatura, cobranças de assinatura e
 * depósitos do Flash (feitos e o próximo esperado).
 * "Dia pesado" = quanto sai do bolso no dia. Assinatura no cartão aparece mas
 * não pesa (já está na fatura); só pesa a paga fora do cartão.
 */

export type CalendarEventKind =
  'invoice' | 'payment' | 'subscription' | 'benefit';

export type CalendarEvent = {
  kind: CalendarEventKind;
  day: string;
  title: string;
  amount: string | null;
  /** Se entra na conta do dia pesado. */
  weighs: boolean;
  /** Já aconteceu (fatura quitada, depósito recebido) ou ainda vai. */
  settled: boolean;
  /** Estimativa, não data marcada — o próximo depósito do Flash. */
  estimated: boolean;
  note?: string;
};

export type CalendarDay = {
  day: string;
  events: CalendarEvent[];
  /** Saída programada do dia: faturas e assinaturas fora do cartão. */
  outflow: string;
  /** O que foi gasto de fato, para os dias que já passaram. */
  spent: string | null;
};

export type MonthCalendar = {
  month: string;
  days: CalendarDay[];
  totalOutflow: string;
  heaviest: { day: string; outflow: string } | null;
};

const daysIn = (month: string) =>
  new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();

const addYear = (date: string) =>
  `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;

/** Cobranças do mês a partir da próxima data; as anteriores já estão nos lançamentos. */
export function subscriptionDays(item: RecurringExpense, month: string) {
  const days: string[] = [];
  let date = item.next_date;
  for (let guard = 0; guard < 60 && date.slice(0, 7) <= month; guard++) {
    if (date.slice(0, 7) === month) days.push(date);
    date =
      item.frequency === 'yearly'
        ? addYear(date)
        : nextMonth(date, item.billing_day);
  }
  return days;
}

export function monthCalendar({
  month,
  today,
  entries,
  cards,
  cycles,
  payments,
  subscriptions,
  invoiceEntries = entries,
  bills = [],
  limits = [],
}: {
  month: string;
  today: string;
  entries: FinancialEntry[];
  cards: PaymentCard[];
  cycles: CardCycle[];
  payments: CardInvoicePayment[];
  subscriptions: RecurringExpense[];
  /**
   * Mesmas entradas da tela de Faturas (inclusive "fora das contas"), faturas
   * publicadas e limite.
   */
  invoiceEntries?: FinancialEntry[];
  bills?: CardBill[];
  limits?: CardLimitInfo[];
}): MonthCalendar {
  const events: CalendarEvent[] = [];

  for (const { card, invoices } of buildCreditCardInvoices(
    invoiceEntries,
    cards,
    cycles,
    today,
    payments,
    bills,
    limits,
  ))
    for (const invoice of invoices) {
      // Pagamento pesa no dia real em que o banco o registrou; o vencimento de
      // fatura paga deixa de pesar. Paga no dia em que os pagamentos somados
      // atingem o valor; o que vem depois é antecipado e abate a seguinte.
      const charged = new Decimal(invoice.charged);
      let paidSoFar = new Decimal(0);
      let settledOn: string | null = null;
      for (const payment of invoice.paidOn) {
        const early = settledOn !== null;
        paidSoFar = paidSoFar.plus(payment.amount);
        if (!early && charged.gt(0) && paidSoFar.gte(charged))
          settledOn = payment.date;
        if (payment.date.slice(0, 7) !== month) continue;
        events.push({
          kind: 'payment',
          day: payment.date,
          title: early
            ? `Pagamento antecipado ${card.account}`
            : `Pagamento da fatura ${card.account}`,
          amount: payment.amount,
          weighs: true,
          settled: true,
          estimated: false,
          note: early
            ? 'Abate a próxima fatura'
            : `Fatura que vence em ${invoice.due.slice(8, 10)}/${invoice.due.slice(5, 7)}`,
        });
      }
      if (invoice.due.slice(0, 7) !== month) continue;
      const balance = new Decimal(invoice.balance);
      const total = new Decimal(invoice.total);
      if (total.isZero() && balance.isZero()) continue;
      const lastPayment = settledOn ?? invoice.paidOn.at(-1)?.date;
      events.push({
        kind: 'invoice',
        day: invoice.due,
        title: `Fatura ${card.account}`,
        // Paga: o valor que ela teve; senão, o que falta.
        amount: (balance.lte(0)
          ? new Decimal(invoice.charged)
          : balance
        ).toFixed(2),
        weighs: balance.gt(0),
        settled: balance.lte(0),
        estimated: false,
        note: balance.lte(0)
          ? lastPayment
            ? `Paga em ${lastPayment.slice(8, 10)}/${lastPayment.slice(5, 7)}`
            : 'Paga'
          : invoice.due > today && invoice.closing > today
            ? 'Ainda aberta: o valor pode subir'
            : undefined,
      });
    }

  const creditAccounts = new Set(
    cycles.filter((cycle) => cycle.kind === 'credit').map((c) => c.account),
  );
  for (const item of subscriptions) {
    if (!item.active || item.paid_by_me === false) continue;
    const onCard = creditAccounts.has(item.account);
    for (const day of subscriptionDays(item, month))
      events.push({
        kind: 'subscription',
        day,
        title: item.merchant,
        amount: new Decimal(item.amount).toFixed(2),
        weighs: !onCard,
        settled: false,
        estimated: false,
        note: onCard ? `No ${item.account}: já conta na fatura` : item.account,
      });
  }

  const deposits = entries.filter(
    (entry) => entry.account === FLASH_ACCOUNT && entry.entry_type === 'income',
  );
  const depositDays = [
    ...new Set(deposits.map((entry) => saoDate(entry.occurred_at))),
  ].sort();
  for (const day of depositDays.filter((value) => value.slice(0, 7) === month))
    events.push({
      kind: 'benefit',
      day,
      title: 'Depósito do Flash',
      amount: deposits
        .filter((entry) => saoDate(entry.occurred_at) === day)
        .reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0))
        .toFixed(2),
      weighs: false,
      settled: true,
      estimated: false,
    });
  const next = expectedNextDeposit(
    depositDays.filter((day) => day <= today),
    today,
  );
  if (next && next.slice(0, 7) === month)
    events.push({
      kind: 'benefit',
      day: next,
      title: 'Depósito do Flash',
      amount: null,
      weighs: false,
      settled: false,
      estimated: true,
      note: 'Previsto pelo intervalo de costume',
    });

  const spentByDay = new Map<string, Decimal>();
  for (const entry of entries) {
    if (entry.entry_type !== 'expense') continue;
    const day = saoDate(entry.occurred_at);
    if (day.slice(0, 7) !== month || day > today) continue;
    spentByDay.set(
      day,
      (spentByDay.get(day) ?? new Decimal(0)).plus(entry.amount),
    );
  }

  const days: CalendarDay[] = Array.from(
    { length: daysIn(month) },
    (_, index) => {
      const day = `${month}-${String(index + 1).padStart(2, '0')}`;
      const own = events.filter((event) => event.day === day);
      const outflow = own
        .filter((event) => event.weighs && event.amount)
        .reduce((sum, event) => sum.plus(event.amount!), new Decimal(0));
      return {
        day,
        events: own,
        outflow: outflow.toFixed(2),
        spent:
          day <= today
            ? (spentByDay.get(day) ?? new Decimal(0)).toFixed(2)
            : null,
      };
    },
  );

  const heaviest = days
    .filter((day) => new Decimal(day.outflow).gt(0))
    .sort((a, b) => new Decimal(b.outflow).cmp(a.outflow))[0];

  return {
    month,
    days,
    totalOutflow: days
      .reduce((sum, day) => sum.plus(day.outflow), new Decimal(0))
      .toFixed(2),
    heaviest: heaviest
      ? { day: heaviest.day, outflow: heaviest.outflow }
      : null,
  };
}
