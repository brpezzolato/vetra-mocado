import { describe, expect, it } from 'vitest';
import {
  cardPayments,
  cleanDescription,
  mapCardTransactions,
  planCardWrites,
  type CardEntry,
} from './card-entries';
import type { PluggyTransaction } from './types';

// Tudo inventado, no formato real da Pluggy visto em 2026-09-30.
const tx = (extra: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: 't',
  accountId: 'cartao',
  date: '2026-09-14T15:46:21.001Z',
  amount: 50,
  type: 'DEBIT',
  status: 'POSTED',
  description: 'Drogasil1319',
  operationType: null,
  category: 'Pharmacy',
  merchantName: null,
  installment: {
    installmentNumber: null,
    totalInstallments: null,
    totalAmount: null,
    purchaseDate: null,
    billId: 'fatura-set',
    billForecastDate: null,
  },
  ...extra,
});

const credit = {
  account: 'Nubank Mastercard Gold',
  kind: 'credit' as const,
  billDue: new Map([['fatura-set', '2026-09-08']]),
  dueForMonth: (month: string) => `${month}-08`,
};

describe('transações de cartão de crédito', () => {
  it('compra lançada vai para a fatura que o banco diz, com o nome normalizado', () => {
    const [entry] = mapCardTransactions([tx({ id: 'a' })], credit);
    expect(entry).toMatchObject({
      externalId: 'a',
      entryType: 'expense',
      amount: '50.00',
      description: 'Drogasil',
      bankStatus: 'POSTED',
      invoiceDue: '2026-09-08',
      installment: null,
    });
  });

  it('pendente vai para a fatura prevista, com a parcela', () => {
    const [entry] = mapCardTransactions(
      [
        tx({
          id: 'p',
          status: 'PENDING',
          installment: {
            installmentNumber: 3,
            totalInstallments: 3,
            totalAmount: null,
            purchaseDate: '2026-09-14T15:46:21.001Z',
            billId: null,
            billForecastDate: '2026-11',
          },
        }),
      ],
      credit,
    );
    expect(entry.invoiceDue).toBe('2026-11-08');
    expect(entry.installment).toMatchObject({
      number: 3,
      total: 3,
      purchaseTotal: '150.00',
    });
  });

  it('as parcelas da mesma compra dividem o mesmo grupo', () => {
    const parcel = (id: string, number: number, amount: number) =>
      tx({
        id,
        amount,
        status: 'PENDING',
        installment: {
          installmentNumber: number,
          totalInstallments: 3,
          totalAmount: null,
          purchaseDate: '2026-09-14T15:46:21.001Z',
          billId: null,
          billForecastDate: '2026-10',
        },
      });
    const entries = mapCardTransactions(
      [parcel('1', 1, 33.34), parcel('2', 2, 33.33)],
      credit,
    );
    expect(entries[0].installment?.groupId).toBe(
      entries[1].installment?.groupId,
    );
  });

  it('pagamento de fatura fica de fora; estorno entra como receita', () => {
    const entries = mapCardTransactions(
      [
        tx({
          id: 'pag',
          type: 'CREDIT',
          amount: -2128.68,
          category: 'Credit card payment',
        }),
        tx({ id: 'est', type: 'CREDIT', amount: -80.67, category: 'Shopping' }),
      ],
      credit,
    );
    expect(entries.map((entry) => [entry.externalId, entry.entryType])).toEqual(
      [['est', 'income']],
    );
  });

  it('pendente com gêmea lançada é descartada', () => {
    const entries = mapCardTransactions(
      [
        tx({ id: 'lancada', date: '2026-09-09T10:00:00Z' }),
        tx({ id: 'pendente', status: 'PENDING', date: '2026-09-10T10:00:00Z' }),
      ],
      credit,
    );
    expect(entries.map((entry) => entry.externalId)).toEqual(['lancada']);
  });

  it('número de cartão não chega à descrição', () => {
    expect(cleanDescription('Pgto 5162920012345678 Loja')).not.toMatch(/5162/);
  });
});

describe('compras no débito dentro da conta corrente', () => {
  it('só entra o que foi no cartão', () => {
    const entries = mapCardTransactions(
      [
        tx({ id: 'cartao', operationType: 'CARTAO', installment: null }),
        tx({ id: 'pix', operationType: 'PIX', installment: null }),
      ],
      {
        account: 'Itaú Mastercard Platinum',
        kind: 'debit_purchases',
        billDue: new Map(),
      },
    );
    expect(
      entries.map((entry) => [entry.externalId, entry.invoiceDue]),
    ).toEqual([['cartao', null]]);
  });
});

describe('o que gravar', () => {
  const bankEntry = (extra: Partial<CardEntry>): CardEntry => ({
    externalId: 'x',
    entryType: 'expense',
    amount: '10.00',
    description: 'Loja',
    occurredAt: '2026-09-20T15:00:00Z',
    bankStatus: 'POSTED',
    invoiceDue: '2026-10-08',
    installment: null,
    ...extra,
  });
  const row = (extra: Record<string, unknown>) => ({
    id: 'r',
    external_id: 'x',
    entry_type: 'expense',
    amount: '10.00',
    occurred_at: '2026-09-20T15:00:00Z',
    bank_status: 'POSTED',
    invoice_due_override: '2026-10-08',
    installment_group_id: null,
    installment_number: null,
    ...extra,
  });

  it('insere o novo e não mexe no que não mudou', () => {
    const plan = planCardWrites(
      [bankEntry({}), bankEntry({ externalId: 'novo' })],
      [row({})],
      new Set(),
      '2026-08-01',
    );
    expect(plan.insert.map((entry) => entry.externalId)).toEqual(['novo']);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('atualiza o que o banco mudou, sem tocar em descrição ou categoria', () => {
    const plan = planCardWrites(
      [bankEntry({ bankStatus: 'POSTED', invoiceDue: '2026-10-08' })],
      [row({ bank_status: 'PENDING', invoice_due_override: null })],
      new Set(),
      '2026-08-01',
    );
    expect(plan.update).toEqual([
      {
        id: 'r',
        patch: { bank_status: 'POSTED', invoice_due_override: '2026-10-08' },
      },
    ]);
  });

  it('o "fora das contas" é dele: a sincronização não toca', () => {
    const plan = planCardWrites(
      [bankEntry({ excluded: false })],
      [row({ excluded_from_totals: true })],
      new Set(),
      '2026-08-01',
    );
    expect(plan.update).toEqual([]);
  });

  it('pendente que sumiu do banco sai; lançada que sumiu fica', () => {
    const plan = planCardWrites(
      [],
      [
        row({ id: 'p', external_id: 'p', bank_status: 'PENDING' }),
        row({ id: 'l', external_id: 'l', bank_status: 'POSTED' }),
      ],
      new Set(),
      '2026-08-01',
    );
    expect(plan.remove).toEqual(['p']);
  });

  it('compra apagada pelo Bruno e compra antes do início não entram', () => {
    const plan = planCardWrites(
      [
        bankEntry({ externalId: 'apagada' }),
        bankEntry({
          externalId: 'antiga',
          occurredAt: '2026-07-20T15:00:00Z',
          invoiceDue: null,
        }),
      ],
      [],
      new Set(['apagada']),
      '2026-08-01',
    );
    expect(plan.insert).toEqual([]);
  });
});

describe('corte da virada pela fatura', () => {
  it('parcela de compra antiga entra se a fatura dela está dentro', () => {
    const plan = planCardWrites(
      [
        {
          externalId: 'parcela',
          entryType: 'expense',
          amount: '100.00',
          description: 'Loja',
          occurredAt: '2026-06-10T15:00:00Z',
          bankStatus: 'POSTED',
          invoiceDue: '2026-09-08',
          installment: null,
        },
        {
          externalId: 'fatura-velha',
          entryType: 'expense',
          amount: '100.00',
          description: 'Loja',
          occurredAt: '2026-07-10T15:00:00Z',
          bankStatus: 'POSTED',
          invoiceDue: '2026-08-06',
          installment: null,
        },
      ],
      [],
      new Set(),
      '2026-09-01',
    );
    expect(plan.insert.map((entry) => entry.externalId)).toEqual(['parcela']);
  });
});

describe('pendente antes do corte, mas na fatura aberta', () => {
  it('entra pelo vencimento estimado do ciclo', () => {
    const plan = planCardWrites(
      [
        {
          externalId: 'picpay-2808',
          entryType: 'expense',
          amount: '20.00',
          description: 'Loja',
          occurredAt: '2026-08-28T15:00:00Z',
          bankStatus: 'PENDING',
          invoiceDue: null,
          installment: null,
        },
      ],
      [],
      new Set(),
      '2026-09-01',
      () => '2026-10-05',
    );
    expect(plan.insert.map((entry) => entry.externalId)).toEqual([
      'picpay-2808',
    ]);
  });
});

describe('mês previsto da fatura, no jeito de cada banco', () => {
  const pendingIn = (id: string, forecast: string) =>
    tx({
      id,
      status: 'PENDING',
      installment: {
        installmentNumber: null,
        totalInstallments: null,
        totalAmount: null,
        purchaseDate: null,
        billId: null,
        billForecastDate: forecast,
      },
    });

  it('Nubank conta pelo mês do vencimento', () => {
    const [entry] = mapCardTransactions([pendingIn('n', '2026-10')], {
      account: 'Nubank',
      kind: 'credit',
      billDue: new Map([['b', '2026-09-08']]),
      dueForMonth: (month: string) => `${month}-08`,
    });
    expect(entry.invoiceDue).toBe('2026-10-08');
  });

  it('PicPay conta pelo mês do fechamento', () => {
    const entries = mapCardTransactions(
      [pendingIn('a', '2026-09'), pendingIn('b', '2026-10')],
      {
        account: 'PicPay',
        kind: 'credit',
        billDue: new Map([['b', '2026-09-05']]),
        dueForMonth: (month: string) => `${month}-05`,
      },
    );
    expect(entries.map((entry) => entry.invoiceDue)).toEqual([
      '2026-10-05',
      '2026-11-05',
    ]);
  });
});

describe('parcelas pela sequência da compra', () => {
  const parcel = (
    id: string,
    number: number,
    status: string,
    billId: string | null,
    forecast: string | null,
  ) =>
    tx({
      id,
      amount: 76.41,
      status,
      description: 'Loja 8x',
      installment: {
        installmentNumber: number,
        totalInstallments: 8,
        totalAmount: null,
        purchaseDate: '2026-03-17T12:00:00Z',
        billId,
        billForecastDate: forecast,
      },
    });

  it('a última parcela vai um mês depois da anterior, mesmo com a previsão errada', () => {
    const entries = mapCardTransactions(
      [
        parcel('5', 5, 'POSTED', 'fatura-set', null),
        parcel('6', 6, 'PENDING', null, '2026-10'),
        parcel('7', 7, 'PENDING', null, '2026-11'),
        parcel('8', 8, 'PENDING', null, '2026-11'),
      ],
      credit,
    );
    expect(entries.map((entry) => entry.invoiceDue)).toEqual([
      '2026-09-08',
      '2026-10-08',
      '2026-11-08',
      '2026-12-08',
    ]);
  });
});

describe('parcela no fim da descrição', () => {
  it('sai do nome, e as parcelas da mesma compra ficam no mesmo grupo', () => {
    const parcel = (id: string, number: number) =>
      tx({
        id,
        description: `Loja Online ${number}/3`,
        status: 'PENDING',
        installment: {
          installmentNumber: number,
          totalInstallments: 3,
          totalAmount: null,
          purchaseDate: '2026-09-14T15:46:21.001Z',
          billId: null,
          billForecastDate: '2026-10',
        },
      });
    const entries = mapCardTransactions(
      [parcel('1', 1), parcel('2', 2)],
      credit,
    );
    expect(entries.map((entry) => entry.description)).toEqual([
      'Loja Online',
      'Loja Online',
    ]);
    expect(entries[0].installment?.groupId).toBe(
      entries[1].installment?.groupId,
    );
  });

  it('ajuste da previsão sai das compras já faturadas, não da pendente antiga (03/10/2026)', () => {
    const meta = (billId: string | null, forecast: string) => ({
      installmentNumber: null,
      totalInstallments: null,
      totalAmount: null,
      purchaseDate: null,
      billId,
      billForecastDate: forecast,
    });
    const entries = mapCardTransactions(
      [
        // Já na fatura de 06/10, com a previsão "2026-10": ajuste 0.
        tx({ id: 'faturada', installment: meta('fatura-out', '2026-10') }),
        // Pendente esquecida antes do fechamento, ainda com "2026-10".
        tx({
          id: 'antiga',
          status: 'PENDING',
          description: 'Cinemark Sao Caetano',
          installment: meta(null, '2026-10'),
        }),
        tx({
          id: 'nova',
          status: 'PENDING',
          description: 'Shopee *Aljatec',
          installment: meta(null, '2026-11'),
        }),
      ],
      {
        ...credit,
        billDue: new Map([['fatura-out', '2026-10-06']]),
        dueForMonth: (month: string) => `${month}-06`,
      },
    );
    expect(
      entries.find((entry) => entry.externalId === 'nova')?.invoiceDue,
    ).toBe('2026-11-06');
  });
});

describe('pagamentos de fatura na lista do cartão', () => {
  it('só a entrada de "Credit card payment" é pagamento', () => {
    const tx = (
      id: string,
      type: string,
      category: string | null,
      amount: number,
    ) => ({
      id,
      accountId: 'c',
      date: '2026-11-06T13:00:00Z',
      amount,
      type,
      status: 'POSTED',
      description: 'x',
      operationType: null,
      category,
      merchantName: null,
      installment: null,
    });
    expect(
      cardPayments([
        tx('p', 'CREDIT', 'Credit card payment', -44.71),
        tx('e', 'CREDIT', 'Shopping', 10),
        tx('c', 'DEBIT', 'Shopping', 20),
      ]),
    ).toEqual([{ transactionId: 'p', paidOn: '2026-11-06', amount: '44.71' }]);
  });

  it('o pagamento que o Nubank manda pendente e lançado conta uma vez', () => {
    const twin = (id: string, status: string) => ({
      id,
      accountId: 'c',
      date: '2026-09-23T13:00:00Z',
      amount: -4,
      type: 'CREDIT',
      status,
      description: 'Pagamento recebido',
      operationType: null,
      category: 'Credit card payment',
      merchantName: null,
      installment: null,
    });
    expect(
      cardPayments([twin('a', 'PENDING'), twin('b', 'POSTED')]).map(
        (payment) => payment.transactionId,
      ),
    ).toEqual(['b']);
  });
});
