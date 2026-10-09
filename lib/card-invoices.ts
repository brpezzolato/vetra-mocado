import Decimal from 'decimal.js';
import { invoiceFor, saoDate, type CardCycle } from './expense-insights';
import { monthDay, nextBusinessDay } from './card-due-dates';
import type { FinancialEntry } from './financial-tracker';
import type { PaymentCard } from './payment-cards';

/** Vencimento real: próximo dia útil quando o banco empurra (card-due-dates.ts). */
const settleDue = (due: string, cycle: CardCycle) =>
  cycle.due_rolls_forward ? nextBusinessDay(due) : due;

export function closingForDue(due: string, cycle: CardCycle) {
  // Fechamento conta do dia contratado, não do vencimento empurrado.
  const date = new Date(
    `${cycle.closing_offset_days != null ? monthDay(due.slice(0, 7), cycle.due_day) : due}T12:00:00Z`,
  );
  if (cycle.closing_offset_days != null) {
    date.setUTCDate(date.getUTCDate() - cycle.closing_offset_days);
    return date.toISOString().slice(0, 10);
  }
  const candidate = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      Math.min(
        cycle.closing_day,
        new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    ),
  );
  if (candidate >= date) {
    candidate.setUTCDate(0);
    candidate.setUTCDate(
      Math.min(
        cycle.closing_day,
        new Date(
          Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
  }
  return candidate.toISOString().slice(0, 10);
}

/**
 * Mês de gasto da fatura (yyyy-mm): o que concentra a maior parte do ciclo
 * (~15 dias antes do fechamento). Sem ciclo, fechamento = vencimento − 7 dias.
 */
export function invoiceSpendingMonth(due: string, cycle?: CardCycle | null) {
  const closing = new Date(
    `${cycle ? closingForDue(due, cycle) : due}T12:00:00Z`,
  );
  closing.setUTCDate(closing.getUTCDate() - (cycle ? 15 : 22));
  return closing.toISOString().slice(0, 7);
}

function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.toISOString().slice(0, 10);
}

export type CardInvoice = {
  account: string;
  bankId: PaymentCard['bank_id'];
  closing: string;
  due: string;
  /** Compras do ciclo menos estornos ("gasto do mês", no app do Nubank). */
  total: string;
  /** Compras − crédito da anterior + ajustes. Na fechada, igual ao total do banco. */
  charged: string;
  paid: string;
  /** O que falta pagar. */
  balance: string;
  /** O total que o banco cobrou, quando a fatura já fechou (`card_bills`). */
  bankTotal: string | null;
  minimum: string | null;
  /** Pago a mais na anterior e abatido desta (negativo). */
  carried: string | null;
  /** Diferença além de compras e crédito (encargos, juros, IOF). Sempre visível. */
  adjustments: string | null;
  /** O banco fechou e ela está paga. */
  settled: boolean;
  entries: FinancialEntry[];
  payments: CardInvoicePayment[];
  /** Pagamentos reais (do banco ou lançados), do mais antigo ao mais novo. */
  paidOn: { date: string; amount: string }[];
  current: boolean;
};

export type CardInvoicePayment = {
  id: string;
  user_id: string;
  account: string;
  invoice_due: string;
  amount: string | number;
  paid_at: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

/** Uma fatura fechada, como o banco informou pela Pluggy. */
export type CardBill = {
  account: string;
  due_date: string;
  closing_date: string | null;
  total: number | string;
  minimum: number | string | null;
  paid: number | string;
  /** Os pagamentos que o banco registrou, com o dia (`card_bills.payments`). */
  payments?: { date: string; amount: number | string }[] | null;
};

/** O limite do cartão, como o banco informou pela Pluggy. */
export type CardLimitInfo = {
  account: string;
  credit_limit: number | string | null;
  available_limit: number | string | null;
};

export type CreditCardInvoices = {
  card: PaymentCard;
  cycle: CardCycle;
  current: CardInvoice;
  invoices: CardInvoice[];
};

export function buildCreditCardInvoices(
  entries: FinancialEntry[],
  cards: PaymentCard[],
  cycles: CardCycle[],
  referenceDate = saoDate(new Date()),
  payments: CardInvoicePayment[] = [],
  bills: CardBill[] = [],
  limits: CardLimitInfo[] = [],
): CreditCardInvoices[] {
  return cards.flatMap((card) => {
    const cycle = cycles.find(
      (item) => item.account === card.account && item.kind === 'credit',
    );
    if (!cycle) return [];

    // O ciclo calcula o vencimento contratado; a fatura usa o real.
    const period = (day: string) => {
      const nominal = invoiceFor(day, cycle);
      return { closing: nominal.closing, due: settleDue(nominal.due, cycle) };
    };
    const nominalCurrentDue = invoiceFor(referenceDate, cycle).due;
    const currentPeriod = period(referenceDate);
    const grouped = new Map<
      string,
      {
        closing: string;
        entries: FinancialEntry[];
        refunds: FinancialEntry[];
        payments: CardInvoicePayment[];
      }
    >();
    for (const entry of entries) {
      // Receita na conta do cartão é estorno do banco: abate a fatura.
      if (entry.account !== card.account) continue;
      const calculated = period(saoDate(entry.occurred_at));
      const due = entry.invoice_due_override ?? calculated.due;
      const group = grouped.get(due) ?? {
        closing:
          due === calculated.due
            ? calculated.closing
            : closingForDue(due, cycle),
        entries: [],
        refunds: [],
        payments: [],
      };
      if (entry.entry_type === 'expense') group.entries.push(entry);
      else group.refunds.push(entry);
      grouped.set(due, group);
    }
    // Pagamento lançado à mão:
    // - fatura publicada pelo banco usa o pago do banco, sem somar o manual;
    // - em cartão do banco, pagamento sozinho não cria fatura (evita fantasmas).
    const fromBank = bills.some((bill) => bill.account === card.account);
    for (const payment of payments) {
      if (payment.account !== card.account) continue;
      if (
        bills.some(
          (bill) =>
            bill.account === card.account &&
            bill.due_date === payment.invoice_due,
        )
      )
        continue;
      if (fromBank && !grouped.has(payment.invoice_due)) continue;
      const group = grouped.get(payment.invoice_due) ?? {
        closing: closingForDue(payment.invoice_due, cycle),
        entries: [],
        refunds: [],
        payments: [],
      };
      group.payments.push(payment);
      grouped.set(payment.invoice_due, group);
    }
    if (!grouped.has(currentPeriod.due))
      grouped.set(currentPeriod.due, {
        closing: currentPeriod.closing,
        entries: [],
        refunds: [],
        payments: [],
      });
    for (const offset of [1, 2]) {
      const due = settleDue(addMonths(nominalCurrentDue, offset), cycle);
      if (grouped.has(due)) continue;
      grouped.set(due, {
        closing: closingForDue(due, cycle),
        entries: [],
        refunds: [],
        payments: [],
      });
    }

    // Fatura atual = a primeira ainda não vencida (entre fechamento e vencimento,
    // a fechada). Fechada já paga sai da frente.
    // Dívida pelo limite (limite − disponível) inclui aberta e parcelas, então
    // só subestima o pago, nunca inventa.
    const limit = limits.find((item) => item.account === card.account);
    const owed =
      limit?.credit_limit != null && limit.available_limit != null
        ? Decimal.max(
            new Decimal(limit.credit_limit).minus(limit.available_limit),
            0,
          )
        : null;
    const built = [...grouped]
      .map(([due, group]) => {
        const sum = (items: { amount: Decimal.Value }[]) =>
          items.reduce(
            (total, item) => total.plus(item.amount),
            new Decimal(0),
          );
        const total = sum(group.entries)
          .minus(sum(group.refunds))
          .toDecimalPlaces(2);
        // Fatura fechada pelo banco usa os dados dele; as outras, o ciclo e os
        // pagamentos lançados.
        const bill = bills.find(
          (item) => item.account === card.account && item.due_date === due,
        );
        const recorded = (
          bill
            ? new Decimal(bill.paid)
            : sum(group.payments.map((payment) => ({ amount: payment.amount })))
        ).toDecimalPlaces(2);
        // Crédito pago a mais na anterior passa para a seguinte ("pagamento
        // antecipado"). Fechada não paga não é dívida antes de vencer.
        const previous = bills
          .filter(
            (item) => item.account === card.account && item.due_date < due,
          )
          .sort((a, b) => b.due_date.localeCompare(a.due_date))[0];
        const nextAfterPrevious =
          previous &&
          ![...grouped.keys()].some(
            (other) => other > previous.due_date && other < due,
          );
        const carried =
          previous && nextAfterPrevious
            ? Decimal.min(
                new Decimal(previous.total).minus(previous.paid),
                0,
              ).toDecimalPlaces(2)
            : null;
        const expected = total.plus(carried ?? 0);
        const charged = bill ? new Decimal(bill.total) : expected;
        // O que o banco cobrou além de compras e crédito; deveria ser zero.
        const adjustments = bill ? charged.minus(expected) : new Decimal(0);
        // Fechada, não vencida e sem fatura da Pluggy: se o cartão deve menos que
        // ela cobra, a diferença foi paga (o limite atualiza antes).
        const closed =
          (bill?.closing_date ?? group.closing) <= referenceDate &&
          due >= referenceDate;
        const fromLimit =
          !bill && closed && owed !== null && charged.gt(0)
            ? Decimal.min(Decimal.max(charged.minus(owed), 0), charged)
            : null;
        const paid = (
          fromLimit && fromLimit.gt(recorded) ? fromLimit : recorded
        ).toDecimalPlaces(2);
        return {
          account: card.account,
          bankId: card.bank_id,
          closing: bill?.closing_date ?? group.closing,
          due,
          total: total.toFixed(2),
          charged: charged.toFixed(2),
          paid: paid.toFixed(2),
          balance: Decimal.max(charged.minus(paid), 0).toFixed(2),
          bankTotal: bill ? new Decimal(bill.total).toFixed(2) : null,
          carried: carried && !carried.isZero() ? carried.toFixed(2) : null,
          adjustments: adjustments.isZero() ? null : adjustments.toFixed(2),
          settled:
            (!!bill || (fromLimit !== null && charged.gt(0))) &&
            paid.gte(charged),
          closed,
          minimum:
            bill?.minimum === null || bill?.minimum === undefined
              ? null
              : new Decimal(bill.minimum).toFixed(2),
          entries: [...group.entries].sort((a, b) =>
            b.occurred_at.localeCompare(a.occurred_at),
          ),
          payments: [...group.payments].sort((a, b) =>
            b.paid_at.localeCompare(a.paid_at),
          ),
          paidOn: (bill?.payments?.length
            ? bill.payments.map((payment) => ({
                date: payment.date,
                amount: new Decimal(payment.amount).toFixed(2),
              }))
            : group.payments.map((payment) => ({
                date: saoDate(payment.paid_at),
                amount: new Decimal(payment.amount).toFixed(2),
              }))
          ).sort((a, b) => a.date.localeCompare(b.date)),
        };
      })
      .sort((a, b) => b.due.localeCompare(a.due));
    const upcoming = built
      .filter((invoice) => invoice.due >= referenceDate)
      .sort((a, b) => a.due.localeCompare(b.due));
    const currentDue = (
      upcoming.find((invoice) => !(invoice.closed && invoice.settled)) ??
      upcoming[0]
    ).due;
    const invoices: CardInvoice[] = built.map(({ closed: _, ...invoice }) => ({
      ...invoice,
      current: invoice.due === currentDue,
    }));
    return [
      {
        card,
        cycle,
        current: invoices.find((invoice) => invoice.current)!,
        invoices,
      },
    ];
  });
}

/**
 * Estágio com os nomes do Nubank: "fechada" (fechou, não venceu), "atual"
 * (recebendo compras), "próximas". Faturas e Vetra AI usam a mesma régua.
 */
export function invoiceStage(
  invoice: Pick<CardInvoice, 'due' | 'closing'>,
  invoices: Pick<CardInvoice, 'due' | 'closing'>[],
  today = saoDate(new Date()),
): 'anterior' | 'fechada' | 'atual' | 'próxima' {
  if (invoice.due < today) return 'anterior';
  if (invoice.closing <= today) return 'fechada';
  const open = invoices
    .filter((item) => item.due >= today && item.closing > today)
    .sort((a, b) => a.due.localeCompare(b.due))[0];
  return open?.due === invoice.due ? 'atual' : 'próxima';
}
