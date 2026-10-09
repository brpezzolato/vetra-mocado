import { describe, expect, it } from 'vitest';
import type { FinancialEntry } from './financial-tracker';
import {
  daySummary,
  monthLabel,
  monthsWithEntries,
  monthSummary,
} from './period-summary';

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

const ENTRIES: FinancialEntry[] = [
  entry('2026-09-10T12:00:00-03:00', '25.00', {
    category: 'Alimentação',
    description: 'Sonda',
  }),
  entry('2026-09-10T20:00:00-03:00', '15.50', {
    category: 'Alimentação',
    description: 'Sonda',
    account: 'Flash',
  }),
  entry('2026-09-10T22:00:00-03:00', '10.00', {
    category: 'Transporte',
    description: 'Uber',
    account: 'Flash',
  }),
  entry('2026-09-18T09:00:00-03:00', '80.00', {
    category: 'Compras',
    description: 'Livraria',
  }),
  entry('2026-09-18T10:00:00-03:00', '1000.00', { entry_type: 'income' }),
  entry('2026-08-05T09:00:00-03:00', '200.00', { category: 'Moradia' }),
];

describe('o resumo de um dia', () => {
  const day = daySummary(ENTRIES, '2026-09-10');

  it('soma apenas o que aconteceu naquele dia em São Paulo', () => {
    expect(day.spent).toBe('50.50');
    expect(day.count).toBe(3);
  });

  it('lista do mais recente para o mais antigo', () => {
    expect(day.entries.map((e) => e.occurred_at.slice(11, 16))).toEqual([
      '22:00',
      '20:00',
      '12:00',
    ]);
  });

  it('reparte por categoria com a fatia de cada uma', () => {
    expect(day.byCategory).toEqual([
      { name: 'Alimentação', total: '40.50', count: 2, share: 80.2 },
      { name: 'Transporte', total: '10.00', count: 1, share: 19.8 },
    ]);
  });

  it('reparte por conta, que é como o cartão de benefícios aparece', () => {
    expect(day.byAccount.map((a) => [a.name, a.total])).toEqual([
      ['Flash', '25.50'],
      ['Nubank', '25.00'],
    ]);
  });

  it('não inventa nada num dia vazio', () => {
    const empty = daySummary(ENTRIES, '2026-09-11');
    expect(empty).toMatchObject({ spent: '0.00', count: 0, entries: [] });
    expect(empty.byCategory).toEqual([]);
  });

  it('usa o dia de São Paulo, não o UTC', () => {
    // 2026-09-11T02:00Z ainda é dia 10 em São Paulo.
    const late = [entry('2026-09-11T02:00:00Z', '7.00')];
    expect(daySummary(late, '2026-09-10').spent).toBe('7.00');
    expect(daySummary(late, '2026-09-11').spent).toBe('0.00');
  });
});

describe('o fechamento do mês', () => {
  const month = monthSummary(ENTRIES, '2026-09');

  it('separa o que saiu do que entrou', () => {
    expect(month.spent).toBe('130.50');
    expect(month.received).toBe('1000.00');
    expect(month.net).toBe('869.50');
  });

  it('ordena categorias e estabelecimentos pelo maior', () => {
    expect(month.byCategory[0].name).toBe('Compras');
    expect(month.topMerchants[0]).toMatchObject({
      name: 'Livraria',
      total: '80.00',
    });
    expect(month.topMerchants).toContainEqual(
      expect.objectContaining({ name: 'Sonda', total: '40.50', count: 2 }),
    );
  });

  it('dá um valor para cada dia do mês, inclusive os vazios', () => {
    expect(month.daily).toHaveLength(30);
    expect(month.daily[0]).toEqual({ day: '2026-09-01', total: '0.00' });
    expect(month.daily[9]).toEqual({ day: '2026-09-10', total: '50.50' });
  });

  it('aponta o dia mais caro', () => {
    expect(month.busiestDay).toEqual({ day: '2026-09-18', total: '80.00' });
  });

  it('faz a média sobre os dias em que houve gasto', () => {
    expect(month.dailyAverage).toBe('65.25');
  });

  it('compara com o mês anterior', () => {
    expect(month.previous).toEqual({
      month: '2026-08',
      spent: '200.00',
      delta: '-69.50',
      deltaPercent: -34.8,
    });
  });

  it('não compara com um mês que não tem dados', () => {
    // Julho não existe nos lançamentos: dizer "-100%" seria mentira.
    expect(monthSummary(ENTRIES, '2026-08').previous).toBeNull();
  });

  it('não quebra num mês sem nada', () => {
    const empty = monthSummary(ENTRIES, '2026-12');
    expect(empty).toMatchObject({
      spent: '0.00',
      count: 0,
      dailyAverage: '0.00',
      busiestDay: null,
    });
    expect(empty.daily).toHaveLength(31);
  });

  it('conta fevereiro bissexto certo', () => {
    expect(monthSummary([], '2028-02').daily).toHaveLength(29);
    expect(monthSummary([], '2026-02').daily).toHaveLength(28);
  });
});

describe('o seletor de mês', () => {
  it('oferece só os meses que têm lançamento, do mais novo ao mais velho', () => {
    expect(monthsWithEntries(ENTRIES)).toEqual(['2026-09', '2026-08']);
  });

  it('escreve o mês por extenso', () => {
    expect(monthLabel('2026-09')).toBe('setembro de 2026');
    expect(monthLabel('2026-01')).toBe('janeiro de 2026');
  });
});
