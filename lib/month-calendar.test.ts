import { describe, expect, it } from 'vitest';
import type { CardCycle, RecurringExpense } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import { monthCalendar } from './month-calendar';
import type { PaymentCard } from './payment-cards';

let counter = 0;
const entry = (
  occurred_at: string,
  amount: string,
  extra: Partial<FinancialEntry> = {},
): FinancialEntry => ({
  id: `entry-${counter++}`,
  user_id: 'user',
  entry_type: 'expense',
  amount,
  description: 'Compra',
  category: 'Outros',
  account: 'Nubank',
  occurred_at,
  source: 'manual',
  external_id: null,
  created_at: occurred_at,
  updated_at: occurred_at,
  ...extra,
});

const cards: PaymentCard[] = [
  {
    user_id: 'user',
    account: 'Nubank',
    bank_id: 'nubank',
    created_at: '',
    updated_at: '',
  },
];
const cycles: CardCycle[] = [
  {
    account: 'Nubank',
    kind: 'credit',
    closing_day: 1,
    due_day: 6,
    closing_offset_days: 7,
  },
];
const subscription = (
  merchant: string,
  account: string,
  next_date: string,
  extra: Partial<RecurringExpense> = {},
): RecurringExpense => ({
  id: merchant,
  merchant,
  account,
  amount: '20.00',
  next_date,
  billing_day: Number(next_date.slice(8)),
  active: true,
  paid_by_me: true,
  frequency: 'monthly',
  ...extra,
});

const build = (
  entries: FinancialEntry[],
  subscriptions: RecurringExpense[] = [],
) =>
  monthCalendar({
    month: '2026-10',
    today: '2026-10-02',
    entries,
    cards,
    cycles,
    payments: [],
    subscriptions,
  });
const on = (calendar: ReturnType<typeof build>, day: string) =>
  calendar.days.find((item) => item.day === day)!;

describe('calendário do mês', () => {
  it('marca o vencimento da fatura com o saldo a pagar', () => {
    const calendar = build([entry('2026-09-20T12:00:00Z', '100.00')]);
    const due = on(calendar, '2026-10-06');
    expect(due.events).toMatchObject([
      { kind: 'invoice', title: 'Fatura Nubank', amount: '100.00' },
    ]);
    expect(due.outflow).toBe('100.00');
    expect(calendar.heaviest).toEqual({ day: '2026-10-06', outflow: '100.00' });
  });

  it('assinatura no cartão aparece mas não pesa no dia; fora do cartão pesa', () => {
    const calendar = build(
      [],
      [
        subscription('Streaming', 'Nubank', '2026-10-15'),
        subscription('Academia', 'Pix', '2026-10-10', { amount: '99.90' }),
      ],
    );
    const streaming = on(calendar, '2026-10-15');
    expect(streaming.events[0]).toMatchObject({
      title: 'Streaming',
      weighs: false,
    });
    expect(streaming.outflow).toBe('0.00');
    expect(on(calendar, '2026-10-10').outflow).toBe('99.90');
  });

  it('projeta a assinatura mensal e ignora a anual fora do mês', () => {
    const calendar = monthCalendar({
      month: '2026-11',
      today: '2026-10-02',
      entries: [],
      cards,
      cycles,
      payments: [],
      subscriptions: [
        subscription('Mensal', 'Pix', '2026-10-31'),
        subscription('Anual', 'Pix', '2026-10-05', { frequency: 'yearly' }),
      ],
    });
    // 31/10 com dia de cobrança 31 cai em 30/11, o último dia do mês.
    expect(on(calendar, '2026-11-30').events[0]?.title).toBe('Mensal');
    expect(
      calendar.days.some((day) =>
        day.events.some((event) => event.title === 'Anual'),
      ),
    ).toBe(false);
  });

  it('mostra o depósito do Flash que caiu e o próximo previsto', () => {
    const flash = (day: string) =>
      entry(`${day}T15:00:00Z`, '900.00', {
        entry_type: 'income',
        account: 'Flash',
      });
    const calendar = monthCalendar({
      month: '2026-10',
      today: '2026-10-02',
      entries: [flash('2026-08-23'), flash('2026-09-22')],
      cards,
      cycles,
      payments: [],
      subscriptions: [],
    });
    expect(on(calendar, '2026-10-22').events[0]).toMatchObject({
      kind: 'benefit',
      estimated: true,
      amount: null,
    });
    // Depósito não é saída.
    expect(on(calendar, '2026-10-22').outflow).toBe('0.00');
  });

  it('soma o gasto real só dos dias que já passaram', () => {
    const calendar = build([
      entry('2026-10-01T15:00:00Z', '12.00'),
      entry('2026-10-01T18:00:00Z', '8.00'),
    ]);
    expect(on(calendar, '2026-10-01').spent).toBe('20.00');
    expect(on(calendar, '2026-10-03').spent).toBeNull();
  });

  it('mostra o dia em que a fatura foi paga e separa o pagamento antecipado', () => {
    const calendar = monthCalendar({
      month: '2026-10',
      today: '2026-10-05',
      entries: [],
      invoiceEntries: [entry('2026-09-20T15:00:00Z', '100.00')],
      cards,
      cycles,
      payments: [],
      subscriptions: [],
      bills: [
        {
          account: 'Nubank',
          due_date: '2026-10-06',
          closing_date: '2026-09-29',
          total: 100,
          minimum: null,
          paid: 130,
          payments: [
            { date: '2026-10-02', amount: 100 },
            { date: '2026-10-04', amount: 30 },
          ],
        },
      ],
    });
    const paid = on(calendar, '2026-10-02').events.find(
      (event) => event.kind === 'payment',
    )!;
    expect(paid.title).toBe('Pagamento da fatura Nubank');
    expect(paid.amount).toBe('100.00');
    expect(paid.weighs).toBe(true);
    const early = on(calendar, '2026-10-04').events.find(
      (event) => event.kind === 'payment',
    )!;
    expect(early.title).toBe('Pagamento antecipado Nubank');
    const due = on(calendar, '2026-10-06').events.find(
      (event) => event.kind === 'invoice',
    )!;
    expect(due.note).toBe('Paga em 02/10');
    expect(due.weighs).toBe(false);
  });
});
