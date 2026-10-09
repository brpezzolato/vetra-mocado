import { describe, expect, it } from 'vitest';
import { counterpart, mapPixTransactions } from './pix-entries';
import type { PluggyTransaction } from './types';

// Inventado, no formato real dos quatro bancos visto em 2026-09-30.
const tx = (extra: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: 'x',
  accountId: 'conta',
  date: '2026-09-10T12:00:00Z',
  amount: -50,
  type: 'DEBIT',
  status: 'POSTED',
  description: 'Pix enviado Maria Souza',
  operationType: 'PIX',
  category: 'Transfer - PIX',
  merchantName: null,
  installment: null,
  ...extra,
});

describe('Pix que sai', () => {
  it('entra com o nome de quem recebeu', () => {
    expect(mapPixTransactions([tx({ id: 'a' })])).toMatchObject([
      {
        externalId: 'a',
        entryType: 'expense',
        amount: '50.00',
        description: 'Maria Souza',
      },
    ]);
  });

  it('recebido, entre contas próprias, fatura e devolvido não entram', () => {
    expect(
      mapPixTransactions([
        tx({
          id: 'recebido',
          type: 'CREDIT',
          amount: 50,
          description: 'Pix recebido Joao',
        }),
        tx({
          id: 'proprio',
          category: 'Same person transfer',
          description: 'Pix enviado Eu Mesmo',
        }),
        tx({
          id: 'fatura',
          category: 'Credit card payment',
          description: 'Pagamento com QR Pix NU PAGAMENTOS SA',
        }),
        tx({ id: 'devolvido', description: 'Pix devolvido Ana Silva' }),
      ]),
    ).toEqual([]);
  });

  it('cancelado some junto com o pagamento que cancelou', () => {
    expect(
      mapPixTransactions([
        tx({
          id: 'pago',
          amount: -98.4,
          description: 'Pagamento com QR Pix OLV DISTRIBUIDORA LTDA',
        }),
        tx({
          id: 'cancelado',
          type: 'CREDIT',
          amount: 98.4,
          description:
            'Pagamento com código QR Pix - Cancelado OLV DISTRIBUIDORA LTDA',
        }),
      ]),
    ).toEqual([]);
  });

  it('o que a mesma pessoa devolveu anula; de outra pessoa, não', () => {
    const entries = mapPixTransactions([
      tx({
        id: 'orlando',
        amount: -90,
        date: '2026-08-08T12:00:00Z',
        description: 'Pix enviado Orlando Neto',
      }),
      tx({
        id: 'volta',
        type: 'CREDIT',
        amount: 90,
        date: '2026-09-17T12:00:00Z',
        description: 'Pix recebido Orlando Neto',
      }),
      tx({
        id: 'julia',
        amount: -90,
        date: '2026-09-04T12:00:00Z',
        description: 'Pix enviado Julia Gomes',
      }),
    ]);
    expect(entries.map((entry) => entry.externalId)).toEqual(['julia']);
  });

  it('prefixo de cada banco sai do nome', () => {
    expect(counterpart('Transferência enviada|99 FOOD LTDA')).toBe(
      '99 FOOD LTDA',
    );
    expect(counterpart('PIX ENVIADO JOAO COM SALDO')).toBe('JOAO');
  });
  it('o cancelamento anula o pagamento da mesma conta, não a compra de outra', () => {
    const entries = mapPixTransactions([
      tx({
        id: 'nubank',
        accountId: 'nubank',
        amount: -98.4,
        description: 'Transferência enviada|OLV LTDA',
      }),
      tx({
        id: 'mp',
        accountId: 'mp',
        amount: -98.4,
        description: 'Pagamento com QR Pix OLV LTDA',
      }),
      tx({
        id: 'cancelado',
        accountId: 'mp',
        type: 'CREDIT',
        amount: 98.4,
        description: 'Pagamento com código QR Pix - Cancelado OLV LTDA',
      }),
    ]);
    expect(entries.map((entry) => entry.externalId)).toEqual(['nubank']);
  });
});
