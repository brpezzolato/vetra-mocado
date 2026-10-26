import { describe, expect, it } from 'vitest';
import { buildCreditCardInvoices, invoiceSpendingMonth } from './card-invoices';
import type { CardCycle } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';
import type { PaymentCard } from './payment-cards';

const card = (
  account: string,
  bankId: PaymentCard['bank_id'],
): PaymentCard => ({
  user_id: 'user',
  account,
  bank_id: bankId,
  created_at: '',
  updated_at: '',
});
const entry = (
  id: string,
  account: string,
  amount: string,
  occurredAt: string,
): FinancialEntry => ({
  id,
  user_id: 'user',
  entry_type: 'expense',
  amount,
  description: id,
  category: 'Outros',
  account,
  occurred_at: occurredAt,
  source: 'manual',
  external_id: null,
  created_at: occurredAt,
  updated_at: occurredAt,
});

describe('credit card invoices', () => {
  it('groups only credit-card purchases into their calculated invoice', () => {
    const result = buildCreditCardInvoices(
      [
        entry('nubank-a', 'Nubank', '10.00', '2026-09-10T12:00:00Z'),
        entry('nubank-b', 'Nubank', '5.50', '2026-09-11T12:00:00Z'),
        entry('pix', 'Pix', '90.00', '2026-09-11T12:00:00Z'),
      ],
      [card('Nubank', 'nubank'), card('Pix', 'other')],
      [
        {
          account: 'Nubank',
          kind: 'credit',
          closing_day: 1,
          due_day: 6,
          closing_offset_days: 7,
        },
      ],
      '2026-09-11',
    );
    expect(result).toHaveLength(1);
    expect(result[0].current.due).toBe('2026-10-06');
    expect(result[0].current.closing).toBe('2026-09-29');
    expect(result[0].current.total).toBe('15.50');
    expect(result[0].current.entries.map((item) => item.id)).toEqual([
      'nubank-b',
      'nubank-a',
    ]);
  });

  it('keeps the current invoice visible when it has no purchases', () => {
    const result = buildCreditCardInvoices(
      [],
      [card('PicPay', 'picpay')],
      [
        {
          account: 'PicPay',
          kind: 'credit',
          closing_day: 1,
          due_day: 5,
          closing_offset_days: 6,
        },
      ],
      '2026-09-11',
    );
    expect(result[0].current).toMatchObject({
      due: '2026-10-05',
      closing: '2026-09-29',
      total: '0.00',
      current: true,
    });
    expect(result[0].invoices.map((item) => item.due)).toEqual([
      '2026-12-05',
      '2026-11-05',
      '2026-10-05',
    ]);
  });

  it('subtracts advance payments from the invoice balance', () => {
    const result = buildCreditCardInvoices(
      [entry('picpay-a', 'PicPay', '90.00', '2026-09-10T12:00:00Z')],
      [card('PicPay', 'picpay')],
      [
        {
          account: 'PicPay',
          kind: 'credit',
          closing_day: 1,
          due_day: 5,
          closing_offset_days: 6,
        },
      ],
      '2026-09-11',
      [
        {
          id: 'payment',
          user_id: 'user',
          account: 'PicPay',
          invoice_due: '2026-10-05',
          amount: '35.50',
          paid_at: '2026-09-11T12:00:00Z',
          created_at: '2026-09-11T12:00:00Z',
          updated_at: '2026-09-11T12:00:00Z',
        },
      ],
    );
    expect(result[0].current).toMatchObject({
      total: '90.00',
      paid: '35.50',
      balance: '54.50',
    });
  });

  it('keeps the original purchase date while assigning an invoice override', () => {
    const laundry = entry('laundry', 'PicPay', '29.00', '2026-08-28T16:42:00Z');
    laundry.invoice_due_override = '2026-10-05';
    const result = buildCreditCardInvoices(
      [laundry],
      [card('PicPay', 'picpay')],
      [
        {
          account: 'PicPay',
          kind: 'credit',
          closing_day: 1,
          due_day: 5,
          closing_offset_days: 6,
        },
      ],
      '2026-09-11',
    );
    expect(result[0].current.entries.map((item) => item.id)).toEqual([
      'laundry',
    ]);
    expect(result[0].current.closing).toBe('2026-09-29');
  });

  it('a fatura fechada continua sendo a atual até o vencimento', () => {
    const cycles = [
      {
        account: 'Nubank',
        kind: 'credit' as const,
        closing_day: 1,
        due_day: 6,
        closing_offset_days: 7,
      },
    ];
    const purchases = [
      entry('setembro', 'Nubank', '100.00', '2026-09-20T12:00:00Z'),
      entry('outubro', 'Nubank', '40.00', '2026-10-02T12:00:00Z'),
    ];
    // A fatura que vence em 06/10 fecha em 29/09. Em 02/10 ela já fechou,
    // e é a que o banco está cobrando.
    const build = (today: string) =>
      buildCreditCardInvoices(
        purchases,
        [card('Nubank', 'nubank')],
        cycles,
        today,
      )[0];
    const afterClosing = build('2026-10-02');
    expect(afterClosing.current).toMatchObject({
      due: '2026-10-06',
      total: '100.00',
      current: true,
    });
    // A que abriu no fechamento é a próxima, não a atual.
    expect(
      afterClosing.invoices.find((item) => item.due === '2026-11-06')?.current,
    ).toBe(false);
    // No dia do vencimento ainda é a atual; no dia seguinte, não.
    expect(build('2026-10-06').current.due).toBe('2026-10-06');
    expect(build('2026-10-07').current.due).toBe('2026-11-06');
  });
});

describe('faturas com os dados do banco', () => {
  const nubank = card('Nubank', 'nubank');
  const cycle = {
    account: 'Nubank',
    kind: 'credit' as const,
    closing_day: 30,
    due_day: 8,
    closing_offset_days: 9,
  };
  const bills = [
    {
      account: 'Nubank',
      due_date: '2026-08-06',
      closing_date: '2026-07-30',
      total: '1794.57',
      minimum: null,
      paid: '1850.32',
    },
    {
      account: 'Nubank',
      due_date: '2026-09-08',
      closing_date: '2026-08-30',
      total: '2128.68',
      minimum: '271.91',
      paid: '2227.70',
    },
  ];
  const onInvoice = (id: string, amount: string, due: string) => ({
    ...entry(id, 'Nubank', amount, '2026-09-15T12:00:00Z'),
    invoice_due_override: due,
  });

  it('fatura fechada mostra o total, o fechamento e o pagamento do banco', () => {
    const [result] = buildCreditCardInvoices(
      [onInvoice('a', '2184.43', '2026-09-08')],
      [nubank],
      [cycle],
      '2026-09-30',
      [],
      bills,
    );
    const closed = result.invoices.find((item) => item.due === '2026-09-08')!;
    // Como o app do Nubank mostra: gasto do mês 2.184,43, pagamento
    // antecipado −55,75, fatura paga 2.128,68.
    expect(closed).toMatchObject({
      closing: '2026-08-30',
      total: '2184.43',
      carried: '-55.75',
      charged: '2128.68',
      adjustments: null,
      bankTotal: '2128.68',
      minimum: '271.91',
      paid: '2227.70',
      balance: '0.00',
      settled: true,
    });
  });

  it('a fatura aberta desconta o que foi pago a mais na anterior', () => {
    const [result] = buildCreditCardInvoices(
      [onInvoice('b', '1000.00', '2026-10-08')],
      [nubank],
      [cycle],
      '2026-09-30',
      [],
      bills,
    );
    const open = result.invoices.find((item) => item.due === '2026-10-08')!;
    expect(open).toMatchObject({
      total: '1000.00',
      carried: '-99.02',
      balance: '900.98',
      bankTotal: null,
    });
  });

  it('estorno na conta do cartão abate a fatura', () => {
    const [result] = buildCreditCardInvoices(
      [
        onInvoice('compra', '100.00', '2026-11-08'),
        {
          ...onInvoice('estorno', '30.00', '2026-11-08'),
          entry_type: 'income',
        },
      ],
      [nubank],
      [cycle],
      '2026-09-30',
      [],
      bills,
    );
    const invoice = result.invoices.find((item) => item.due === '2026-11-08')!;
    expect(invoice.total).toBe('70.00');
    expect(invoice.entries.map((item) => item.id)).toEqual(['compra']);
  });
});

describe('cartão que vem do banco', () => {
  it('ignora pagamento lançado à mão, que criaria uma fatura fantasma', () => {
    const [result] = buildCreditCardInvoices(
      [
        {
          ...entry('compra', 'Nubank', '100.00', '2026-09-15T12:00:00Z'),
          invoice_due_override: '2026-10-08',
        },
      ],
      [card('Nubank', 'nubank')],
      [
        {
          account: 'Nubank',
          kind: 'credit',
          closing_day: 30,
          due_day: 8,
          closing_offset_days: 9,
        },
      ],
      '2026-09-30',
      [
        {
          id: 'p',
          user_id: 'user',
          account: 'Nubank',
          invoice_due: '2026-10-06',
          amount: '50',
          paid_at: '2026-09-08T15:00:00Z',
          created_at: '',
          updated_at: '',
        },
      ],
      [
        {
          account: 'Nubank',
          due_date: '2026-09-08',
          closing_date: '2026-08-30',
          total: '2128.68',
          minimum: null,
          paid: '2227.70',
        },
      ],
    );
    expect(result.invoices.some((item) => item.due === '2026-10-06')).toBe(
      false,
    );
    expect(
      result.invoices.find((item) => item.due === '2026-10-08')?.carried,
    ).toBe('-99.02');
  });
});

describe('cartão novo cuja primeira fatura fecha depois do ciclo de agora', () => {
  // Itaú Crédito: aberto em outubro, ciclo 29/7, e o banco pôs as compras de
  // outubro na fatura de dezembro (primeira fechando em 29/11).
  const cycle = {
    account: 'Itaú Crédito',
    kind: 'credit' as const,
    closing_day: 29,
    due_day: 7,
    closing_offset_days: null,
  };
  const payment = {
    id: 'p',
    user_id: 'user',
    account: 'Itaú Crédito',
    invoice_due: '2026-11-07',
    amount: '62.39',
    paid_at: '2026-10-16T15:40:00Z',
    created_at: '',
    updated_at: '',
  };

  it('não mostra a fatura de 07/11 vazia e o pagamento abate a primeira', () => {
    const [result] = buildCreditCardInvoices(
      [
        {
          ...entry('a', 'Itaú Crédito', '508.60', '2026-10-13T12:00:00Z'),
          invoice_due_override: '2026-12-07',
        },
      ],
      [card('Itaú Crédito', 'itau')],
      [cycle],
      '2026-10-26',
      [payment],
    );
    expect(result.invoices.some((item) => item.due === '2026-11-07')).toBe(
      false,
    );
    expect(result.current.due).toBe('2026-12-07');
    expect(result.current.closing).toBe('2026-11-29');
    expect(result.current.balance).toBe('446.21');
  });

  it('sem a previsão do banco, segue o ciclo cadastrado', () => {
    const [result] = buildCreditCardInvoices(
      [entry('a', 'Itaú Crédito', '508.60', '2026-10-13T12:00:00Z')],
      [card('Itaú Crédito', 'itau')],
      [cycle],
      '2026-10-26',
      [payment],
    );
    expect(result.current.due).toBe('2026-11-07');
  });
});

describe('fatura fechada que não fecha só com compras e crédito', () => {
  it('mostra a diferença como ajuste do banco, sem esconder', () => {
    const [result] = buildCreditCardInvoices(
      [
        {
          ...entry('compra', 'PicPay', '273.67', '2026-07-20T12:00:00Z'),
          invoice_due_override: '2026-08-05',
        },
      ],
      [card('PicPay', 'picpay')],
      [
        {
          account: 'PicPay',
          kind: 'credit',
          closing_day: 27,
          due_day: 5,
          closing_offset_days: 9,
        },
      ],
      '2026-09-30',
      [],
      [
        {
          account: 'PicPay',
          due_date: '2026-08-05',
          closing_date: '2026-07-30',
          total: '274.40',
          minimum: null,
          paid: '274.40',
        },
      ],
    );
    const invoice = result.invoices.find((item) => item.due === '2026-08-05')!;
    expect(invoice).toMatchObject({
      charged: '274.40',
      adjustments: '0.73',
      settled: true,
    });
  });

  describe('closed invoice already paid (03/10/2026)', () => {
    const nubankCycle = {
      account: 'Nubank',
      kind: 'credit' as const,
      closing_day: 1,
      due_day: 6,
      closing_offset_days: 7,
    };
    const picpayCycle = {
      account: 'PicPay',
      kind: 'credit' as const,
      closing_day: 26,
      due_day: 5,
    };

    it('moves to the next invoice once the bank says the closed one is paid', () => {
      const [result] = buildCreditCardInvoices(
        [
          entry('old', 'Nubank', '2332.60', '2026-09-20T12:00:00Z'),
          entry('new', 'Nubank', '295.03', '2026-10-01T12:00:00Z'),
        ],
        [card('Nubank', 'nubank')],
        [nubankCycle],
        '2026-10-03',
        [],
        [
          {
            account: 'Nubank',
            due_date: '2026-10-06',
            closing_date: '2026-09-29',
            total: 2332.6,
            minimum: null,
            paid: 2332.6,
          },
        ],
      );
      expect(result.current.due).toBe('2026-11-06');
      expect(result.current.charged).toBe('295.03');
    });

    it('keeps an unpaid closed invoice in front', () => {
      const [result] = buildCreditCardInvoices(
        [entry('old', 'Nubank', '2332.60', '2026-09-20T12:00:00Z')],
        [card('Nubank', 'nubank')],
        [nubankCycle],
        '2026-10-03',
        [],
        [
          {
            account: 'Nubank',
            due_date: '2026-10-06',
            closing_date: '2026-09-29',
            total: 2332.6,
            minimum: null,
            paid: 0,
          },
        ],
      );
      expect(result.current.due).toBe('2026-10-06');
      expect(result.current.balance).toBe('2332.60');
    });

    it('reads the payment from the limit when the bank has not sent the bill', () => {
      const build = (available: number) =>
        buildCreditCardInvoices(
          [entry('compra', 'PicPay', '564.28', '2026-09-10T12:00:00Z')],
          [card('PicPay', 'picpay')],
          [picpayCycle],
          '2026-10-03',
          [],
          [],
          [
            {
              account: 'PicPay',
              credit_limit: 600,
              available_limit: available,
            },
          ],
        )[0];
      const paid = build(600);
      const closed = paid.invoices.find((item) => item.due === '2026-10-05')!;
      expect(closed.paid).toBe('564.28');
      expect(closed.balance).toBe('0.00');
      expect(paid.current.due).not.toBe('2026-10-05');
      // Limite ainda tomado: nada foi pago.
      const unpaid = build(35.72);
      expect(unpaid.current.due).toBe('2026-10-05');
      expect(unpaid.current.balance).toBe('564.28');
    });
  });

  describe('pagamento lançado à mão', () => {
    const cycle = {
      account: 'Nubank',
      kind: 'credit' as const,
      closing_day: 1,
      due_day: 6,
      closing_offset_days: 7,
    };
    const payment = (due: string, amount: string) => ({
      id: due,
      user_id: 'user',
      account: 'Nubank',
      invoice_due: due,
      amount,
      paid_at: '2026-10-01T12:00:00Z',
      created_at: '',
      updated_at: '',
    });
    const bill = {
      account: 'Nubank',
      due_date: '2026-10-06',
      closing_date: '2026-09-29',
      total: 100,
      minimum: null,
      paid: 100,
    };

    it('não soma por cima do pago que o banco publicou', () => {
      const [result] = buildCreditCardInvoices(
        [entry('a', 'Nubank', '100.00', '2026-09-20T12:00:00Z')],
        [card('Nubank', 'nubank')],
        [cycle],
        '2026-10-03',
        [payment('2026-10-06', '40.00')],
        [bill],
      );
      const october = result.invoices.find((i) => i.due === '2026-10-06')!;
      expect(october.paid).toBe('100.00');
    });

    it('conta na fatura ainda sem fatura do banco', () => {
      const [result] = buildCreditCardInvoices(
        [entry('b', 'Nubank', '80.00', '2026-10-02T12:00:00Z')],
        [card('Nubank', 'nubank')],
        [cycle],
        '2026-10-03',
        [payment('2026-11-06', '30.00')],
        [bill],
      );
      expect(result.current.due).toBe('2026-11-06');
      expect(result.current.balance).toBe('50.00');
    });

    it('não cria fatura fantasma num cartão que vem do banco', () => {
      const [result] = buildCreditCardInvoices(
        [],
        [card('Nubank', 'nubank')],
        [cycle],
        '2026-10-03',
        [payment('2026-08-15', '30.00')],
        [bill],
      );
      expect(result.invoices.some((i) => i.due === '2026-08-15')).toBe(false);
    });
  });

  describe('mês de gasto de uma fatura', () => {
    const nubank = {
      account: 'Nubank',
      kind: 'credit' as const,
      due_day: 6,
      closing_day: 29,
      closing_offset_days: 7,
      due_rolls_forward: true,
    } as unknown as CardCycle;

    it('a fatura de 06/11 é o gasto de outubro; a de 07/12, o de novembro', () => {
      expect(invoiceSpendingMonth('2026-11-06', nubank)).toBe('2026-10');
      expect(invoiceSpendingMonth('2026-12-07', nubank)).toBe('2026-11');
    });

    it('vencimento no fim do mês: o ciclo é quase todo do próprio mês', () => {
      const late = {
        ...nubank,
        due_day: 28,
        closing_offset_days: 7,
      } as CardCycle;
      expect(invoiceSpendingMonth('2026-11-28', late)).toBe('2026-11');
    });

    it('sem o ciclo do cartão, estima o fechamento 7 dias antes', () => {
      expect(invoiceSpendingMonth('2026-11-06')).toBe('2026-10');
    });
  });
});
