import { describe, expect, it } from 'vitest';
import {
  applySplits,
  isPendingSpend,
  openingGap,
  pendingEntries,
  pendingKey,
  unidentifiedSpend,
} from './unidentified-spend';

const shot = (taken_at: string, available: number, credit_limit = 1780) => ({
  account: 'Nubank',
  taken_at,
  credit_limit,
  available,
});

describe('gasto ainda sem compra', () => {
  // 06/10 20h34 (23:34Z): 1.000 livres. 07/10 13h08 (16:08Z): 920 livres.
  const snapshots = [
    shot('2026-10-06T23:34:00Z', 1000),
    shot('2026-10-07T16:08:00Z', 920),
  ];

  it('a queda do limite sem compra vira gasto do dia', () => {
    expect(
      unidentifiedSpend({
        days: ['2026-10-07'],
        snapshots,
        movements: [],
        payments: [],
      }),
    ).toMatchObject([
      { day: '2026-10-07', account: 'Nubank', amount: '80.00' },
    ]);
  });

  it('a compra que chega explica a queda, e o valor some', () => {
    const result = unidentifiedSpend({
      days: ['2026-10-07'],
      snapshots,
      movements: [
        {
          account: 'Nubank',
          occurred_at: '2026-10-07T12:00:00Z',
          amount: 50,
          entry_type: 'expense',
        },
      ],
      payments: [],
    });
    expect(result).toMatchObject([
      { day: '2026-10-07', account: 'Nubank', amount: '30.00' },
    ]);
  });

  it('pagamento de fatura e mudança de limite não parecem compra', () => {
    expect(
      unidentifiedSpend({
        days: ['2026-10-07'],
        // Pagou 500 (o disponível sobe 500) e aumentou o limite em 200.
        snapshots: [
          shot('2026-10-06T23:34:00Z', 1000, 1780),
          shot('2026-10-07T16:08:00Z', 1700, 1980),
        ],
        movements: [],
        payments: [{ account: 'Nubank', date: '2026-10-07', amount: 500 }],
      }),
    ).toEqual([]);
  });

  it('compra parcelada usa o total na primeira parcela', () => {
    expect(
      unidentifiedSpend({
        days: ['2026-10-07'],
        snapshots: [
          shot('2026-10-06T23:34:00Z', 1000),
          shot('2026-10-07T16:08:00Z', 700),
        ],
        movements: [
          {
            account: 'Nubank',
            occurred_at: '2026-10-07T12:00:00Z',
            amount: 100,
            entry_type: 'expense',
            installment_number: 1,
            installment_purchase_total: 300,
          },
        ],
        payments: [],
      }),
    ).toEqual([]);
  });

  it('com uma foto só, não dá para saber', () => {
    expect(
      unidentifiedSpend({
        days: ['2026-10-07'],
        snapshots: [shot('2026-10-07T16:08:00Z', 920)],
        movements: [],
        payments: [],
      }),
    ).toEqual([]);
  });

  it('sem foto de antes, a primeira do dia abre a conta', () => {
    // O caso real do 1º dia das fotos: 768,77 → 639,77 sem compra.
    expect(
      unidentifiedSpend({
        days: ['2026-10-07'],
        snapshots: [
          shot('2026-10-07T17:27:54Z', 768.77, 1735.29),
          shot('2026-10-07T17:42:22Z', 639.77, 1735.29),
        ],
        movements: [],
        payments: [],
      }),
    ).toMatchObject([
      { day: '2026-10-07', account: 'Nubank', amount: '129.00' },
    ]);
  });

  it('vira compra "a chegar" na hora da foto que mostrou a queda', () => {
    const [entry] = pendingEntries(
      unidentifiedSpend({
        days: ['2026-10-07'],
        snapshots,
        movements: [],
        payments: [],
      }),
    );
    expect(entry).toMatchObject({
      entry_type: 'expense',
      amount: '80.00',
      account: 'Nubank',
      occurred_at: '2026-10-07T16:08:00Z',
    });
    expect(isPendingSpend(entry)).toBe(true);
    expect(isPendingSpend({ id: '3f2a-uuid' })).toBe(false);
  });

  it('compra com a hora no dia vizinho ao da queda não conta em dobro', () => {
    // Pelo limite, 100 saíram no dia 7. A compra chegou carimbada no fim do
    // dia 6, depois da última foto do dia 6.
    const result = unidentifiedSpend({
      days: ['2026-10-06', '2026-10-07'],
      snapshots: [
        shot('2026-10-05T23:00:00Z', 1000),
        shot('2026-10-06T23:00:00Z', 1000),
        shot('2026-10-07T16:00:00Z', 900),
      ],
      movements: [
        {
          account: 'Nubank',
          occurred_at: '2026-10-06T22:30:00Z',
          amount: 100,
          entry_type: 'expense',
        },
      ],
      payments: [],
    });
    expect(result).toEqual([]);
  });

  it('várias compras entre duas leituras: some só o que chegou', () => {
    // O limite caiu 129 de uma vez: eram duas compras, de 79 e 50.
    const drop = [
      shot('2026-10-07T12:00:00Z', 768.77, 1735.29),
      shot('2026-10-07T17:00:00Z', 639.77, 1735.29),
    ];
    const purchase = (amount: number) => ({
      account: 'Nubank',
      occurred_at: '2026-10-07T14:00:00Z',
      amount,
      entry_type: 'expense' as const,
    });
    expect(
      unidentifiedSpend({
        days: ['2026-10-07'],
        snapshots: drop,
        movements: [purchase(79)],
        payments: [],
      }),
    ).toMatchObject([{ amount: '50.00' }]);
    expect(
      unidentifiedSpend({
        days: ['2026-10-07'],
        snapshots: drop,
        movements: [purchase(79), purchase(50)],
        payments: [],
      }),
    ).toEqual([]);
  });

  it('vale a hora dos dados da foto, não a hora em que ela foi tirada', () => {
    // O caso real de 07/10: a foto das 14h25 trazia os dados das 13h46; a
    // compra da Amazon foi às 14h13 e o limite caiu na foto das 14h42, com
    // dados das 14h41. Pela hora dos dados, a compra explica a queda.
    expect(
      unidentifiedSpend({
        days: ['2026-10-07'],
        snapshots: [
          {
            ...shot('2026-10-07T17:25:00Z', 768.77, 1735.29),
            data_at: '2026-10-07T16:46:00Z',
          },
          {
            ...shot('2026-10-07T17:42:00Z', 639.77, 1735.29),
            data_at: '2026-10-07T17:41:00Z',
          },
        ],
        movements: [
          {
            account: 'Nubank',
            occurred_at: '2026-10-07T17:13:00Z',
            amount: 129,
            entry_type: 'expense',
          },
        ],
        payments: [],
      }),
    ).toEqual([]);
  });

  it('cartão novo: o usado da primeira foto menos as compras que chegaram', () => {
    // O Itaú Múltiplo em 08/10: R$ 44,71 usados, R$ 26,68 em compras.
    const first = {
      account: 'Itaú',
      taken_at: '2026-10-08T13:17:00Z',
      data_at: '2026-10-08T12:42:00Z',
      credit_limit: 300,
      available: 255.29,
    };
    const purchase = (occurred_at: string, amount: number) => ({
      account: 'Itaú',
      occurred_at,
      amount,
      entry_type: 'expense' as const,
    });
    const arrived = [
      purchase('2026-10-05T23:48:30Z', 5),
      purchase('2026-10-05T23:57:18Z', 5.78),
      purchase('2026-10-06T18:19:39Z', 15.9),
    ];
    // Na véspera da primeira foto: a compra que ainda não chegou é de ontem.
    expect(openingGap(first, arrived)).toMatchObject({
      day: '2026-10-07',
      amount: '18.03',
      opening: true,
    });
    // Quando a compra da véspera chega, não sobra nada.
    expect(
      openingGap(first, [...arrived, purchase('2026-10-07T20:00:00Z', 18.03)]),
    ).toBeNull();
  });
});

describe('divisão da compra a chegar', () => {
  const pending = {
    day: '2026-10-13',
    account: 'Nubank',
    amount: '492.51',
    at: '2026-10-13T12:53:55.092Z',
  };
  const split = {
    account: 'Nubank',
    day: '2026-10-13',
    parts: [
      { amount: '300.00', day: '2026-10-12', description: 'Mercado' },
      { amount: '150.00', day: '2026-10-12', description: null },
      { amount: '42.51', day: '2026-10-11' },
    ],
  };

  it('troca a compra a chegar pelas partes, cada uma no seu dia', () => {
    const items = applySplits([pending], [split]);
    expect(items.map((item) => [item.day, item.amount])).toEqual([
      ['2026-10-12', '300.00'],
      ['2026-10-12', '150.00'],
      ['2026-10-11', '42.51'],
    ]);
    expect(items[0]!.split).toEqual({
      day: '2026-10-13',
      total: '492.51',
      description: 'Mercado',
    });
  });

  it('o que as partes não cobrem continua como compra a chegar', () => {
    const items = applySplits(
      [pending],
      [{ ...split, parts: split.parts.slice(0, 1) }],
    );
    expect(items.map((item) => [item.day, item.amount])).toEqual([
      ['2026-10-12', '300.00'],
      ['2026-10-13', '192.51'],
    ]);
  });

  it('quando uma compra chega do banco, a parte que bate some', () => {
    // A de R$ 150 chegou: falta chegar 342,51.
    const items = applySplits([{ ...pending, amount: '342.51' }], [split]);
    expect(items.map((item) => item.amount)).toEqual(['300.00', '42.51']);
  });

  it('sem combinação que feche, o que falta fica no dia corrigido', () => {
    const items = applySplits([{ ...pending, amount: '100.00' }], [split]);
    expect(items.map((item) => [item.day, item.amount])).toEqual([
      ['2026-10-12', '100.00'],
    ]);
  });

  it('só corrigir a data: uma parte com o valor inteiro', () => {
    const fix = {
      account: 'Nubank',
      day: '2026-10-13',
      parts: [{ amount: '492.51', day: '2026-10-12' }],
    };
    expect(
      applySplits([pending], [fix]).map((item) => [item.day, item.amount]),
    ).toEqual([['2026-10-12', '492.51']]);
    // Parte das compras chegou: o resto continua em 12/10.
    expect(
      applySplits([{ ...pending, amount: '200.00' }], [fix]).map((item) => [
        item.day,
        item.amount,
      ]),
    ).toEqual([['2026-10-12', '200.00']]);
  });

  it('sem divisão, nada muda', () => {
    expect(applySplits([pending], [])).toEqual([pending]);
  });

  it('a chave de edição aponta para o dia em que o app viu a queda', () => {
    const [entry] = pendingEntries(applySplits([pending], [split]));
    expect(entry!.description).toBe('Mercado');
    expect(entry!.occurred_at.slice(0, 10)).toBe('2026-10-12');
    expect(pendingKey(entry!)).toEqual({
      account: 'Nubank',
      day: '2026-10-13',
    });
  });
});
