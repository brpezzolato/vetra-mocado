import { describe, expect, it } from 'vitest';
import {
  benefitCycles,
  benefitBalanceView,
  benefitForecast,
  FLASH_WALLETS,
  latestBenefitBalance,
  walletEntries,
  walletForEntry,
  type BenefitCardBalance,
} from './benefit-cards';
import { EXPENSE_CATEGORIES } from './expense-categories';
import type { FinancialEntry } from './financial-tracker';

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
  category: 'Alimentação',
  account: 'Flash',
  occurred_at,
  source: 'manual',
  external_id: null,
  created_at: occurred_at,
  updated_at: occurred_at,
  ...extra,
});

const balance = (
  measured_at: string,
  value: string,
  source: BenefitCardBalance['source'] = 'manual',
): BenefitCardBalance => ({
  id: `balance-${measured_at}`,
  user_id: 'user',
  account: 'Flash',
  balance: value,
  measured_at,
  source,
  created_at: measured_at,
  updated_at: measured_at,
});

describe('o saldo do cartão de benefícios', () => {
  it('desconta o que foi gasto depois da leitura', () => {
    const view = benefitBalanceView(balance('2026-09-16', '120.00'), [
      entry('2026-09-17T12:00:00-03:00', '20.00'),
      entry('2026-09-18T12:00:00-03:00', '5.40'),
    ]);
    expect(view).toMatchObject({
      current: '94.60',
      reported: '120.00',
      spentSince: '25.40',
      movementsSince: 2,
    });
  });

  it('soma um depósito recebido depois da leitura', () => {
    const view = benefitBalanceView(balance('2026-09-16', '10.00'), [
      entry('2026-09-20T12:00:00-03:00', '500.00', { entry_type: 'income' }),
    ]);
    expect(view).toMatchObject({ current: '510.00', receivedSince: '500.00' });
  });

  it('trata o próprio dia da leitura como já contido nela', () => {
    // O extrato reporta o saldo depois da última compra daquele dia, então
    // descontar as compras do mesmo dia seria cobrar duas vezes.
    const view = benefitBalanceView(balance('2026-09-16', '0.50'), [
      entry('2026-09-16T12:47:00-03:00', '5.80'),
    ]);
    expect(view).toMatchObject({ current: '0.50', movementsSince: 0 });
  });

  it('só conta as entradas que o chamador passar', () => {
    // Filtrar por conta ou por categoria (uma carteira da Flash) é decisão de
    // quem chama; a função só soma o que recebe.
    const view = benefitBalanceView(balance('2026-09-16', '100.00'), []);
    expect(view).toMatchObject({ current: '100.00', movementsSince: 0 });
  });

  it('não inventa saldo quando não há leitura nenhuma', () => {
    expect(benefitBalanceView(null, [])).toBeNull();
  });
});

describe('qual leitura vale', () => {
  it('usa a mais recente pelo dia a que se refere, não pelo dia em que foi digitada', () => {
    const balances = [
      balance('2026-09-16', '0.50', 'benefit_statement'),
      balance('2026-09-30', '800.00'),
      balance('2026-08-01', '1300.00'),
    ];
    expect(latestBenefitBalance(balances, 'Flash')?.measured_at).toBe(
      '2026-09-30',
    );
  });

  it('não confunde cartões diferentes', () => {
    const outro = { ...balance('2026-12-01', '9.99'), account: 'Outro' };
    expect(latestBenefitBalance([outro], 'Flash')).toBeNull();
  });
});

describe('a qual carteira do Flash cada lançamento pertence', () => {
  it('manda cada categoria para a carteira que ela nomeia', () => {
    expect(walletForEntry({ category: 'Transporte' }).key).toBe('transporte');
    expect(walletForEntry({ category: 'Alimentação' }).key).toBe('alimentacao');
  });

  it('atribui TODAS as nove categorias, não só as duas que nomeiam carteira', () => {
    // A invariante que o filtro por categoria quebrava. Sem ela um gasto em
    // `Compras` não saía de nenhum saldo e o dinheiro desaparecia.
    for (const category of EXPENSE_CATEGORIES)
      expect(FLASH_WALLETS).toContain(walletForEntry({ category }));
  });

  it('não perde lançamento sem categoria nem com categoria desconhecida', () => {
    expect(FLASH_WALLETS).toContain(walletForEntry({ category: null }));
    expect(FLASH_WALLETS).toContain(walletForEntry({ category: '  ' }));
    expect(FLASH_WALLETS).toContain(walletForEntry({ category: 'Pet' }));
  });

  it('manda tudo que não é transporte para a comida, inclusive o Uber One', () => {
    // A regra é do cartão do Bruno: VT só é aceito por 99, Uber e Metrô/CPTM, e
    // o cartão não aceita outro ramo. Então o resto saiu do saldo de comida —
    // incluindo o Uber One, que o extrato classifica como `Assinaturas`.
    for (const category of [
      'Assinaturas',
      'Compras',
      'Saúde',
      'Lazer',
      'Outros',
    ])
      expect(walletForEntry({ category }).key).toBe('alimentacao');
  });

  it('as duas carteiras somadas devolvem todos os lançamentos', () => {
    const all = [
      entry('2026-09-22', '22.94', { category: 'Transporte' }),
      entry('2026-09-22', '75.30', { category: 'Compras' }),
      entry('2026-09-22', '21.80', { category: 'Alimentação' }),
      entry('2026-09-22', '12.90', { category: 'Assinaturas' }),
      entry('2026-09-22', '32.80', { category: 'Outros' }),
      entry('2026-09-22', '9.99', { category: '' }),
    ];
    const split = FLASH_WALLETS.flatMap((wallet) => walletEntries(wallet, all));
    expect(split).toHaveLength(all.length);
    expect(new Set(split.map((item) => item.id))).toEqual(
      new Set(all.map((item) => item.id)),
    );
  });

  it('reproduz o caso real de 22/09: o saldo não some mais um centavo', () => {
    // Leituras de 20/09: transporte 0,42 e alimentação 0,08. Depois entram os
    // dois depósitos e quatro gastos, um deles em `Compras`. Antes da correção
    // o app somava 1238,82 num cartão que tinha 1163,52.
    const movements = [
      entry('2026-09-22', '960.00', {
        entry_type: 'income',
        category: 'Transporte',
      }),
      entry('2026-09-22', '350.00', {
        entry_type: 'income',
        category: 'Alimentação',
      }),
      entry('2026-09-22', '22.94', { category: 'Transporte' }),
      entry('2026-09-22', '75.30', { category: 'Compras' }),
      entry('2026-09-22', '21.80', { category: 'Alimentação' }),
      entry('2026-09-23', '26.94', { category: 'Transporte' }),
    ];
    const readings = { transporte: '0.42', alimentacao: '0.08' } as const;
    const total = FLASH_WALLETS.reduce((sum, wallet) => {
      const view = benefitBalanceView(
        { balance: readings[wallet.key], measured_at: '2026-09-20' },
        walletEntries(wallet, movements),
      )!;
      return sum + Number(view.current);
    }, 0);
    expect(total.toFixed(2)).toBe('1163.52');
  });
});

describe('ciclos do cartão', () => {
  // Meio-dia em São Paulo: uma data nua é lida como meia-noite UTC e `saoDate`
  // a puxa para o dia anterior, o que faria o teste medir o fuso em vez do
  // ciclo.
  const movement = (day: string, extra: Partial<FinancialEntry> = {}) =>
    entry(`${day}T12:00:00-03:00`, '10.00', extra);

  it('abre um ciclo a cada depósito, do mais novo para o mais velho', () => {
    const cycles = benefitCycles([
      movement('2026-08-24', { entry_type: 'income' }),
      movement('2026-08-27'),
      movement('2026-09-22', { entry_type: 'income' }),
      movement('2026-09-23'),
    ]);
    expect(cycles.map((cycle) => cycle.start)).toEqual([
      '2026-09-22',
      '2026-08-24',
    ]);
    expect(cycles[0].next).toBeNull();
    expect(cycles[1].next).toBe('2026-09-22');
  });

  it('o gasto do dia seguinte ao depósito cai no ciclo novo, não no mês', () => {
    // O cartão não fecha fatura nem vira no dia 1º, então o corte é o depósito.
    // Precisa de dois depósitos para a fronteira existir: com um só, o ciclo é
    // o mais novo e o mais velho ao mesmo tempo e abraça o que veio antes.
    const cycles = benefitCycles([
      movement('2026-08-24', { entry_type: 'income' }),
      movement('2026-09-21'),
      movement('2026-09-22', { entry_type: 'income' }),
      movement('2026-09-23'),
    ]);
    expect(
      cycles[0].entries.map((item) => item.occurred_at.slice(0, 10)),
    ).toEqual(['2026-09-23', '2026-09-22']);
    expect(
      cycles[1].entries.map((item) => item.occurred_at.slice(0, 10)),
    ).toEqual(['2026-09-21', '2026-08-24']);
  });

  it('só o depósito de Alimentação e Refeição abre ciclo', () => {
    // O do Transporte chega noutro dia e partia o mês em dois.
    const cycles = benefitCycles([
      movement('2026-09-22', { entry_type: 'income' }),
      movement('2026-09-22', { entry_type: 'income', category: 'Transporte' }),
      movement('2026-10-22', { entry_type: 'income' }),
      movement('2026-10-24'),
      movement('2026-10-26', { entry_type: 'income', category: 'Transporte' }),
      movement('2026-10-27', { category: 'Transporte' }),
    ]);
    expect(cycles.map((cycle) => cycle.start)).toEqual([
      '2026-10-22',
      '2026-09-22',
    ]);
    expect(cycles[0].entries).toHaveLength(4);
  });

  it('não esconde gasto anterior ao primeiro depósito', () => {
    // Uma lista que engole lançamento é o mesmo defeito que já custou o saldo.
    const cycles = benefitCycles([
      movement('2026-07-01'),
      movement('2026-08-24', { entry_type: 'income' }),
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].entries).toHaveLength(2);
  });

  it('sem depósito nenhum, devolve um ciclo com tudo', () => {
    const all = [movement('2026-07-01'), movement('2026-07-02')];
    const cycles = benefitCycles(all);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].start).toBe('');
    expect(cycles[0].entries).toHaveLength(2);
  });

  it('todo lançamento cai em exatamente um ciclo', () => {
    const all = [
      movement('2026-08-24', { entry_type: 'income' }),
      movement('2026-08-27'),
      movement('2026-09-22', { entry_type: 'income' }),
      movement('2026-09-23'),
      movement('2026-07-01'),
    ];
    const seen = benefitCycles(all).flatMap((cycle) => cycle.entries);
    expect(seen).toHaveLength(all.length);
    expect(new Set(seen.map((item) => item.id)).size).toBe(all.length);
  });
});

describe('ordem das carteiras', () => {
  it('mostra alimentação antes de transporte', () => {
    expect(FLASH_WALLETS.map((wallet) => wallet.key)).toEqual([
      'alimentacao',
      'transporte',
    ]);
  });

  it('a atribuição não depende dessa ordem', () => {
    expect(walletForEntry({ category: 'Transporte' }).key).toBe('transporte');
    expect(walletForEntry({ category: 'Compras' }).key).toBe('alimentacao');
  });
});

describe('previsão do saldo até o próximo depósito', () => {
  const deposit = (day: string, amount = '900.00') =>
    entry(`${day}T15:00:00Z`, amount, { entry_type: 'income' });
  const spend = (day: string, amount: string) =>
    entry(`${day}T15:00:00Z`, amount);

  it('avisa o dia em que o saldo acaba antes do próximo depósito', () => {
    // Depósitos a cada 30 dias: o próximo vem em 22/10. Gastou 300 em 10
    // dias (01/10 a 10/10 contando os dois), 30 por dia; com 240 sobrando, dá
    // mais 8 dias.
    const forecast = benefitForecast(
      '240.00',
      [
        deposit('2026-08-23'),
        deposit('2026-09-22'),
        spend('2026-09-22', '100.00'),
        spend('2026-09-25', '200.00'),
      ],
      '2026-10-01',
    )!;
    expect(forecast.perDay).toBe('30.00');
    expect(forecast.runsOutOn).toBe('2026-10-09');
    expect(forecast.nextDeposit).toBe('2026-10-22');
    expect(forecast.lasts).toBe(false);
    expect(forecast.leftover).toBeNull();
  });

  it('diz quanto sobra quando o saldo aguenta', () => {
    const forecast = benefitForecast(
      '600.00',
      [deposit('2026-09-22'), spend('2026-09-23', '100.00')],
      '2026-10-01',
    )!;
    // Um depósito só: o próximo é estimado em trinta dias.
    expect(forecast.nextDeposit).toBe('2026-10-22');
    expect(forecast.perDay).toBe('10.00');
    expect(forecast.lasts).toBe(true);
    expect(forecast.leftover).toBe('390.00');
  });

  it('só conta o que saiu depois do último depósito', () => {
    const forecast = benefitForecast(
      '500.00',
      [
        deposit('2026-08-23'),
        spend('2026-09-10', '800.00'),
        deposit('2026-09-22'),
        spend('2026-09-24', '50.00'),
      ],
      '2026-09-26',
    )!;
    expect(forecast.perDay).toBe('10.00');
  });

  it('usa o intervalo de costume, não o de um depósito atrasado', () => {
    const forecast = benefitForecast(
      '500.00',
      [
        deposit('2026-06-01'),
        deposit('2026-07-01'),
        deposit('2026-07-31'),
        deposit('2026-09-10'),
        spend('2026-09-12', '30.00'),
      ],
      '2026-09-14',
    )!;
    // Intervalos 30, 30 e 41: a mediana é 30.
    expect(forecast.nextDeposit).toBe('2026-10-10');
  });

  it('não inventa previsão sem base', () => {
    const withDeposit = [deposit('2026-09-22'), spend('2026-09-22', '50.00')];
    // Nenhum depósito: não há ciclo.
    expect(
      benefitForecast('100.00', [spend('2026-09-22', '50.00')], '2026-09-30'),
    ).toBeNull();
    // Dois dias de ciclo: a média seria um gasto só.
    expect(benefitForecast('100.00', withDeposit, '2026-09-23')).toBeNull();
    // Nada gasto ainda.
    expect(
      benefitForecast('100.00', [deposit('2026-09-22')], '2026-09-30'),
    ).toBeNull();
  });

  it('não promete depósito numa data que já passou', () => {
    const forecast = benefitForecast(
      '100.00',
      [deposit('2026-08-01'), spend('2026-08-05', '10.00')],
      '2026-09-05',
    )!;
    expect(forecast.nextDeposit).toBeNull();
    expect(forecast.lasts).toBe(false);
  });
});
