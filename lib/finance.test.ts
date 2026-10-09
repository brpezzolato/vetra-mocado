import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { mergePublishedRates, normalizeBcbRates } from './cdi';
import {
  bankPolicy,
  type BankName,
  type PiggyBank,
  type TransactionKind,
} from './domain';
import {
  calculate as calculateEngine,
  earningCreditDate,
  irRate,
  isoDate,
  parseDate,
  settleBalance,
  makeCalendar,
} from './finance';
import { nationalFinancialHolidays } from './business-calendar';

// The original scenarios intentionally simulate full historical/future days.
const calculate = (
  subject: PiggyBank,
  rates: Parameters<typeof calculateEngine>[1],
  asOf?: Date,
) =>
  calculateEngine(subject, rates, asOf, {
    mode: 'projection',
    now: parseDate('2026-09-02'),
  });

describe('saldo atual separado de projeções', () => {
  it('estima automaticamente apenas a publicação recente ainda pendente', () => {
    const subject = bank('Mercado Pago', 1835);
    subject.transactions = [transaction(1835, '2026-09-01')];
    const rates = [
      { date: '2026-09-02', rate: '0.051660' },
      { date: '2026-09-04', rate: '0.051660' },
    ];
    const now = new Date('2026-09-04T00:30:00-03:00');
    const realized = calculateEngine(subject, rates, now, { now });
    expect(realized.lots[0].businessDays).toBe(1);
    expect(realized.estimatedDates).toEqual([]);
    expect(realized.missingRateDates).toEqual(['2026-09-01', '2026-09-03']);
    expect(realized.earnings.map((entry) => entry.date)).toEqual([
      '2026-09-03',
    ]);
    const projected = calculateEngine(subject, rates, parseDate('2026-09-08'), {
      mode: 'projection',
      now,
    });
    expect(projected.netBalance.gt(realized.netBalance)).toBe(true);
    // 08/09 carries the already-published 04/09 factor (07/09 is a holiday).
    expect(projected.estimatedDates).toEqual([]);
  });
  it('incorpora uma publicação atrasada sem intervenção do usuário', () => {
    const subject = bank('Mercado Pago', 1835);
    const now = new Date('2026-09-04T00:30:00-03:00');
    const rates = [
      { date: '2026-08-31', rate: '0.05' },
      { date: '2026-09-01', rate: '0.05' },
      { date: '2026-09-02', rate: '0.05' },
    ];
    // O mecanismo de publicação, não o calendário do Mercado Pago: sem o
    // atraso de CDI dele, que quase nunca precisa de estimativa.
    const options = { now, cdiLagBusinessDays: 0 };
    const before = calculateEngine(subject, rates, now, options);
    const after = calculateEngine(
      subject,
      [...rates, { date: '2026-09-03', rate: '0.05' }],
      now,
      options,
    );
    expect(before.estimatedDates).toEqual(['2026-09-04']);
    expect(before.missingRateDates).toEqual([]);
    expect(after.netBalance.eq(before.netBalance)).toBe(true);
    expect(after.estimatedDates).toEqual([]);
    expect(after.missingRateDates).toEqual([]);
  });
  it('preserva o aporte de hoje sem acrescentar juros de hoje', () => {
    const subject = bank('Mercado Pago', 1835);
    subject.transactions = [transaction(1835, '2026-09-04')];
    const now = new Date('2026-09-04T15:00:00-03:00');
    expect(
      calculateEngine(subject, [{ date: '2026-09-04', rate: '0.05' }], now, {
        now,
      }).netBalance.toFixed(2),
    ).toBe('1835.00');
  });
  it('atribui movimentos perto da meia-noite à data de São Paulo', () => {
    expect(parseDate('2026-09-02T01:00:00Z').toISOString()).toBe(
      '2026-09-01T12:00:00.000Z',
    );
    const subject = bank('Mercado Pago', 1835);
    subject.transactions[0].occurred_at = '2026-09-02T01:00:00Z';
    const now = new Date('2026-09-03T12:00:00-03:00');
    const result = calculateEngine(
      subject,
      [{ date: '2026-09-02', rate: '0.05' }],
      now,
      { now },
    );
    expect(result.lots[0].businessDays).toBe(1);
  });
});

const transaction = (
  amount: number,
  date: string,
  kind: TransactionKind = 'deposit',
) => ({
  id: `${date}-${amount}-${kind}`,
  user_id: 'user',
  piggy_bank_id: 'bank',
  kind,
  amount,
  occurred_at: `${date}T12:00:00Z`,
  note: null,
  created_at: `${date}T12:00:00Z`,
  updated_at: `${date}T12:00:00Z`,
});

function bank(bankName: BankName, amount: number): PiggyBank {
  const policy = bankPolicy(bankName);
  return {
    id: 'bank',
    user_id: 'user',
    bank: bankName,
    name: 'Teste',
    product: policy.product,
    cdi_percentage: policy.cdi,
    tax_rule: policy.taxRule,
    iof_rule: policy.iofRule,
    accrues_on_deposit_day: policy.accruesOnDepositDay,
    rate_limit: policy.limit,
    excess_rate: policy.excess,
    policy_version: policy.version,
    policy_started_at: null,
    policy_ends_at: null,
    archived_at: null,
    created_at: '2026-08-31T12:00:00Z',
    updated_at: '2026-08-31T12:00:00Z',
    transactions: [transaction(amount, '2026-08-31')],
    snapshots: [],
  };
}

describe('CDI do Banco Central', () => {
  it('preserva histórico quando só a consulta recente funciona e aceita correções oficiais', () => {
    expect(
      mergePublishedRates(
        [
          { date: '2025-01-02', rate: '0.04' },
          { date: '2026-09-02', rate: '0.05' },
        ],
        [
          { date: '2026-09-02', rate: '0.051' },
          { date: '2026-09-03', rate: '0.052' },
        ],
      ),
    ).toEqual([
      { date: '2025-01-02', rate: '0.04' },
      { date: '2026-09-02', rate: '0.051' },
      { date: '2026-09-03', rate: '0.052' },
    ]);
  });
  it('ordena, deduplica e preserva casas decimais sem passar por Number', () => {
    expect(
      normalizeBcbRates([
        { data: '02/09/2026', valor: '0,0516601234' },
        { data: '01/09/2026', valor: '0,05' },
        { data: '01/09/2026', valor: '0,05' },
      ]),
    ).toEqual([
      { date: '2026-09-01', rate: '0.0500000000' },
      { date: '2026-09-02', rate: '0.0516601234' },
    ]);
  });
  it('rejeita datas inexistentes e taxas conflitantes', () => {
    expect(() =>
      normalizeBcbRates([{ data: '31/02/2026', valor: '0,05' }]),
    ).toThrow();
    expect(() =>
      normalizeBcbRates([
        { data: '01/09/2026', valor: '0,05' },
        { data: '01/09/2026', valor: '0,06' },
      ]),
    ).toThrow();
  });
  it('preserva a série 12, que já vem em percentual ao dia', () => {
    expect(
      normalizeBcbRates([{ data: '31/08/2026', valor: '0,051660' }]),
    ).toEqual([{ date: '2026-08-31', rate: '0.0516600000' }]);
  });
});

describe('calendário financeiro', () => {
  it('pula 7 de setembro sem precisar de CDI publicado', () => {
    expect(
      makeCalendar([])
        .move(parseDate('2026-09-04'), 1)
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-09-08');
  });
  it('inclui feriados móveis verificados na ANBIMA para 2026', () => {
    const holidays = nationalFinancialHolidays(2026);
    for (const date of [
      '2026-02-16',
      '2026-02-17',
      '2026-04-03',
      '2026-06-04',
      '2026-11-20',
    ])
      expect(holidays.has(date)).toBe(true);
    expect(holidays.has('2026-07-09')).toBe(false);
  });
  it('consegue voltar antes do início da série e usa a última taxa cronológica', () => {
    const calendar = makeCalendar([
      { date: '2026-09-02', rate: '0.06' },
      { date: '2026-09-01', rate: '0.05' },
    ]);
    expect(calendar.lastRate.toString()).toBe('0.06');
    expect(
      calendar.move(parseDate('2026-09-01'), -1).toISOString().slice(0, 10),
    ).toBe('2026-08-31');
    expect(() => calendar.move(parseDate('2026-09-01'), 0.5)).toThrow();
  });

  it('separa o calendário de crédito de Nubank e Mercado Pago', () => {
    const calendar = makeCalendar([]);
    const friday = parseDate('2026-09-04');
    expect(isoDate(earningCreditDate('Nubank', friday, calendar))).toBe(
      '2026-09-05',
    );
    expect(isoDate(earningCreditDate('Mercado Pago', friday, calendar))).toBe(
      '2026-09-08',
    );
  });

  it('não lança crédito em feriado', () => {
    const calendar = makeCalendar([]);
    expect(
      isoDate(earningCreditDate('Nubank', parseDate('2026-04-20'), calendar)),
    ).toBe('2026-04-22');
    expect(
      isoDate(
        earningCreditDate('Mercado Pago', parseDate('2026-09-04'), calendar),
      ),
    ).toBe('2026-09-08');
  });
});

describe('motor financeiro', () => {
  it('não inventa juros com taxa fixa quando o CDI está indisponível', () => {
    const result = calculate(
      bank('Mercado Pago', 1000),
      [],
      parseDate('2026-09-02'),
    );
    expect(result.grossProfit.isZero()).toBe(true);
    expect(result.missingRateDates).toEqual(['2026-08-31', '2026-09-01']);
    expect(result.estimatedDates).toEqual([]);
  });
  it('informa lacunas históricas e dias estimados separadamente', () => {
    const result = calculateEngine(
      bank('Mercado Pago', 1000),
      [
        { date: '2026-08-31', rate: '0.1' },
        { date: '2026-09-02', rate: '0.1' },
      ],
      parseDate('2026-09-08'),
      // Lacunas e estimativas em si, sem o atraso de CDI do Mercado Pago.
      {
        mode: 'projection',
        now: parseDate('2026-09-02'),
        cdiLagBusinessDays: 0,
      },
    );
    expect(result.missingRateDates).toEqual(['2026-09-01']);
    expect(result.estimatedDates).toEqual(['2026-09-04', '2026-09-08']);
  });
  it('Nubank lança no sábado o rendimento da sexta', () => {
    const subject = bank('Nubank', 1000);
    const history = [
      { date: '2026-08-31', rate: '0.1' },
      { date: '2026-09-04', rate: '0.1' },
    ];
    const result = calculate(subject, history, parseDate('2026-09-05'));
    const saturday = result.earnings.find(
      (entry) => entry.date === '2026-09-05',
    )!;
    expect(saturday.grossAmount?.gt(0)).toBe(true);
    expect(saturday.netAmount.gt(0)).toBe(true);
    const netSum = result.earnings.reduce(
      (sum, item) => sum.plus(item.netAmount),
      new Decimal(0),
    );
    expect(netSum.toFixed(2)).toBe(
      result.netBalance.minus(result.principal).toFixed(2),
    );
  });
  it('não esconde retirada sem saldo na data', () => {
    const subject = bank('Mercado Pago', 100);
    subject.transactions.push(transaction(150, '2026-08-31', 'withdrawal'));
    const result = calculate(subject, [], parseDate('2026-08-31'));
    expect(result.unfundedWithdrawals[0].amount.toFixed(2)).toBe('50.00');
    expect(result.netBalance.toFixed(2)).toBe('0.00');
  });
  it('fecha bruto menos impostos sem centavo perdido por arredondamentos independentes', () => {
    const result = settleBalance({
      principal: new Decimal('1000'),
      grossBalance: new Decimal('1000.014'),
      iof: new Decimal('0.006'),
      incomeTax: new Decimal('0.002'),
    });
    expect(result.grossBalance.toFixed(2)).toBe('1000.01');
    expect(result.iof.toFixed(2)).toBe('0.01');
    expect(result.netBalance.toFixed(2)).toBe('1000.00');
    expect(
      result.netBalance
        .plus(result.iof)
        .plus(result.incomeTax)
        .eq(result.grossBalance),
    ).toBe(true);
  });

  it.each(['Nubank', 'Mercado Pago'] as const)(
    'preserva centavos nos totais e precisão nos juros: %s',
    (name) => {
      const result = calculate(
        bank(name, 1234.56),
        [
          { date: '2026-08-31', rate: '0.051660' },
          { date: '2026-09-01', rate: '0.051660' },
        ],
        parseDate('2026-09-04'),
      );
      for (const value of [
        result.principal,
        result.grossProfit,
        result.grossBalance,
        result.incomeTax,
        result.iof,
        result.netBalance,
      ]) {
        expect(value.decimalPlaces()).toBeLessThanOrEqual(2);
      }
      expect(
        result.netBalance
          .plus(result.incomeTax)
          .plus(result.iof)
          .eq(result.grossBalance),
      ).toBe(true);
      // No sub-cent yield is lost. A product compounding continuously keeps it
      // in the balance; one that credits whole cents holds it back as pending
      // until it completes a cent.
      const lot = result.lots[0];
      expect(
        lot.grossBalance.decimalPlaces() > 2 || lot.pendingCents.gt(0),
      ).toBe(true);
    },
  );
  const rates = [
    { date: '2026-08-31', rate: '0.1000000000' },
    { date: '2026-09-01', rate: '0.1000000000' },
  ];

  it('começa a render somente no dia útil seguinte ao aporte', () => {
    const result = calculate(
      bank('Mercado Pago', 1000),
      rates,
      parseDate('2026-09-01'),
    );
    // Net of the income tax Mercado Pago withholds at posting time.
    expect(result.grossProfit.toFixed(2)).toBe('0.93');
    expect(result.earnings).toHaveLength(1);
    expect(result.earnings[0].date).toBe('2026-09-01');
  });

  it('aplica a taxa turbo somente até o limite e 100% no excedente', () => {
    const result = calculate(
      bank('Nubank', 6000),
      rates,
      parseDate('2026-09-01'),
    );
    expect(result.grossProfit.toFixed(6)).toBe(
      new Decimal(5000)
        .mul('0.00115')
        .plus(new Decimal(1000).mul('0.001'))
        .toFixed(6),
    );
  });

  it('aplica IOF e IR regressivos no Nubank', () => {
    const result = calculate(
      bank('Nubank', 1000),
      rates,
      parseDate('2026-09-01'),
    );
    // Full precision into the provision: the balances profile rounds nothing
    // before the day is settled.
    expect(result.lots[0].iof.toFixed(6)).toBe(
      result.grossProfit.mul('0.96').toFixed(6),
    );
    expect(result.lots[0].incomeTax.toFixed(6)).toBe(
      result.grossProfit
        .minus(result.lots[0].iof)
        .mul('0.225')
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toFixed(6),
    );
  });

  it('reproduz as três conciliações reais do Nubank Turbo sem ajuste de saldo', () => {
    const subject = bank('Nubank', 1400);
    subject.transactions = [transaction(1400, '2026-09-01')];
    subject.snapshots = [
      {
        id: 'snapshot-05',
        user_id: 'user',
        piggy_bank_id: 'bank',
        snapshot_date: '2026-09-05',
        gross_balance: '1403.33',
        net_balance: '1400.37',
        source: 'manual_statement',
        created_at: '2026-09-05T15:00:00Z',
      },
      {
        id: 'snapshot-09',
        user_id: 'user',
        piggy_bank_id: 'bank',
        snapshot_date: '2026-09-09',
        gross_balance: '1404.16',
        net_balance: '1400.88',
        source: 'manual_statement',
        created_at: '2026-09-09T15:00:00Z',
      },
    ];
    subject.earningCredits = [
      {
        id: 'balance-entered-as-yield',
        user_id: 'user',
        piggy_bank_id: 'bank',
        occurred_at: '2026-09-05T14:31:00Z',
        net_amount: '1400.37',
        source: 'vetra:daily:v1:invalid-fixture',
        created_at: '2026-09-05T14:31:00Z',
      },
    ];
    const published = [
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-08',
    ].map((date) => ({ date, rate: '0.051660' }));

    const friday = calculateEngine(
      subject,
      published,
      parseDate('2026-09-04'),
      {
        now: parseDate('2026-09-04'),
      },
    );
    expect(friday.grossBalance.toFixed(2)).toBe('1402.50');
    // The balance is the same under either profile; only the split differs.
    // lib/finance-audit.test.ts pins the 2,25 / 0,05 split of the 04/09 print.
    expect(friday.iof.toFixed(2)).toBe('2.24');
    expect(friday.incomeTax.toFixed(2)).toBe('0.06');
    expect(friday.netBalance.toFixed(2)).toBe('1400.20');

    const result = calculateEngine(
      subject,
      published,
      parseDate('2026-09-09'),
      {
        now: parseDate('2026-09-09'),
      },
    );
    expect(result.grossBalance.toFixed(2)).toBe('1404.16');
    expect(result.iof.toFixed(2)).toBe('3.03');
    expect(result.incomeTax.toFixed(2)).toBe('0.25');
    expect(result.netBalance.toFixed(2)).toBe('1400.88');
    expect(result.ignoredEarningCreditIds).toEqual([
      'balance-entered-as-yield',
    ]);
    // The two official balances are now safe calibration observations. The
    // full balance mistakenly entered as a daily yield remains ignored.
    expect(result.calibration.count).toBe(2);
    expect(result.calibration.status).toBe('collecting');
    expect(
      result.snapshotAudits.map((audit) => [
        audit.snapshot.snapshot_date,
        audit.grossDifference.toFixed(2),
        audit.netDifference.toFixed(2),
      ]),
    ).toEqual([
      ['2026-09-05', '0.00', '0.00'],
      ['2026-09-09', '0.00', '0.00'],
    ]);
  });

  it('usa a conciliação como saldo oficial e recalcula o rendimento líquido do dia', () => {
    const subject = bank('Nubank', 1000);
    subject.transactions = [transaction(1000, '2026-09-01')];
    subject.snapshots = [
      {
        id: 'official-balance',
        user_id: 'user',
        piggy_bank_id: 'bank',
        snapshot_date: '2026-09-02',
        gross_balance: '1001.25',
        net_balance: '1000.15',
        source: 'manual_statement',
        created_at: '2026-09-02T15:00:00Z',
      },
    ];
    const published = [
      { date: '2026-09-01', rate: '0.051660' },
      { date: '2026-09-02', rate: '0.051660' },
    ];
    const atSnapshot = calculateEngine(
      subject,
      published,
      parseDate('2026-09-02'),
      { now: parseDate('2026-09-02') },
    );
    const rawAtSnapshot = calculateEngine(
      { ...subject, snapshots: [] },
      published,
      parseDate('2026-09-02'),
      { now: parseDate('2026-09-02') },
    );
    expect(atSnapshot.grossBalance.toFixed(2)).toBe('1001.25');
    expect(atSnapshot.netBalance.toFixed(2)).toBe('1000.15');
    expect(atSnapshot.principal.toFixed(2)).toBe('1000.00');
    expect(atSnapshot.earnings.at(-1)?.netAmount.toFixed(2)).toBe('0.15');
    expect(atSnapshot.dailyBalances.at(-1)?.netGain.toFixed(2)).toBe('0.15');
    expect(atSnapshot.lifetimeNetGain.toFixed(2)).toBe('0.15');
    expect(
      atSnapshot.lifetimeNetGain.eq(
        atSnapshot.netBalance.minus(atSnapshot.principal),
      ),
    ).toBe(true);
    expect(atSnapshot.lifetimeNetGain.eq(rawAtSnapshot.lifetimeNetGain)).toBe(
      false,
    );
    expect(atSnapshot.reconciled).toBe(true);

    const future = calculateEngine(
      subject,
      published,
      parseDate('2026-09-03'),
      { now: parseDate('2026-09-03') },
    );
    const rawFuture = calculateEngine(
      { ...subject, snapshots: [] },
      published,
      parseDate('2026-09-03'),
      { now: parseDate('2026-09-03') },
    );
    expect(future.grossBalance.toFixed(2)).toBe(
      new Decimal('1001.25')
        .mul(new Decimal('0.0005166').mul('1.15').plus(1))
        .toFixed(2),
    );
    expect(future.netBalance.gt(atSnapshot.netBalance)).toBe(true);
    expect(future.grossBalance.gt(rawFuture.grossBalance)).toBe(true);
    expect(
      future.netBalance
        .minus(atSnapshot.netBalance)
        .eq(future.lifetimeNetGain.minus(atSnapshot.lifetimeNetGain)),
    ).toBe(true);
    const withdrawn = calculateEngine(
      {
        ...subject,
        transactions: [
          ...subject.transactions,
          transaction(future.netBalance.toNumber(), '2026-09-03', 'withdrawal'),
        ],
      },
      published,
      parseDate('2026-09-03'),
      { now: parseDate('2026-09-03') },
    );
    expect(withdrawn.netBalance.toFixed(2)).toBe('0.00');
    expect(withdrawn.grossBalance.toFixed(2)).toBe('0.00');
    expect(withdrawn.lots).toHaveLength(0);
    expect(withdrawn.unfundedWithdrawals).toHaveLength(0);
    for (const cash of [0.01, 25.37, 500.11, 999.99]) {
      const partial = calculateEngine(
        {
          ...subject,
          transactions: [
            ...subject.transactions,
            transaction(cash, '2026-09-03', 'withdrawal'),
          ],
        },
        published,
        parseDate('2026-09-03'),
        { now: parseDate('2026-09-03') },
      );
      expect(partial.netBalance.eq(future.netBalance.minus(cash))).toBe(true);
      expect(partial.lifetimeNetGain.eq(future.lifetimeNetGain)).toBe(true);
    }
    const standalone = calculateEngine(
      { ...subject, transactions: [] },
      published,
      parseDate('2026-09-02'),
      { now: parseDate('2026-09-02') },
    );
    expect(standalone.netBalance.toFixed(2)).toBe('1000.15');
    expect(standalone.principal.isZero()).toBe(true);
    expect(standalone.lifetimeNetGain.isZero()).toBe(true);
    const latest = calculateEngine(
      {
        ...subject,
        snapshots: [
          ...subject.snapshots,
          {
            ...subject.snapshots[0],
            id: 'new-snapshot',
            snapshot_date: '2026-09-03',
            gross_balance: '900.00',
            net_balance: '899.00',
          },
        ],
      },
      published,
      parseDate('2026-09-03'),
      { now: parseDate('2026-09-03') },
    );
    expect(latest.netBalance.toFixed(2)).toBe('899.00');
    expect(latest.grossBalance.toFixed(2)).toBe('900.00');
    const empty = calculateEngine(
      {
        ...subject,
        snapshots: [
          { ...subject.snapshots[0], gross_balance: '0', net_balance: '0' },
        ],
      },
      published,
      parseDate('2026-09-03'),
      { now: parseDate('2026-09-03') },
    );
    expect(empty.netBalance.isZero()).toBe(true);
    expect(empty.grossBalance.isZero()).toBe(true);
  });

  it.each(['Nubank', 'Mercado Pago'] as const)(
    'concilia vários lotes sem criar rendimentos artificiais em %s',
    (name) => {
      const subject = bank(name, 1000);
      subject.transactions = [
        transaction(700.13, '2026-08-31'),
        transaction(299.87, '2026-09-01'),
      ];
      const now = parseDate('2026-09-03');
      for (const [gross, net] of [
        ['1002.37', '1000.77'],
        ['990.23', '989.99'],
        ['1000', '1000'],
      ]) {
        const reconciled = {
          ...subject,
          snapshots: [
            {
              id: 'anchor',
              user_id: subject.user_id,
              piggy_bank_id: subject.id,
              snapshot_date: '2026-09-02',
              gross_balance: gross,
              net_balance: net,
              source: 'manual_statement',
              created_at: '2026-09-02T15:00:00Z',
            },
          ],
        };
        const atSnapshot = calculateEngine(
          reconciled,
          rates,
          parseDate('2026-09-02'),
          { now },
        );
        expect(atSnapshot.grossBalance.toFixed(2)).toBe(
          new Decimal(gross).toFixed(2),
        );
        expect(atSnapshot.netBalance.toFixed(2)).toBe(
          new Decimal(net).toFixed(2),
        );
        expect(atSnapshot.iof.plus(atSnapshot.incomeTax).toFixed(2)).toBe(
          new Decimal(gross).minus(net).toFixed(2),
        );
        const before = calculateEngine(reconciled, rates, now, { now });
        const after = calculateEngine(
          {
            ...reconciled,
            transactions: [
              ...subject.transactions,
              transaction(300.01, '2026-09-03', 'withdrawal'),
            ],
          },
          rates,
          now,
          { now },
        );
        expect(after.netBalance.toFixed(2)).toBe(
          before.netBalance.minus('300.01').toFixed(2),
        );
        expect(after.unfundedWithdrawals).toHaveLength(0);
        expect(after.lifetimeNetGain.toFixed(2)).toBe(
          before.lifetimeNetGain.toFixed(2),
        );
      }
    },
  );

  it('mantém o Mercado Pago sem IOF e sem provisão: o IR já saiu no crédito', () => {
    const subject = bank('Mercado Pago', 1000);
    const result = calculate(subject, rates, parseDate('2026-09-01'));
    expect(result.iof.toNumber()).toBe(0);
    // The statements for this product show gross equal to net. Income tax is
    // withheld as each credit posts, so there is nothing left to provision
    // against a redemption.
    expect(result.incomeTax.toNumber()).toBe(0);
    expect(result.grossBalance.eq(result.netBalance)).toBe(true);
    const provisioned = calculateEngine(
      subject,
      rates,
      parseDate('2026-09-01'),
      {
        mode: 'projection',
        now: parseDate('2026-09-02'),
        postingBasis: 'gross-provisioned',
      },
    );
    expect(provisioned.incomeTax.toFixed(2)).toBe(
      provisioned.grossProfit.mul('0.225').toFixed(2),
    );
  });

  it('respeita exatamente as faixas regressivas do IR', () => {
    expect(irRate(180).toNumber()).toBe(0.225);
    expect(irRate(181).toNumber()).toBe(0.2);
    expect(irRate(360).toNumber()).toBe(0.2);
    expect(irRate(361).toNumber()).toBe(0.175);
    expect(irRate(720).toNumber()).toBe(0.175);
    expect(irRate(721).toNumber()).toBe(0.15);
  });

  it('zera o IOF a partir do trigésimo dia', () => {
    const nubank = bank('Nubank', 1000);
    const longRates = [
      { date: '2026-08-31', rate: '0.1000000000' },
      { date: '2026-09-01', rate: '0.1000000000' },
      { date: '2026-09-30', rate: '0.1000000000' },
    ];
    const result = calculate(nubank, longRates, parseDate('2026-09-30'));
    expect(result.iof.toNumber()).toBe(0);
  });

  it('faz retiradas pelos lotes mais antigos primeiro', () => {
    const nubank = bank('Nubank', 1000);
    nubank.transactions = [
      transaction(1000, '2026-08-31'),
      transaction(1000, '2026-09-01'),
      transaction(500, '2026-09-02', 'withdrawal'),
    ];
    const zeroRates = [
      { date: '2026-08-31', rate: '0' },
      { date: '2026-09-01', rate: '0' },
      { date: '2026-09-02', rate: '0' },
    ];
    const result = calculate(nubank, zeroRates, parseDate('2026-09-02'));
    expect(result.lots[0].remaining.toFixed(2)).toBe('500.00');
    expect(result.lots[1].remaining.toFixed(2)).toBe('1000.00');
    expect(result.principal.toFixed(2)).toBe('1500.00');
  });

  it('inclui aportes do dia desde o início do dia em São Paulo', () => {
    const nubank = bank('Nubank', 1400);
    const earlyMorning = new Date('2026-08-31T04:00:00Z');
    const result = calculate(nubank, rates, earlyMorning);
    expect(result.principal.toFixed(2)).toBe('1400.00');
    expect(result.netBalance.toFixed(2)).toBe('1400.00');
  });
});

describe('conciliação e o imposto que ela ancora', () => {
  // Os dois lotes reais do cofrinho do Nubank em setembro/2026: um grande e
  // velho, outro pequeno e novo. O lote novo carrega um terço do saldo e um
  // oitavo do lucro, que é a assimetria que expôs os dois defeitos abaixo.
  const twoLotNubank = () => {
    const subject = bank('Nubank', 1400);
    subject.transactions = [
      transaction(1400, '2026-09-01'),
      transaction(700, '2026-09-15'),
    ];
    return subject;
  };
  const septemberRates = () =>
    [
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ].map((date) => ({ date, rate: '0.051660' }));

  it('uma conciliação que discorda corrige só o que a tela prova', () => {
    // O banco mostra o imposto truncado no centavo, então a tela é uma faixa:
    // "6,99" é qualquer coisa de 6,99 até 6,9999. O motor tratava a tela como
    // exata e, quando ela discordava do modelo, puxava o imposto até o chão da
    // faixa — uma correção de um centavo inteiro onde a tela só provava uma
    // fração. Em 22/09/2026 o modelo dava 7,000153 contra 6,99 na tela: bastava
    // descer 0,000153, e o motor desceu 0,010153. Esse excesso foi carregado
    // adiante e deixou o líquido de 24/09 um centavo acima do banco.
    //
    // O cenário reproduz a forma do caso: a tela mostra um centavo a menos de
    // imposto do que o modelo exibiria. A correção tem de levar o imposto para
    // DENTRO da faixa da tela, e pelo caminho mais curto.
    const rates = septemberRates();
    const day = parseDate('2026-09-16');
    const options = { mode: 'projection' as const, now: day };
    const model = calculateEngine(twoLotNubank(), rates, day, options);
    const continuousTax = (result: typeof model) =>
      result.lots.reduce(
        (sum, lot) => sum.plus(lot.iof).plus(lot.incomeTax),
        new Decimal(0),
      );
    const modelTax = continuousTax(model);
    const gross = new Decimal(model.grossBalance);
    const screenNet = new Decimal(model.netBalance).plus('0.01');
    const screenTax = gross.minus(screenNet);

    const reconciled = twoLotNubank();
    reconciled.snapshots = [
      {
        id: 'snap',
        user_id: 'user',
        piggy_bank_id: 'bank',
        snapshot_date: '2026-09-16',
        gross_balance: gross.toFixed(2),
        net_balance: screenNet.toFixed(2),
        source: 'manual_statement',
        created_at: '2026-09-16T12:00:00Z',
      },
    ] as PiggyBank['snapshots'];
    const after = calculateEngine(reconciled, rates, day, options);
    const corrected = continuousTax(after);

    // O dia da conciliação continua batendo com a tela ao centavo.
    expect(new Decimal(after.netBalance).toFixed(2)).toBe(screenNet.toFixed(2));
    // O imposto corrigido está dentro da faixa que a tela permite...
    expect(corrected.gte(screenTax)).toBe(true);
    expect(corrected.lt(screenTax.plus('0.01'))).toBe(true);
    // ...e andou MENOS de um centavo. O código antigo andava sempre um centavo
    // ou mais, porque levava o imposto até o chão da faixa.
    expect(
      modelTax.minus(corrected).abs().lt('0.01'),
      `correção de ${modelTax.minus(corrected).toFixed(6)} — foi além do que a tela prova`,
    ).toBe(true);
  });

  it('nunca cobra mais IOF do que o lucro que ele tributa', () => {
    // O IOF é uma fatia do rendimento, então não pode passar dele. Só o
    // resíduo herdado de uma conciliação conseguia empurrá-lo além: o motor
    // chegou a reportar IOF de 2,21 num lote que havia rendido 1,65.
    const subject = twoLotNubank();
    subject.snapshots = [
      {
        id: 'snap',
        user_id: 'user',
        piggy_bank_id: 'bank',
        snapshot_date: '2026-09-20',
        gross_balance: '2112.47',
        net_balance: '2105.22',
        source: 'manual_statement',
        created_at: '2026-09-20T12:00:00Z',
      },
    ] as PiggyBank['snapshots'];
    const result = calculateEngine(
      subject,
      septemberRates(),
      parseDate('2026-09-21'),
      { mode: 'projection', now: parseDate('2026-09-21') },
    );
    for (const lot of result.lots)
      expect(
        lot.iof.lte(Decimal.max(0, lot.grossProfit)),
        `IOF ${lot.iof.toFixed(4)} passou do lucro ${lot.grossProfit.toFixed(4)}`,
      ).toBe(true);
  });

  it('não deixa o líquido cair enquanto o bruto está parado', () => {
    // Fim de semana: o CDI não corre, então o bruto fica. O IOF regressivo
    // conta dias corridos, então o líquido resgatável sobe. Cair é impossível,
    // e era o que acontecia quando o resíduo era rateado por saldo em vez de
    // por imposto — ele parava no lote errado e decaía na taxa errada.
    const subject = twoLotNubank();
    subject.snapshots = [
      {
        id: 'snap',
        user_id: 'user',
        piggy_bank_id: 'bank',
        snapshot_date: '2026-09-18',
        gross_balance: '2111.24',
        net_balance: '2104.52',
        source: 'manual_statement',
        created_at: '2026-09-18T12:00:00Z',
      },
    ] as PiggyBank['snapshots'];
    const day = (date: string) =>
      calculateEngine(subject, septemberRates(), parseDate(date), {
        mode: 'projection',
        now: parseDate('2026-09-18'),
      });
    const saturday = day('2026-09-19');
    const sunday = day('2026-09-20');
    expect(sunday.grossBalance.toFixed(2)).toBe(
      saturday.grossBalance.toFixed(2),
    );
    expect(sunday.netBalance.gte(saturday.netBalance)).toBe(true);
    // E sobe de verdade, que é o rendimento de fim de semana do Nubank.
    expect(sunday.netBalance.gt(saturday.netBalance)).toBe(true);
  });
});

describe('fim de semana com o CDI de sexta ainda não publicado', () => {
  // O Banco Central publica o CDI de sexta só na segunda. O rendimento de
  // sexta cai no sábado. No domingo, esse crédito de sábado não era "hoje",
  // e o motor deixava de estimá-lo: o app mostrava um dia inteiro de
  // rendimento a menos — R$ 1,24 de bruto em 27/09/2026.
  const businessDays = (from: string, to: string) => {
    const days: string[] = [];
    const end = parseDate(to);
    for (
      const d = parseDate(from);
      d <= end;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const weekday = d.getUTCDay();
      if (weekday !== 0 && weekday !== 6)
        days.push(d.toISOString().slice(0, 10));
    }
    return days;
  };
  const withFriday = businessDays('2026-09-01', '2026-09-18').map((date) => ({
    date,
    rate: '0.050788',
  }));
  const withoutFriday = withFriday.filter((rate) => rate.date !== '2026-09-18');

  for (const mode of ['realized', 'projection'] as const)
    it(`estima o crédito de sábado quando se olha no domingo (${mode})`, () => {
      const sunday = parseDate('2026-09-20');
      const run = (rates: typeof withFriday) =>
        calculateEngine(bank('Nubank', 1400), rates, sunday, {
          mode,
          now: sunday,
        });
      const published = run(withFriday);
      const pending = run(withoutFriday);
      expect(new Decimal(pending.grossBalance).toFixed(2)).toBe(
        new Decimal(published.grossBalance).toFixed(2),
      );
      // Registrado pelo dia do crédito (sábado), não pelo dia da taxa.
      expect(pending.estimatedDates).toContain('2026-09-19');
    });
});
