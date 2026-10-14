import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { bankPolicy, type PiggyBank, type TransactionRow } from './domain';
import {
  calculate,
  isoDate,
  parseDate,
  iofExemptionAt,
  settleBalance,
} from './finance';
import {
  buildBankSeries,
  calculatePortfolio,
  portfolioEarnings,
} from './portfolio';

export const movement = (
  id: string,
  amount: string,
  occurred_at: string,
  kind: TransactionRow['kind'] = 'deposit',
): TransactionRow => ({
  id,
  amount,
  occurred_at,
  kind,
  user_id: 'user',
  piggy_bank_id: 'bank',
  created_at: occurred_at,
  updated_at: occurred_at,
  note: null,
});
export const vault = (
  transactions: TransactionRow[],
  name: PiggyBank['bank'] = 'Mercado Pago',
): PiggyBank => {
  const policy = bankPolicy(name);
  return {
    id: 'bank',
    user_id: 'user',
    bank: name,
    name: 'Teste',
    product: policy.product,
    cdi_percentage: policy.cdi,
    tax_rule: policy.taxRule,
    iof_rule: policy.iofRule,
    rate_limit: policy.limit,
    excess_rate: policy.excess,
    policy_version: policy.version,
    accrues_on_deposit_day: false,
    policy_started_at: null,
    policy_ends_at: null,
    archived_at: null,
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    transactions,
    snapshots: [],
  };
};
const now = parseDate('2026-09-04');
const options = { now };

describe('auditoria de regressões financeiras', () => {
  it('reproduz o print Nubank Turbo de 04/09/2026 sem ajuste de saldo', () => {
    const bank = vault(
      [movement('in', '1400.00', '2026-09-01T12:00:00Z')],
      'Nubank',
    );
    const rates = ['2026-09-01', '2026-09-02', '2026-09-03'].map((date) => ({
      date,
      rate: '0.051660',
    }));
    const clock = new Date('2026-09-04T11:10:00-03:00');
    // This print is the evidence the `print` profile was derived from. The
    // shipping default reproduces the balance history instead and splits this
    // day's tax differently, so the profile is pinned here on purpose.
    const options = { now: clock, turboTaxProfile: 'print' as const };
    const result = calculate(bank, rates, clock, options);
    expect(result.grossBalance.toFixed(2)).toBe('1402.50');
    expect(result.grossProfit.toFixed(2)).toBe('2.50');
    expect(result.iof.toFixed(2)).toBe('2.25');
    expect(result.incomeTax.toFixed(2)).toBe('0.05');
    expect(result.netBalance.toFixed(2)).toBe('1400.20');
    expect(result.lots[0].settled.netBalance.toFixed(2)).toBe('1400.20');
    expect(result.lifetimeNetGain.toFixed(2)).toBe('0.20');
    expect(result.dailyBalances.at(-1)?.netBalance.eq(result.netBalance)).toBe(
      true,
    );
    bank.transactions.push(
      movement('out', '1400.20', '2026-09-04T15:00:00-03:00', 'withdrawal'),
    );
    const after = calculate(bank, rates, clock, options);
    expect(after.lots).toHaveLength(0);
    expect(after.unfundedWithdrawals).toHaveLength(0);
    expect(after.redemptions[0].incomeTax.toFixed(2)).toBe('0.05');
  });
  it('aplica truncamento do IR somente ao perfil Nubank Turbo observado', () => {
    const values = {
      principal: new Decimal(1400),
      grossBalance: new Decimal('1402.496660653850'),
      iof: new Decimal('2.246994588465'),
      incomeTax: new Decimal('0.056174864712'),
    };
    expect(
      settleBalance(values, vault([], 'Nubank')).incomeTax.toFixed(2),
    ).toBe('0.05');
    expect(settleBalance(values, vault([])).incomeTax.toFixed(2)).toBe('0.06');
    expect(settleBalance(values).incomeTax.toFixed(2)).toBe('0.06');
    expect(
      settleBalance(values, {
        bank: 'Nubank',
        policy_version: 'UNVERIFIED',
      }).incomeTax.toFixed(2),
    ).toBe('0.06');
  });
  it('contador de IOF e cálculo zeram juntos, pela data de São Paulo', () => {
    const occurred = '2026-09-02T01:00:00Z'; // 01/09, 22h em São Paulo
    expect(iofExemptionAt(occurred).toISOString()).toBe(
      '2026-10-01T03:00:00.000Z',
    );
    const bank = vault([movement('in', '1000', occurred)], 'Nubank');
    const rates = [{ date: '2026-09-02', rate: '0.1' }];
    const at = iofExemptionAt(occurred);
    expect(calculate(bank, rates, at, { now: at }).iof.toFixed(2)).toBe('0.00');
    const before = new Date(at.getTime() - 1000);
    expect(calculate(bank, rates, before, { now: before }).iof.gt(0)).toBe(
      true,
    );
  });
  it('resgate por múltiplos lotes separa impostos e conserva centavos', () => {
    const bank = vault(
      [
        movement('old', '270.13', '2026-08-03T12:00:00Z'),
        movement('new', '510.27', '2026-09-01T12:00:00Z'),
      ],
      'Nubank',
    );
    const rates = [
      { date: '2026-08-03', rate: '0.051660' },
      { date: '2026-09-01', rate: '0.051660' },
      { date: '2026-09-02', rate: '0.051660' },
      { date: '2026-09-03', rate: '0.051660' },
    ];
    const before = calculate(bank, rates, now, options);
    bank.transactions.push(
      movement('out', '400.00', '2026-09-04T18:00:00-03:00', 'withdrawal'),
    );
    const after = calculate(bank, rates, now, options);
    expect(after.netBalance.plus(400).eq(before.netBalance)).toBe(true);
    const redemption = after.redemptions[0];
    expect(
      redemption.grossAmount
        .minus(redemption.iof)
        .minus(redemption.incomeTax)
        .eq(redemption.netAmount),
    ).toBe(true);
    expect(redemption.roundingDifference.isZero()).toBe(true);
    expect(after.lifetimeNetGain.eq(before.lifetimeNetGain)).toBe(true);
  });
  it('série de dois anos preserva o saldo e as 14 barras em uma única linha do tempo', () => {
    const bank = vault([movement('old', '1000', '2024-09-04T12:00:00Z')]);
    const rates = [
      { date: '2024-09-04', rate: '0.05' },
      { date: '2026-09-03', rate: '0.05' },
    ];
    const series = buildBankSeries([bank], rates, now);
    expect(series.points).toHaveLength(14);
    expect(
      series.points[13].value.eq(
        calculate(bank, rates, now, options).netBalance,
      ),
    ).toBe(true);
  });
  it('não conta aportes como ganho no gráfico', () => {
    const bank = vault([movement('in', '1835', '2026-09-04T12:00:00Z')]);
    const series = buildBankSeries([bank], [], now);
    expect(series.points[13].value.toFixed(2)).toBe('1835.00');
    expect(series.points[13].dailyNetGain.toFixed(2)).toBe('0.00');
  });
  it('o gráfico para no último saldo do banco, sem dia previsto', () => {
    const base = vault([movement('in', '1000', '2026-09-01T12:00:00Z')]);
    const bank = {
      ...base,
      snapshots: [
        {
          id: 's1',
          user_id: base.user_id,
          piggy_bank_id: base.id,
          snapshot_date: '2026-09-02',
          gross_balance: '1000.10',
          net_balance: '1000.10',
          source: 'pluggy',
          created_at: '2026-09-02T12:00:00Z',
        },
      ],
    } as PiggyBank;
    const series = buildBankSeries([bank], [], now);
    expect(series.lastDate).toBe('2026-09-02');
    expect(isoDate(series.points.at(-1)!.date)).toBe('2026-09-02');
    expect(series.points.every((point) => !point.today)).toBe(true);
  });
  it('exibe patrimônio e ganhos unificados como soma exata das duas views', () => {
    const mp = vault([movement('a', '1835', '2026-09-01T12:00:00Z')]);
    const nu = {
      ...vault([movement('b', '1400', '2026-09-01T12:00:00Z')], 'Nubank'),
      id: 'nu',
    };
    const rates = ['2026-09-01', '2026-09-02', '2026-09-03'].map((date) => ({
      date,
      rate: '0.051660',
    }));
    const a = buildBankSeries([mp], rates, now);
    const b = buildBankSeries([nu], rates, now);
    const all = buildBankSeries([mp, nu], rates, now);
    for (let i = 0; i < all.points.length; i++) {
      expect(
        all.points[i].value.eq(a.points[i].value.plus(b.points[i].value)),
      ).toBe(true);
      expect(
        all.points[i].dailyNetGain.eq(
          a.points[i].dailyNetGain.plus(b.points[i].dailyNetGain),
        ),
      ).toBe(true);
    }
    const portfolio = calculatePortfolio([mp, nu], rates, now, options);
    expect(all.points[13].value.eq(portfolio.netBalance)).toBe(true);
    expect(
      all.points[13].dailyNetGain.eq(
        portfolioEarnings(portfolio, '2026-09-04', '2026-09-04'),
      ),
    ).toBe(true);
  });
  it('ganho desde o início permanece após resgatar tudo', () => {
    const bank = vault([movement('in', '1835', '2026-09-01T12:00:00Z')]);
    const rates = [{ date: '2026-09-01', rate: '0.051660' }];
    const before = calculate(bank, rates, parseDate('2026-09-02'), options);
    bank.transactions.push(
      movement(
        'out',
        before.netBalance.toFixed(2),
        '2026-09-02T18:00:00-03:00',
        'withdrawal',
      ),
    );
    const after = calculate(bank, rates, now, options);
    expect(after.netBalance.isZero()).toBe(true);
    expect(after.lifetimeNetGain.eq(before.netBalance.minus('1835'))).toBe(
      true,
    );
    expect(after.redemptions[0].iof.toFixed(2)).toBe('0.00');
    expect(after.redemptions[0].netAmount.eq(before.netBalance)).toBe(true);
  });
  it('aguarda a liquidação útil de depósitos do fim de semana e pula feriados', () => {
    const bank = vault([movement('in', '1000', '2026-09-05T12:00:00Z')]);
    const rates = [
      { date: '2026-09-04', rate: '0.1' },
      { date: '2026-09-08', rate: '0.2' },
    ];
    const clock = parseDate('2026-09-10');
    expect(
      calculate(bank, rates, parseDate('2026-09-08'), {
        now: clock,
      }).grossProfit.toFixed(2),
    ).toBe('0.00');
    expect(
      calculate(bank, rates, parseDate('2026-09-09'), {
        now: clock,
      }).grossProfit.toFixed(2),
      // Mercado Pago withholds as it credits, so the vault's profit is the net
      // 2.40 - 22.5%. What this pins is the day it starts, not the amount.
    ).toBe('1.86');
  });
  it.each(['Nubank', 'Mercado Pago'] as const)(
    'retiradas parciais conservam caixa em diferentes valores: %s',
    (name) => {
      const rates = ['2026-09-01', '2026-09-02', '2026-09-03'].map((date) => ({
        date,
        rate: '0.051660',
      }));
      for (let i = 1; i <= 40; i++) {
        const amount = new Decimal(i).mul('17.37');
        const bank = vault(
          [movement('in', amount.toFixed(2), '2026-09-01T12:00:00Z')],
          name,
        );
        const before = calculate(bank, rates, now, options);
        const cash = amount.mul('0.37').toDecimalPlaces(2);
        bank.transactions.push(
          movement(
            'out',
            cash.toFixed(2),
            '2026-09-04T18:00:00-03:00',
            'withdrawal',
          ),
        );
        const after = calculate(bank, rates, now, options);
        expect(after.netBalance.plus(cash).toFixed(2), `caso ${i}`).toBe(
          before.netBalance.toFixed(2),
        );
        expect(after.lifetimeNetGain.toFixed(2)).toBe(
          before.lifetimeNetGain.toFixed(2),
        );
        expect(
          after.netBalance
            .plus(after.iof)
            .plus(after.incomeTax)
            .eq(after.grossBalance),
        ).toBe(true);
      }
    },
  );
  it('usa o CDI da aplicação até a véspera da data de avaliação, não a taxa do dia seguinte', () => {
    const bank = vault([movement('a', '1000', '2026-09-01T12:00:00Z')]);
    const result = calculate(
      bank,
      [
        { date: '2026-09-01', rate: '0.10' },
        { date: '2026-09-02', rate: '0.20' },
      ],
      parseDate('2026-09-02'),
      options,
    );
    // 0.93 is the 0.10 rate net of income tax; the 0.20 rate would give 1.86.
    expect(result.grossProfit.toFixed(2)).toBe('0.93');
  });
  it('não usa um aporte das 18h para financiar uma retirada das 08h', () => {
    const bank = vault([
      movement('out', '100', '2026-09-01T08:00:00-03:00', 'withdrawal'),
      movement('in', '100', '2026-09-01T18:00:00-03:00'),
    ]);
    const result = calculate(bank, [], parseDate('2026-09-01'), options);
    expect(result.netBalance.toFixed(2)).toBe('100.00');
    expect(result.unfundedWithdrawals[0].amount.toFixed(2)).toBe('100.00');
  });
  it('ordena instantes equivalentes com offsets diferentes, não texto de timestamp', () => {
    const bank = vault([
      movement('in', '100', '2026-09-02T00:30:00Z'),
      movement('out', '100', '2026-09-01T22:00:00-03:00', 'withdrawal'),
    ]);
    expect(
      calculate(bank, [], parseDate('2026-09-02'), options).netBalance.toFixed(
        2,
      ),
    ).toBe('0.00');
  });
  it('sacar todo o saldo exibido não deixa lotes ou rendimentos fantasmas', () => {
    const bank = vault([movement('in', '1000', '2026-09-01T12:00:00Z')]);
    const rates = [
      { date: '2026-09-01', rate: '0.051660' },
      { date: '2026-09-02', rate: '0.051660' },
    ];
    const balance = calculate(
      bank,
      rates,
      parseDate('2026-09-02'),
      options,
    ).netBalance;
    bank.transactions.push(
      movement(
        'out',
        balance.toFixed(2),
        '2026-09-02T18:00:00-03:00',
        'withdrawal',
      ),
    );
    const result = calculate(bank, rates, parseDate('2026-09-03'), options);
    expect(result.lots).toHaveLength(0);
    expect(result.netBalance.toFixed(2)).toBe('0.00');
    expect(result.unfundedWithdrawals).toHaveLength(0);
  });
  it('projeção parte da mesma estimativa automática usada no dia atual', () => {
    const bank = vault([movement('in', '1000', '2026-09-01T12:00:00Z')]);
    const rates = [{ date: '2026-09-01', rate: '0.1' }];
    // A estimativa em si, sem o atraso de CDI do Mercado Pago (que usa a
    // taxa de dois dias úteis antes e por isso quase nunca estima).
    const current = calculate(bank, rates, now, {
      ...options,
      cdiLagBusinessDays: 0,
    });
    const projected = calculate(bank, rates, now, {
      now,
      mode: 'projection',
      cdiLagBusinessDays: 0,
    });
    expect(projected.netBalance.toFixed(2)).toBe(current.netBalance.toFixed(2));
    // Só a taxa de 01/09 foi publicada. O crédito de 03/09 (taxa de 02/09) e o
    // de hoje (taxa de 03/09) dependem ambos de estimativa. Este teste antes
    // esperava só ['2026-09-04'] — isto é, que o crédito de 03/09 sumisse, que
    // era o defeito que tirava um dia inteiro de rendimento do app aos
    // domingos (27/09/2026: R$ 1,24 de bruto).
    expect(current.estimatedDates).toEqual(['2026-09-03', '2026-09-04']);
    expect(projected.estimatedDates).toEqual(current.estimatedDates);
  });
  it('rejeita valores não finitos e datas inexistentes na entrada do motor', () => {
    expect(() =>
      calculate(
        vault([movement('in', 'NaN', '2026-09-01T12:00:00Z')]),
        [],
        now,
        options,
      ),
    ).toThrow();
    expect(() => parseDate('2026-02-31')).toThrow();
  });
  it('rendimentos diários em centavos fecham com o lucro total sem movimentações', () => {
    const bank = vault([movement('in', '1835', '2026-09-01T12:00:00Z')]);
    const result = calculate(
      bank,
      [
        { date: '2026-09-01', rate: '0.051660' },
        { date: '2026-09-02', rate: '0.051660' },
        { date: '2026-09-03', rate: '0.051660' },
      ],
      now,
      options,
    );
    const displayedSum = result.earnings.reduce(
      (sum, row) => sum.plus(row.netAmount.toDecimalPlaces(2)),
      new Decimal(0),
    );
    expect(displayedSum.toFixed(2)).toBe(
      result.netBalance.minus(result.principal).toFixed(2),
    );
  });
});
