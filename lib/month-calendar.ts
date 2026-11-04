import Decimal from 'decimal.js';
import { expectedNextDeposit } from './benefit-cards';
import {
  isFinancialBusinessDay,
  nationalHolidayNames,
} from './business-calendar';
import {
  buildCreditCardInvoices,
  type CardBill,
  type CardInvoicePayment,
  type CardLimitInfo,
} from './card-invoices';
import {
  chargeAfter,
  saoDate,
  type CardCycle,
  type RecurringExpense,
} from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import type { CustomCalendarItem } from './calendar-settings';
import { FLASH_ACCOUNT } from './flash-statement';
import type { PaymentCard } from './payment-cards';

/**
 * Calendário do mês: vencimentos de fatura (a paga sai e fica só o dia do
 * pagamento), cobranças de assinatura, depósitos do Flash (feitos e o próximo
 * esperado), salário e adiantamento (pela `IncomeSchedule`), feriados e
 * lembretes próprios (lib/calendar-settings.ts). Tipo escondido não entra.
 * "Dia pesado" = quanto sai do bolso no dia. Assinatura no cartão aparece mas
 * não pesa (já está na fatura); só pesa a paga fora do cartão.
 */

export type CalendarEventKind =
  | 'invoice'
  | 'payment'
  | 'subscription'
  | 'benefit'
  | 'salary'
  | 'advance'
  | 'holiday'
  | 'custom';

/** Quando caem o salário e o adiantamento (preferência `calendar`). */
export type IncomeSchedule = {
  salary: { enabled: boolean; day: 'last-business' | 'last' };
  /** No dia, ou no dia útil anterior se ele não for útil. */
  advance: { enabled: boolean; day: number };
};

export const DEFAULT_INCOME_SCHEDULE: IncomeSchedule = {
  salary: { enabled: true, day: 'last-business' },
  advance: { enabled: true, day: 15 },
};

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
  /** O lembrete próprio (`kind: 'custom'`). */
  itemId?: string;
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

const shiftDay = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** O próprio dia, se útil; senão o dia útil anterior. */
export function businessDayOnOrBefore(day: string) {
  let date = day;
  while (!isFinancialBusinessDay(new Date(`${date}T12:00:00Z`)))
    date = shiftDay(date, -1);
  return date;
}

/** Dias previstos do salário e do adiantamento no mês. */
export function incomeDays(month: string, schedule: IncomeSchedule) {
  const last = `${month}-${String(daysIn(month)).padStart(2, '0')}`;
  const days: {
    kind: 'salary' | 'advance';
    title: 'Salário' | 'Adiantamento';
    day: string;
  }[] = [];
  if (schedule.advance.enabled) {
    const day = Math.min(Math.max(1, schedule.advance.day), daysIn(month));
    days.push({
      kind: 'advance',
      title: 'Adiantamento',
      day: businessDayOnOrBefore(`${month}-${String(day).padStart(2, '0')}`),
    });
  }
  if (schedule.salary.enabled)
    days.push({
      kind: 'salary',
      title: 'Salário',
      day: schedule.salary.day === 'last' ? last : businessDayOnOrBefore(last),
    });
  return days;
}

/** Dia do lembrete próprio no mês. */
export function customDay(
  month: string,
  item: Pick<CustomCalendarItem, 'day' | 'businessBefore'>,
) {
  const day =
    item.day === 'last' ? daysIn(month) : Math.min(item.day, daysIn(month));
  const date = `${month}-${String(Math.max(1, day)).padStart(2, '0')}`;
  return item.businessBefore ? businessDayOnOrBefore(date) : date;
}

/** Cobranças do mês a partir da próxima data; as anteriores já estão nos lançamentos. */
export function subscriptionDays(item: RecurringExpense, month: string) {
  const days: string[] = [];
  let date = item.next_date;
  for (let guard = 0; guard < 60 && date.slice(0, 7) <= month; guard++) {
    if (date.slice(0, 7) === month) days.push(date);
    date = chargeAfter(item, date);
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
  income = DEFAULT_INCOME_SCHEDULE,
  custom = [],
  hidden = [],
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
  income?: IncomeSchedule;
  custom?: CustomCalendarItem[];
  /** Tipos escondidos (`invoice`, `custom:<id>`…): não aparecem nem pesam. */
  hidden?: string[];
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
      // Paga: fica só o dia do pagamento, que já tem o seu evento.
      if (balance.lte(0) && lastPayment) continue;
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

  for (const { kind, title, day } of incomeDays(month, income)) {
    const ofKind = entries.filter(
      (entry) => entry.entry_type === 'income' && entry.category === title,
    );
    // Já caiu: o que entrou com essa categoria perto do dia previsto.
    const received = ofKind.filter((entry) => {
      const on = saoDate(entry.occurred_at);
      return on >= shiftDay(day, -7) && on <= shiftDay(day, 5);
    });
    const last = ofKind
      .filter((entry) => saoDate(entry.occurred_at) < day)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
    const receivedOn = received
      .map((entry) => saoDate(entry.occurred_at))
      .sort()
      .at(-1);
    events.push({
      kind,
      day,
      title,
      amount: received.length
        ? received
            .reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0))
            .toFixed(2)
        : last
          ? new Decimal(last.amount).toFixed(2)
          : null,
      weighs: false,
      settled: received.length > 0,
      estimated: !received.length,
      note: receivedOn
        ? `Recebido em ${receivedOn.slice(8, 10)}/${receivedOn.slice(5, 7)}`
        : last
          ? 'Previsto pelo último recebido'
          : 'Previsto',
    });
  }

  for (const [day, name] of nationalHolidayNames(Number(month.slice(0, 4))))
    if (day.slice(0, 7) === month)
      events.push({
        kind: 'holiday',
        day,
        title: name,
        amount: null,
        weighs: false,
        settled: false,
        estimated: false,
        note: 'Feriado nacional',
      });

  for (const item of custom)
    events.push({
      kind: 'custom',
      itemId: item.id,
      day: customDay(month, item),
      title: item.label,
      amount: null,
      weighs: false,
      settled: false,
      estimated: false,
    });

  const hiddenKeys = new Set(hidden);
  const shown = events.filter(
    (event) =>
      !hiddenKeys.has(
        event.kind === 'custom' ? `custom:${event.itemId}` : event.kind,
      ),
  );

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
      const own = shown.filter((event) => event.day === day);
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
