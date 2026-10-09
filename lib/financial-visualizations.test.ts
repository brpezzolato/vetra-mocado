import { describe, expect, it } from 'vitest';
import type { FinancialEntry } from './financial-tracker';
import {
  availableMonths,
  availableYears,
  buildFinancialVisualizations,
  OTHER_PAYER_ACCOUNT,
} from './financial-visualizations';

let counter = 0;
const entry = (
  amount: string,
  day: string,
  overrides: Partial<FinancialEntry> = {},
): FinancialEntry => ({
  id: `e${counter++}`,
  user_id: 'user',
  entry_type: 'expense',
  amount,
  description: 'Teste',
  category: 'Alimentação',
  account: 'Nubank',
  // Meio-dia em São Paulo, para o dia nunca escorregar pelo fuso.
  occurred_at: `${day}T12:00:00-03:00`,
  source: 'manual',
  external_id: null,
  created_at: `${day}T12:00:00-03:00`,
  updated_at: `${day}T12:00:00-03:00`,
  ...overrides,
});
const at = (day: string) => new Date(`${day}T18:00:00-03:00`);

describe('o total do mês', () => {
  it('soma só o que já aconteceu, e nunca receita', () => {
    const result = buildFinancialVisualizations(
      [
        entry('10.10', '2026-09-02'),
        entry('4.90', '2026-09-03'),
        entry('99.00', '2026-09-20'),
        entry('500', '2026-09-03', { entry_type: 'income' }),
      ],
      { now: at('2026-09-10') },
    );
    expect(result.total).toBe(15);
    expect(result.count).toBe(2);
  });
});

describe('a comparação com o mês anterior', () => {
  it('não compara com um período em que o app ainda não era usado', () => {
    // O caso real: o registro começou em 24/08, e a tela comparava setembro
    // com 1–24 de agosto — R$ 12,90 — e dizia que o gasto subiu 23 313%.
    const result = buildFinancialVisualizations(
      [entry('12.90', '2026-08-24'), entry('3000', '2026-09-10')],
      { now: at('2026-09-24') },
    );
    expect(result.comparison.available).toBe(false);
    // Outubro é o primeiro mês cujo anterior foi registrado inteiro.
    expect(result.comparison).toMatchObject({ from: '2026-10' });
    expect(result.categoryChanges).toEqual([]);
    expect(result.pace.every((point) => point.previous === null)).toBe(true);
  });

  it('compara o mesmo trecho de dias quando há histórico de verdade', () => {
    const result = buildFinancialVisualizations(
      [
        entry('80', '2026-08-01'),
        entry('20', '2026-08-10'),
        entry('500', '2026-08-20'),
        entry('150', '2026-09-05'),
      ],
      { now: at('2026-09-16') },
    );
    expect(result.comparison).toMatchObject({
      available: true,
      previousTotal: 100,
      changePercent: 50,
    });
  });

  it('compara um mês fechado com o mês anterior inteiro', () => {
    const result = buildFinancialVisualizations(
      [
        entry('100', '2026-07-01'),
        entry('50', '2026-07-31'),
        entry('300', '2026-08-15'),
      ],
      { now: at('2026-09-10'), month: '2026-08' },
    );
    expect(result.isCurrentMonth).toBe(false);
    expect(result.projection).toBeNull();
    expect(result.comparison).toMatchObject({
      available: true,
      previousTotal: 150,
      changePercent: 100,
    });
  });

  it('lista a categoria que zerou, porque ela também mudou', () => {
    const result = buildFinancialVisualizations(
      [
        // Primeiro registro em 01/08, senão agosto não conta como mês inteiro
        // e a comparação fica desligada — com razão.
        entry('100', '2026-08-01', { category: 'Lazer' }),
        entry('40', '2026-08-03'),
        entry('50', '2026-09-03'),
      ],
      { now: at('2026-09-16') },
    );
    expect(result.categoryChanges.map((item) => item.name)).toEqual([
      'Lazer',
      'Alimentação',
    ]);
    expect(result.categoryChanges[0]).toMatchObject({ total: 0, delta: -100 });
  });
});

describe('a projeção do mês', () => {
  it('projeta pelo ritmo, sem repetir parcela e somando o que já está agendado', () => {
    const result = buildFinancialVisualizations(
      [
        entry('100', '2026-08-01'),
        // Dez dias com 20 por dia de gasto comum...
        ...Array.from({ length: 10 }, (_, index) =>
          entry('20', `2026-09-${String(index + 1).padStart(2, '0')}`),
        ),
        // ...uma parcela que não se repete a cada dia...
        entry('300', '2026-09-05', {
          installment_group_id: 'g',
          installment_number: 1,
        }),
        // ...e uma parcela já agendada para o dia 25.
        entry('90', '2026-09-25', {
          installment_group_id: 'h',
          installment_number: 2,
        }),
      ],
      { now: at('2026-09-10') },
    );
    // 500 gastos + 20 × 20 dias restantes + 90 agendados.
    expect(result.projection).toMatchObject({
      dailyPace: 20,
      daysLeft: 20,
      scheduled: 90,
      total: 990,
      tentative: false,
    });
    // A linha tracejada começa no ponto de hoje e termina na projeção.
    expect(result.pace[9]).toMatchObject({ current: 500, projected: 500 });
    expect(result.pace.at(-1)?.projected).toBe(990);
    expect(result.pace.at(-1)?.current).toBeNull();
  });

  it('não dilui o ritmo com os dias anteriores ao primeiro registro', () => {
    // Registro começou no dia 21: são 4 dias de gasto, não 24.
    const result = buildFinancialVisualizations(
      [
        entry('40', '2026-09-21'),
        entry('40', '2026-09-22'),
        entry('40', '2026-09-23'),
        entry('40', '2026-09-24'),
      ],
      { now: at('2026-09-24') },
    );
    expect(result.projection?.dailyPace).toBe(40);
    expect(result.projection?.tentative).toBe(true);
  });
});

describe('as categorias', () => {
  it('junta "outros" e "Outros" na grafia do app', () => {
    const result = buildFinancialVisualizations(
      [
        entry('10', '2026-09-02', { category: 'outros' }),
        entry('5', '2026-09-03', { category: 'Outros ' }),
      ],
      { now: at('2026-09-10') },
    );
    expect(result.categories).toEqual([
      { name: 'Outros', total: 15, count: 2, share: 100 },
    ]);
  });
});

describe('de quem era o dinheiro', () => {
  it('separa o benefício e o que outra pessoa pagou do que saiu do bolso', () => {
    const result = buildFinancialVisualizations(
      [
        entry('100', '2026-09-02', { account: 'Nubank Mastercard Gold' }),
        entry('40', '2026-09-03', { account: 'Flash' }),
        entry('25', '2026-09-04', { account: OTHER_PAYER_ACCOUNT }),
      ],
      { now: at('2026-09-10') },
    );
    expect(result.payers).toEqual({ own: 100, benefit: 40, otherPayer: 25 });
    expect(result.accounts.find((item) => item.name === 'Flash')?.method).toBe(
      'flash',
    );
  });
});

describe('os dias da semana', () => {
  it('tira a média por ocorrência e não olha antes do primeiro registro', () => {
    // Janela de 24/08 (primeiro registro) a 24/09: 32 dias. A tela dizia
    // "últimos 90 dias" sobre um período que o app nunca viu.
    const result = buildFinancialVisualizations(
      [entry('100', '2026-08-24'), entry('60', '2026-08-31')],
      { now: at('2026-09-24') },
    );
    expect(result.weekdayWindowDays).toBe(32);
    const monday = result.weekdays.find((item) => item.day === 'Seg')!;
    // 24/08, 31/08, 07/09, 14/09 e 21/09: cinco segundas.
    expect(monday).toMatchObject({ occurrences: 5, total: 160, average: 32 });
    expect(result.weekdays[0].day).toBe('Seg');
  });
});

describe('a evolução mensal', () => {
  it('começa no primeiro mês registrado e marca os meses incompletos', () => {
    const result = buildFinancialVisualizations(
      [entry('100', '2026-08-24'), entry('50', '2026-09-02')],
      { now: at('2026-09-24') },
    );
    expect(result.monthly.map((item) => [item.month, item.partial])).toEqual([
      ['2026-08', 'start'],
      ['2026-09', 'current'],
    ]);
  });

  it('oferece no seletor só os meses que existem', () => {
    expect(
      availableMonths([entry('1', '2026-08-24')], at('2026-10-02')),
    ).toEqual(['2026-10', '2026-09', '2026-08']);
  });
});

describe('as parcelas a vencer', () => {
  it('conta a partir de hoje, qualquer que seja o mês na tela', () => {
    const result = buildFinancialVisualizations(
      [
        entry('40', '2026-09-02', { installment_group_id: 'g' }),
        entry('40', '2026-09-28', { installment_group_id: 'g' }),
        entry('40', '2026-10-28', { installment_group_id: 'g' }),
        entry('99', '2026-10-10'),
      ],
      { now: at('2026-09-16'), month: '2026-08' },
    );
    expect(result.instalments.total).toBe(80);
    expect(result.instalments.months).toEqual([
      { month: '2026-09', label: 'set', total: 40 },
      { month: '2026-10', label: 'out', total: 40 },
    ]);
  });
});

describe('a ordem de cores da pizza', () => {
  it('vem do histórico inteiro, então não muda quando se troca de mês', () => {
    const entries = [
      entry('900', '2026-08-02', { category: 'Transporte' }),
      entry('100', '2026-08-03'),
      // Em setembro Alimentação é a maior, mas Transporte segue na frente:
      // é a mesma cor nos dois meses.
      entry('300', '2026-09-02'),
      entry('50', '2026-09-03', { category: 'Transporte' }),
      entry('70', '2026-09-04', { category: 'outros' }),
    ];
    const september = buildFinancialVisualizations(entries, {
      now: at('2026-09-10'),
    });
    const august = buildFinancialVisualizations(entries, {
      now: at('2026-09-10'),
      month: '2026-08',
    });
    expect(september.categoryRanking).toEqual(['Transporte', 'Alimentação']);
    expect(august.categoryRanking).toEqual(september.categoryRanking);
  });
});

describe('acumulado do ano e de todo o histórico', () => {
  const history = [
    entry('100', '2025-11-10'),
    entry('50', '2025-12-05', { category: 'Transporte' }),
    entry('200', '2026-01-15'),
    entry('300', '2026-09-02'),
    entry('999', '2026-10-01'), // futura: não conta em nada
  ];

  it('soma o ano até hoje e mostra os meses dele', () => {
    const result = buildFinancialVisualizations(history, {
      now: at('2026-09-10'),
      period: '2026',
    });
    expect(result.kind).toBe('year');
    expect(result.total).toBe(500);
    expect(result.count).toBe(2);
    expect(result.monthly.map((item) => item.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    // O ritmo dia a dia é gráfico de mês; o ano se lê mês a mês.
    expect(result.pace).toEqual([]);
    expect(result.projection).toBeNull();
  });

  it('só compara com o ano anterior se ele foi registrado inteiro', () => {
    // O registro começou em 10/11/2025, então 2025 não conta como ano
    // inteiro: a primeira comparação honesta é 2027 contra 2026.
    const result = buildFinancialVisualizations(history, {
      now: at('2026-09-10'),
      period: '2026',
    });
    expect(result.comparison).toMatchObject({ available: false, from: '2027' });
  });

  it('compara o mesmo trecho do ano anterior quando há histórico', () => {
    const result = buildFinancialVisualizations(
      [
        entry('10', '2025-01-01'),
        entry('90', '2025-03-01'),
        entry('500', '2025-12-01'), // depois de 10/09: fora do mesmo trecho
        entry('150', '2026-02-01'),
      ],
      { now: at('2026-09-10'), period: '2026' },
    );
    expect(result.comparison).toMatchObject({
      available: true,
      previous: '2025',
      previousTotal: 100,
      changePercent: 50,
    });
  });

  it('soma todo o histórico, sem comparação e sem teto de seis meses', () => {
    const result = buildFinancialVisualizations(history, {
      now: at('2026-09-10'),
      period: 'all',
    });
    expect(result.kind).toBe('all');
    expect(result.total).toBe(650);
    expect(result.comparison).toMatchObject({ available: false, from: null });
    expect(result.monthly[0].month).toBe('2025-11');
    expect(result.monthly.at(-1)?.month).toBe('2026-09');
    expect(result.monthly).toHaveLength(11);
  });

  it('tira a média por dia só dos dias registrados', () => {
    // 10/11/2025 a 10/09/2026: 305 dias.
    const result = buildFinancialVisualizations(history, {
      now: at('2026-09-10'),
      period: 'all',
    });
    expect(result.countedDays).toBe(305);
    expect(result.dailyAverage).toBeCloseTo(650 / 305, 10);
  });

  it('oferece os anos que existem no seletor', () => {
    expect(availableYears(history, at('2026-09-10'))).toEqual(['2026', '2025']);
  });
});
