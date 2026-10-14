import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  bankPolicy,
  type PiggyBank,
  type TransactionRow,
  type BankEarningCredit,
} from './domain';
import { calculate, parseDate } from './finance';
import {
  calculatePortfolio,
  buildPortfolioSeries,
  portfolioEarnings,
} from './portfolio';
import { mergeEarningStatement } from './earning-statement';

const rates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map(
  (date) => ({ date, rate: '0.051660' }),
);
const now = new Date('2026-09-04T12:20:00-03:00');
const movement = (
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
  piggy_bank_id: 'mp',
  note: null,
  created_at: occurred_at,
  updated_at: occurred_at,
});
const credit = (
  day: string,
  amount = '0.87',
  time = '07:45:12',
): BankEarningCredit => ({
  id: `credit-${day}`,
  user_id: 'user',
  piggy_bank_id: 'mp',
  occurred_at: `2026-09-${day}T${time}Z`,
  net_amount: amount,
  source: 'Fixture do extrato fornecido pelo titular',
  created_at: '2026-09-04T15:20:00Z',
});
function bank(): PiggyBank {
  const policy = bankPolicy('Mercado Pago');
  return {
    id: 'mp',
    user_id: 'user',
    bank: 'Mercado Pago',
    name: 'Cofrinho de teste',
    product: policy.product,
    cdi_percentage: 120,
    rate_limit: 10000,
    excess_rate: 100,
    tax_rule: 'Regressivo',
    iof_rule: 'Isento',
    policy_version: policy.version,
    accrues_on_deposit_day: false,
    policy_started_at: null,
    policy_ends_at: null,
    archived_at: null,
    created_at: '2026-09-01',
    updated_at: '2026-09-01',
    snapshots: [],
    transactions: [movement('deposit', '1835', '2026-09-01T11:18:04Z')],
    earningCredits: [
      credit('02', '0.87', '07:42:16'),
      credit('03'),
      credit('04', '0.88', '07:00:13'),
    ],
  };
}
const run = (subject = bank(), at = now) =>
  calculate(subject, rates, at, { now: at });

describe('Mercado Pago: créditos líquidos conciliados no motor', () => {
  it('conserva o saldo em 80 retiradas parciais depois de créditos e juros estimados', () => {
    const at = new Date('2026-09-09T15:00:00-03:00');
    const allRates = [...rates, { date: '2026-09-08', rate: '0.051660' }];
    const before = calculate(bank(), allRates, at, { now: at });
    for (let i = 1; i <= 80; i++) {
      const subject = bank();
      const cash = new Decimal(i).mul('19.37');
      subject.transactions.push(
        movement(
          `out-${i}`,
          cash.toFixed(2),
          '2026-09-09T14:00:00Z',
          'withdrawal',
        ),
      );
      const after = calculate(subject, allRates, at, { now: at });
      expect(after.netBalance.eq(before.netBalance.minus(cash))).toBe(true);
      expect(after.lifetimeNetGain.eq(before.lifetimeNetGain)).toBe(true);
      expect(after.redemptions[0].roundingDifference.isZero()).toBe(true);
      expect(after.redemptions[0].taxDetailsIncomplete).toBe(true);
    }
  });
  it('não devolve IR fictício dos créditos antigos ao mudar de faixa tributária', () => {
    const at = parseDate('2027-03-05');
    const result = calculate(bank(), [], at, { now: at });
    expect(result.netBalance.toFixed(2)).toBe('1837.62');
    expect(result.earnings).toHaveLength(3);
    expect(result.incomeTax.isZero()).toBe(true);
  });
  it('fecha as quatro linhas do extrato sem tratar juros como aporte', () => {
    const result = run();
    expect(
      result.dailyBalances.map((row) => row.netBalance.toFixed(2)),
    ).toEqual(['1835.00', '1835.87', '1836.74', '1837.62']);
    expect(result.earnings.map((row) => row.netAmount.toFixed(2))).toEqual([
      '0.87',
      '0.87',
      '0.88',
    ]);
    expect(result.netBalance.toFixed(2)).toBe('1837.62');
    expect(result.principal.toFixed(2)).toBe('1835.00');
    expect(result.lifetimeNetGain.toFixed(2)).toBe('2.62');
    expect(result.taxDetailsIncomplete).toBe(true);
    expect(result.confirmedCreditCount).toBe(3);
    expect(result.iof.toFixed(2)).toBe('0.00');
  });
  it('usa os dois créditos já conhecidos como base e estima 04/09 em 0,88, sem forçar a taxa', () => {
    const subject = bank();
    subject.earningCredits = subject.earningCredits!.slice(0, 2);
    const result = run(subject);
    expect(result.earnings.at(-1)?.netAmount.toFixed(2)).toBe('0.88');
    expect(result.earnings.at(-1)?.confirmed).not.toBe(true);
    expect(result.netBalance.toFixed(2)).toBe('1837.62');
  });
  it('estima o rendimento de hoje quando a última taxa do BCB ainda não foi publicada', () => {
    const subject = bank();
    const at = new Date('2026-09-11T12:20:00-03:00');
    const published = [
      ...rates,
      { date: '2026-09-08', rate: '0.051660' },
      { date: '2026-09-09', rate: '0.051660' },
    ];
    // O mecanismo de estimativa, sem o atraso de CDI do Mercado Pago — com
    // ele, a taxa que paga hoje já saiu há dias (teste logo abaixo).
    const options = { now: at, cdiLagBusinessDays: 0 };
    const pending = calculate(subject, published, at, options);
    const official = calculate(
      subject,
      [...published, { date: '2026-09-10', rate: '0.051660' }],
      at,
      options,
    );

    expect(pending.estimatedDates).toContain('2026-09-11');
    expect(pending.missingRateDates).toEqual([]);
    expect(pending.earnings.at(-1)?.date).toBe('2026-09-11');
    expect(pending.earnings.at(-1)?.netAmount.gt(0)).toBe(true);
    expect(official.estimatedDates).not.toContain('2026-09-11');
    expect(official.netBalance.eq(pending.netBalance)).toBe(true);
  });
  it('crédito confirmado não depende de CDI publicado e não ganha juros duas vezes', () => {
    const a = calculate(bank(), [], now, { now });
    const b = run();
    expect(a.netBalance.eq(b.netBalance)).toBe(true);
    expect(a.missingRateDates).toEqual([]);
    expect(a.earnings).toHaveLength(3);
  });
  it('o extrato usa o mesmo diário e não inventa bruto ou IR dos créditos', () => {
    const subject = bank();
    const result = run(subject);
    const statement = mergeEarningStatement(
      result.earnings,
      subject.earningCredits,
    );
    expect(statement).toHaveLength(3);
    expect(
      statement.every(
        (row) =>
          row.confirmed &&
          row.appliedToBalance &&
          row.grossAmount === null &&
          row.taxes === null &&
          row.incomeTax === undefined,
      ),
    ).toBe(true);
    expect(
      statement
        .reduce((sum, row) => sum.plus(row.netAmount), new Decimal(0))
        .eq(result.lifetimeNetGain),
    ).toBe(true);
  });
  it('dashboard, gráfico e previsão partem do mesmo saldo, sem retributar créditos', () => {
    const portfolio = calculatePortfolio([bank()], rates, now, { now });
    const chart = buildPortfolioSeries([bank()], rates, now);
    expect(chart.points[6].value.eq(portfolio.netBalance)).toBe(true);
    expect(chart.points[6].dailyNetGain.toFixed(2)).toBe('0.88');
    expect(portfolioEarnings(portfolio).toFixed(2)).toBe('2.62');
    expect(chart.points[7].dailyNetGain.toFixed(2)).toBe('0.88');
    expect(
      chart.projectedTotal.minus(portfolio.netBalance).eq(chart.projectedGain),
    ).toBe(true);
  });
  it('reproduz retirada integral sem resíduos nem cobrança adicional sobre o crédito', () => {
    const subject = bank();
    subject.transactions.push(
      movement('out', '1837.62', '2026-09-04T14:00:00Z', 'withdrawal'),
    );
    const result = run(subject);
    expect(result.netBalance.toFixed(2)).toBe('0.00');
    expect(result.lots).toHaveLength(0);
    expect(result.unfundedWithdrawals).toHaveLength(0);
    expect(result.redemptions[0].incomeTax.toFixed(2)).toBe('0.00');
    expect(result.lifetimeNetGain.toFixed(2)).toBe('2.62');
    expect(
      buildPortfolioSeries([subject], rates, now).projectedTotal.toFixed(2),
    ).toBe('0.00');
  });
  it('retirada parcial fecha em centavos e os créditos remanescentes continuam sem dupla tributação', () => {
    const subject = bank();
    subject.transactions.push(
      movement('out', '500.01', '2026-09-04T14:00:00Z', 'withdrawal'),
    );
    const result = run(subject);
    expect(result.netBalance.toFixed(2)).toBe('1337.61');
    expect(result.redemptions[0].netAmount.toFixed(2)).toBe('500.01');
    expect(result.redemptions[0].roundingDifference.toFixed(2)).toBe('0.00');
    expect(result.lifetimeNetGain.toFixed(2)).toBe('2.62');
    expect(result.incomeTax.toFixed(2)).toBe('0.00');
  });
  it('um crédito posterior não financia uma retirada anterior no mesmo dia', () => {
    const subject = bank();
    subject.transactions.push(
      movement('out', '1837.62', '2026-09-04T06:00:00Z', 'withdrawal'),
    );
    const result = run(subject);
    expect(result.unfundedWithdrawals[0].amount.toFixed(2)).toBe('0.88');
    expect(result.netBalance.toFixed(2)).toBe('0.88');
    expect(result.principal.toFixed(2)).toBe('0.00');
    expect(result.lifetimeNetGain.toFixed(2)).toBe('2.62');
  });
  it('não lê créditos de horários futuros, mesmo durante uma projeção', () => {
    const subject = bank();
    const at = new Date('2026-09-04T03:00:00Z');
    const result = calculate(subject, [], parseDate('2026-09-10'), {
      now: at,
      mode: 'projection',
    });
    expect(result.confirmedCreditCount).toBe(2);
    expect(result.netBalance.toFixed(2)).toBe('1836.74');
  });
  it('deduplica id e horário sem duplicar rendimentos', () => {
    const subject = bank();
    subject.earningCredits!.push(subject.earningCredits![0], {
      ...subject.earningCredits![1],
      id: 'duplicate',
    });
    expect(run(subject).netBalance.toFixed(2)).toBe('1837.62');
    expect(run(subject).confirmedCreditCount).toBe(3);
  });
  it('rejeita créditos conflitantes ou pertencentes a outra carteira', () => {
    for (const change of [
      { net_amount: '0.99' },
      { piggy_bank_id: 'another' },
      { user_id: 'another' },
      { net_amount: '-0.01' },
      { net_amount: '0.001' },
    ]) {
      const subject = bank();
      subject.earningCredits!.push({
        ...subject.earningCredits![0],
        ...change,
      });
      expect(() => run(subject)).toThrow();
    }
  });
  it('não altera o motor Nubank quando existem observações líquidas', () => {
    const subject = bank();
    subject.bank = 'Nubank';
    subject.iof_rule = 'Regressivo';
    subject.policy_version = 'NUB-TURBO-115';
    subject.cdi_percentage = 115;
    const a = run(subject);
    const b = run({ ...subject, earningCredits: [] });
    expect(a.netBalance.eq(b.netBalance)).toBe(true);
    expect(a.confirmedCreditCount).toBe(0);
  });
  it('não altera o histórico confirmado quando o CDI é corrigido posteriormente', () => {
    const revisedRates = rates.map((rate) => ({ ...rate, rate: '0.060000' }));
    expect(
      calculate(bank(), revisedRates, now, { now }).netBalance.eq(
        run().netBalance,
      ),
    ).toBe(true);
  });
  it('saldo unificado soma cofrinhos sem vazar créditos entre eles', () => {
    const a = bank();
    const b = {
      ...bank(),
      id: 'other',
      earningCredits: [],
      transactions: [
        {
          ...movement('other-in', '100', '2026-09-04T10:00:00Z'),
          piggy_bank_id: 'other',
        },
      ],
    };
    expect(
      calculatePortfolio([a, b], rates, now, { now }).netBalance.toFixed(2),
    ).toBe('1937.62');
  });
});

describe('Mercado Pago paga com o CDI de dois dias úteis antes', () => {
  // O indício foi o corte da Selic de 16/09/2026: com o CDI do próprio dia, o
  // modelo acertava todos os saldos e créditos até 16/09 e depois ficava 2 a 4
  // centavos abaixo, como se a taxa antiga seguisse pagando por dois dias.
  const deposit = (): PiggyBank => {
    const subject = bank();
    subject.earningCredits = [];
    subject.snapshots = [];
    return subject;
  };
  const series = [
    ['2026-09-08', '0.051660'],
    ['2026-09-09', '0.051660'],
    ['2026-09-10', '0.051660'],
    ['2026-09-11', '0.051660'],
    ['2026-09-14', '0.051660'],
    ['2026-09-15', '0.051660'],
    ['2026-09-16', '0.051660'],
    ['2026-09-17', '0.050788'],
    ['2026-09-18', '0.050788'],
    ['2026-09-21', '0.050788'],
    ['2026-09-22', '0.050788'],
  ].map(([date, rate]) => ({ date, rate }));
  const at = new Date('2026-09-23T12:00:00-03:00');
  const earned = (lag: number) =>
    new Map(
      calculate(deposit(), [...rates, ...series], at, {
        now: at,
        cdiLagBusinessDays: lag,
      }).earnings.map((entry) => [entry.date, entry.netAmount.toNumber()]),
    );

  it('segue pagando a taxa antiga por dois dias úteis depois do corte', () => {
    const lagged = earned(2);
    const sameDay = earned(0);
    // 18/09 credita a competência de 17/09, o primeiro dia do CDI novo. Com
    // o atraso, 17 e 18/09 ainda pagam o CDI de 15 e 16/09.
    expect(lagged.get('2026-09-18')!).toBeGreaterThan(
      sameDay.get('2026-09-18')!,
    );
    expect(lagged.get('2026-09-21')!).toBeGreaterThan(
      sameDay.get('2026-09-21')!,
    );
    // A partir daí o CDI novo chega aos dois, e o saldo maior de quem recebeu
    // a taxa antiga por mais tempo é a única diferença.
    expect(
      Math.abs(lagged.get('2026-09-23')! - sameDay.get('2026-09-23')!),
    ).toBeLessThanOrEqual(0.01);
  });

  it('é o padrão do Mercado Pago, e só dele', () => {
    const shipping = calculate(deposit(), [...rates, ...series], at, {
      now: at,
    });
    expect(
      shipping.earnings
        .find((entry) => entry.date === '2026-09-18')!
        .netAmount.toNumber(),
    ).toBe(earned(2).get('2026-09-18'));
  });

  it('não precisa estimar o dia de hoje: a taxa que paga já foi publicada', () => {
    const today = new Date('2026-09-23T12:20:00-03:00');
    // O BCB ainda não publicou 22/09, que pagaria hoje sem o atraso.
    const published = [...rates, ...series.slice(0, -1)];
    const lagged = calculate(deposit(), published, today, { now: today });
    const sameDay = calculate(deposit(), published, today, {
      now: today,
      cdiLagBusinessDays: 0,
    });
    expect(sameDay.estimatedDates).toContain('2026-09-23');
    expect(lagged.estimatedDates).toEqual([]);
  });
});
