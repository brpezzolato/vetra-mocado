import { describe, expect, it } from 'vitest';
import type {
  PluggyInvestmentLot,
  PluggyInvestmentMovement,
  PluggyTransaction,
} from './types';
import {
  archiveStillCovers,
  lotMovements,
  planMovementWrites,
  explainBalance,
  reserveMovements,
  reserveSnapshot,
  saoPauloDay,
} from './vault-movements';

// Tudo inventado, no formato real da Pluggy visto em 2026-09-30.
const tx = (extra: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: 't',
  accountId: 'conta',
  date: '2026-09-15T16:13:00.000Z',
  amount: -220,
  type: 'DEBIT',
  status: 'POSTED',
  description: 'Dinheiro reservado Viagem',
  operationType: 'TRANSFERENCIA_SALDO_RESERVADO',
  category: 'Transfer - Internal',
  merchantName: null,
  installment: null,
  ...extra,
});

describe('movimentos de uma reserva do Mercado Pago', () => {
  const transactions = [
    tx({ id: 'a' }),
    tx({
      id: 'b',
      amount: 98.4,
      type: 'CREDIT',
      description: 'Dinheiro retirado Viagem',
    }),
    tx({ id: 'c', description: 'Dinheiro reservado Outra Reserva' }),
    tx({
      id: 'd',
      operationType: 'PIX',
      description: 'Dinheiro reservado Viagem',
    }),
    tx({ id: 'e', description: 'Dinheiro reservado VIÁGEM ' }),
  ];

  it('reservado é aporte, retirado é retirada, só da reserva pedida', () => {
    expect(reserveMovements(transactions, 'Viagem')).toEqual([
      {
        externalId: 'pluggy:a',
        kind: 'deposit',
        amount: '220.00',
        occurredAt: '2026-09-15T16:13:00.000Z',
      },
      {
        externalId: 'pluggy:b',
        kind: 'withdrawal',
        amount: '98.40',
        occurredAt: '2026-09-15T16:13:00.000Z',
      },
      {
        externalId: 'pluggy:e',
        kind: 'deposit',
        amount: '220.00',
        occurredAt: '2026-09-15T16:13:00.000Z',
      },
    ]);
  });
});

describe('reserva renomeada pelo Mercado Pago', () => {
  // 01/10/2026: "Limite do Cartão" virou "Limite do Cartão 2" quando outra
  // reserva "Limite do cartão" foi criada. O aporte antigo é da renomeada; o
  // da reserva nova (só a caixa difere) não é.
  const transactions = [
    tx({
      id: 'velho',
      amount: -1043.55,
      description: 'Dinheiro reservado Limite do Cartão',
    }),
    tx({
      id: 'novo',
      amount: -1650,
      description: 'Dinheiro reservado Limite do cartão',
    }),
  ];

  it('o aporte com o nome antigo vai para a reserva renomeada', () => {
    expect(
      reserveMovements(transactions, 'Limite do Cartão 2').map(
        (m) => m.externalId,
      ),
    ).toEqual(['pluggy:velho']);
  });

  it('sem número no fim, continua ignorando caixa e acento', () => {
    expect(
      reserveMovements(transactions, 'limite do cartao').map(
        (m) => m.externalId,
      ),
    ).toEqual(['pluggy:velho', 'pluggy:novo']);
  });
});

describe('reserva nova com nome repetido', () => {
  const m = (
    id: string,
    kind: 'deposit' | 'withdrawal',
    amount: string,
    at: string,
  ) => ({
    externalId: id,
    kind,
    amount,
    occurredAt: at,
  });
  // A reserva nova "Limite do Cartão" tem R$ 1.645; o nome também casa com o
  // aporte de setembro e o de 12:33, que eram da reserva antiga.
  const matched = [
    m('set', 'deposit', '1835.00', '2026-09-01T11:18:00Z'),
    m('1233', 'deposit', '1043.55', '2026-10-01T12:33:00Z'),
    m('1303', 'deposit', '1645.00', '2026-10-01T13:03:00Z'),
  ];

  it('fica só com os movimentos que explicam o saldo', () => {
    expect(explainBalance(matched, 1645).map((x) => x.externalId)).toEqual([
      '1303',
    ]);
  });

  it('sem soma que bata, não fica com nada', () => {
    expect(explainBalance(matched, 10)).toEqual([]);
  });
});

describe('movimentos dos lotes da caixinha', () => {
  const lot = (id: string, purchaseDate: string): PluggyInvestmentLot => ({
    id,
    purchaseDate,
    type: 'FIXED_INCOME',
    status: 'ACTIVE',
    rateType: 'CDI',
    rate: 115,
    date: '2026-09-30',
    amount: 1,
    balance: 1,
    iof: 0,
    incomeTax: 0,
  });
  const movements = new Map<string, PluggyInvestmentMovement[]>([
    [
      'velho',
      [
        {
          id: 'v1',
          type: 'BUY',
          date: '2026-08-09T12:00:00Z',
          amount: 500,
          netAmount: 500,
        },
        {
          id: 'v2',
          type: 'SELL',
          date: '2026-09-01T12:00:00Z',
          amount: 510,
          netAmount: 507.5,
        },
      ],
    ],
    [
      'novo',
      [
        {
          id: 'n1',
          type: 'BUY',
          date: '2026-09-01T12:00:00Z',
          amount: 1400,
          netAmount: null,
        },
        {
          id: 'n2',
          type: 'SELL',
          date: '2026-09-20T12:00:00Z',
          amount: 101,
          netAmount: 100,
        },
      ],
    ],
  ]);

  it('compra é aporte, venda é retirada pelo valor que caiu na conta', () => {
    expect(
      lotMovements(
        [
          lot('velho', '2026-08-09T12:00:00Z'),
          lot('novo', '2026-09-01T12:00:00Z'),
        ],
        movements,
        '2026-09-01',
      ),
    ).toEqual([
      {
        externalId: 'pluggy:n1',
        kind: 'deposit',
        amount: '1400.00',
        occurredAt: '2026-09-01T12:00:00-03:00',
      },
      {
        externalId: 'pluggy:n2',
        kind: 'withdrawal',
        amount: '100.00',
        occurredAt: '2026-09-20T12:00:00-03:00',
      },
    ]);
  });
});

describe('o que gravar', () => {
  const bank = [
    {
      externalId: 'pluggy:1',
      kind: 'deposit' as const,
      amount: '1835.00',
      occurredAt: '2026-09-01T14:18:00Z',
    },
    {
      externalId: 'pluggy:2',
      kind: 'deposit' as const,
      amount: '50.00',
      occurredAt: '2026-09-10T14:00:00Z',
    },
    {
      externalId: 'pluggy:3',
      kind: 'withdrawal' as const,
      amount: '10.00',
      occurredAt: '2026-08-20T14:00:00Z',
    },
  ];

  it('adota o lançamento manual igual, insere o novo e ignora o anterior ao início', () => {
    const plan = planMovementWrites(
      bank,
      [
        {
          id: 'manual',
          kind: 'deposit',
          amount: '1835',
          occurred_at: '2026-09-01T15:00:00Z',
          external_id: null,
        },
      ],
      '2026-09-01',
    );
    expect(plan.adopt).toEqual([{ id: 'manual', externalId: 'pluggy:1' }]);
    expect(plan.insert.map((movement) => movement.externalId)).toEqual([
      'pluggy:2',
    ]);
  });

  it('não lança de novo o que já veio', () => {
    const plan = planMovementWrites(
      bank.slice(0, 1),
      [
        {
          id: 'x',
          kind: 'deposit',
          amount: '1835',
          occurred_at: '2026-09-01T15:00:00Z',
          external_id: 'pluggy:1',
        },
      ],
      null,
    );
    expect(plan).toEqual({ adopt: [], insert: [] });
  });
});

describe('saldo de uma reserva', () => {
  it('vale o dia da última atualização do item, em São Paulo', () => {
    expect(
      reserveSnapshot(
        { key: 'k', name: 'Viagem', amount: 62.04, accountId: 'conta' },
        '2026-09-30T02:00:00.000Z',
      ),
    ).toEqual({
      snapshotDate: '2026-09-29',
      gross: '62.04',
      net: '62.04',
      iof: null,
      incomeTax: null,
    });
  });

  it('sem valor ou sem data, não inventa saldo', () => {
    expect(
      reserveSnapshot(
        { key: 'k', name: 'x', amount: null, accountId: 'c' },
        '2026-09-30',
      ),
    ).toBeNull();
    expect(
      reserveSnapshot(
        { key: 'k', name: 'x', amount: 10, accountId: 'c' },
        null,
      ),
    ).toBeNull();
  });

  it('dia de São Paulo, não de Greenwich', () => {
    expect(saoPauloDay('2026-09-01T02:30:00Z')).toBe('2026-08-31');
  });
});

describe('datas de investimento', () => {
  it('meia-noite UTC do lote é o próprio dia, não a véspera', () => {
    const [movement] = lotMovements(
      [
        {
          id: 'l',
          purchaseDate: '2026-09-15T00:00:00.000Z',
          type: 'FIXED_INCOME',
          status: 'ACTIVE',
          rateType: 'CDI',
          rate: 115,
          date: '2026-09-30',
          amount: 1,
          balance: 1,
          iof: 0,
          incomeTax: 0,
        },
      ],
      new Map([
        [
          'l',
          [
            {
              id: 'b',
              type: 'BUY',
              date: '2026-09-15T00:00:00.000Z',
              amount: 700,
              netAmount: null,
            },
          ],
        ],
      ]),
      '2026-09-15',
    );
    expect(movement.occurredAt).toBe('2026-09-15T12:00:00-03:00');
    expect(saoPauloDay(movement.occurredAt)).toBe('2026-09-15');
  });
});

describe('cofrinho arquivado com o banco atrasado', () => {
  it('não volta enquanto os aportes forem anteriores ao arquivamento', () => {
    expect(archiveStillCovers('2026-09-30T14:00:00Z', ['2026-09-30'])).toBe(
      true,
    );
  });

  it('volta, como cofrinho novo, quando há aporte depois dele', () => {
    expect(
      archiveStillCovers('2026-09-30T14:00:00Z', ['2026-09-30', '2026-10-02']),
    ).toBe(false);
  });
});
