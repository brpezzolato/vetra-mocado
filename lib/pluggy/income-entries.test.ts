import { describe, expect, it } from 'vitest';
import {
  isIncomeCandidate,
  mapIncomeTransactions,
  type IncomeSource,
} from './income-entries';
import type { PluggyTransaction } from './types';

const tx = (
  id: string,
  description: string,
  amount: number,
  type = 'CREDIT',
  category = 'Transfer - PIX',
): PluggyTransaction => ({
  id,
  accountId: 'conta',
  date: '2026-09-30T12:00:00.000Z',
  amount,
  type,
  status: 'POSTED',
  description,
  operationType: 'PIX',
  category,
  merchantName: null,
  installment: null,
});

const sources: IncomeSource[] = [
  {
    match: 'contains',
    pattern: 'PAGTO Salários',
    label: 'Salário',
    category: 'Salário',
  },
  {
    match: 'contains',
    pattern: 'PAGTO Adiantamento Salarial',
    label: 'Adiantamento salarial',
    category: 'Salário',
  },
  {
    match: 'transaction',
    pattern: 'pix-escolhido',
    label: 'Pix recebido',
    category: 'Receita',
  },
];

describe('entradas de renda', () => {
  it('toda entrada vira registro; só a que casa com uma fonte conta', () => {
    const entries = mapIncomeTransactions(
      [
        tx('s', 'Entrada PAGTO Salarios', 1101.32, 'CREDIT', 'Shopping'),
        tx('a', 'Entrada PAGTO Adiantamento Salarial', 920),
        tx('p', 'Pix recebido Fulano', 50),
        tx(
          'own',
          'Pix recebido Bruno',
          2332.6,
          'CREDIT',
          'Same person transfer',
        ),
        tx('pix-escolhido', 'Pix recebido Fulana', 462.72),
      ],
      sources,
    );
    expect(
      entries.map((entry) => [
        entry.description,
        entry.amount,
        entry.category,
        entry.excluded,
      ]),
    ).toEqual([
      ['Salário', '1101.32', 'Salário', false],
      ['Adiantamento salarial', '920.00', 'Salário', false],
      // Sem fonte: o registro fica, com o nome de quem pagou, fora das contas.
      ['Fulano', '50.00', 'Receita', true],
      ['Pix recebido', '462.72', 'Receita', false],
    ]);
    expect(entries.every((entry) => entry.entryType === 'income')).toBe(true);
  });

  it('a entrada escolhida pelo id é só aquela', () => {
    expect(
      mapIncomeTransactions(
        [tx('outro', 'Pix recebido Fulana', 462.72)],
        sources,
      ).map((entry) => entry.excluded),
    ).toEqual([true]);
  });

  it('saída nunca vira renda, mesmo com o texto da fonte', () => {
    expect(
      mapIncomeTransactions(
        [tx('d', 'PAGTO Salários estorno', 10, 'DEBIT')],
        sources,
      ),
    ).toEqual([]);
  });

  it('desligada pelo id não conta, mesmo casando com uma regra', () => {
    expect(
      mapIncomeTransactions(
        [tx('s', 'Entrada PAGTO Salários', 1101.32)],
        [
          ...sources,
          { match: 'skip', pattern: 's', label: '—', category: '—' },
        ],
      ).map((entry) => entry.excluded),
    ).toEqual([true]);
  });

  it('dinheiro dele mudando de lugar não aparece como possível renda', () => {
    expect(isIncomeCandidate(tx('p', 'Pix recebido Fulano', 50))).toBe(true);
    expect(
      isIncomeCandidate(
        tx('o', 'Pix recebido Bruno', 10, 'CREDIT', 'Same person transfer'),
      ),
    ).toBe(false);
    expect(
      isIncomeCandidate({
        ...tx(
          'r',
          'Dinheiro retirado Reserva',
          300,
          'CREDIT',
          'Transfer - Internal',
        ),
        operationType: 'TRANSFERENCIA_SALDO_RESERVADO',
      }),
    ).toBe(false);
    expect(isIncomeCandidate(tx('d', 'Pix enviado', 50, 'DEBIT'))).toBe(false);
  });
});
