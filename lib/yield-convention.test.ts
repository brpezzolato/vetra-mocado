import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { bankPolicy, type DailyRate, type PiggyBank } from './domain';
import { calculate, isoDate, makeCalendar, parseDate } from './finance';
import {
  conventionKey,
  enumerateConventions,
  productionConvention,
  replayConvention,
  scoreConvention,
  productionConventionFor,
  searchConventions,
  selectConvention,
  type Evidence,
  type YieldConvention,
} from './yield-convention';

/** The Mercado Pago case documented in docs/MOTOR_REGRAS_BANCOS.md, revision
 * 04/09/2026: a R$ 1.835,00 deposit, SGS 12 at 0,051660% on 01-03/09, and the
 * statement's three credits of R$ 0,87, R$ 0,87 and R$ 0,88. */
function mercadoPagoCase() {
  const policy = bankPolicy('Mercado Pago');
  const bank: PiggyBank = {
    id: 'mp',
    user_id: 'user',
    bank: 'Mercado Pago',
    name: 'Meli+',
    product: policy.product,
    cdi_percentage: 120,
    rate_limit: 10000,
    excess_rate: 100,
    tax_rule: 'Regressivo',
    iof_rule: 'Isento desde o primeiro dia',
    accrues_on_deposit_day: false,
    policy_version: policy.version,
    policy_started_at: null,
    policy_ends_at: null,
    archived_at: null,
    created_at: '2026-09-01T10:00:00-03:00',
    updated_at: '2026-09-01T10:00:00-03:00',
    snapshots: [],
    transactions: [
      {
        id: 'deposit',
        user_id: 'user',
        piggy_bank_id: 'mp',
        kind: 'deposit',
        amount: '1835',
        occurred_at: '2026-09-01T10:00:00-03:00',
        note: null,
        created_at: '2026-09-01T10:00:00-03:00',
        updated_at: '2026-09-01T10:00:00-03:00',
      },
    ],
  };
  const rates: DailyRate[] = ['2026-09-01', '2026-09-02', '2026-09-03'].map(
    (date) => ({ date, rate: '0.051660' }),
  );
  const observations = [
    { date: '2026-09-02', netAmount: '0.87' },
    { date: '2026-09-03', netAmount: '0.87' },
    { date: '2026-09-04', netAmount: '0.88' },
  ];
  return { bank, rates, observations };
}

/** The Nubank Turbo case locked by lib/finance.test.ts: a R$ 1.400,00 deposit
 * on 01/09/2026 and the two reconciliations read off the app on 05/09 and
 * 09/09. Unlike Mercado Pago, the evidence here is standing balances, not daily
 * credits. */
function nubankCase() {
  const policy = bankPolicy('Nubank');
  const bank: PiggyBank = {
    id: 'nu',
    user_id: 'user',
    bank: 'Nubank',
    name: 'Caixinha Turbo',
    product: policy.product,
    cdi_percentage: 115,
    rate_limit: 5000,
    excess_rate: 100,
    tax_rule: 'Regressivo',
    iof_rule: 'Regressivo até o 29º dia; zero a partir do 30º',
    accrues_on_deposit_day: false,
    policy_version: 'NUB-TURBO-115',
    policy_started_at: null,
    policy_ends_at: null,
    archived_at: null,
    created_at: '2026-09-01T10:00:00-03:00',
    updated_at: '2026-09-01T10:00:00-03:00',
    snapshots: [],
    transactions: [
      {
        id: 'deposit',
        user_id: 'user',
        piggy_bank_id: 'nu',
        kind: 'deposit',
        amount: '1400',
        occurred_at: '2026-09-01T10:00:00-03:00',
        note: null,
        created_at: '2026-09-01T10:00:00-03:00',
        updated_at: '2026-09-01T10:00:00-03:00',
      },
    ],
  };
  const rates: DailyRate[] = [
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
    '2026-09-08',
  ].map((date) => ({ date, rate: '0.051660' }));
  const evidence: Evidence[] = [
    {
      kind: 'balance',
      date: '2026-09-05',
      grossBalance: '1403.33',
      netBalance: '1400.37',
    },
    {
      kind: 'balance',
      date: '2026-09-09',
      grossBalance: '1404.16',
      netBalance: '1400.88',
    },
  ];
  return { bank, rates, evidence };
}

const variant = (overrides: Partial<YieldConvention>): YieldConvention => ({
  ...productionConvention,
  ...overrides,
});

describe('convention replay reproduces the shipping engine', () => {
  it('matches calculate() day for day, so the baseline row is what actually ships', () => {
    const { bank, rates } = mercadoPagoCase();
    const now = new Date('2026-09-04T18:00:00-03:00');
    const production = calculate(bank, rates, now, { now });
    const replay = replayConvention(
      bank,
      rates,
      productionConventionFor(bank),
      '2026-09-04',
    );

    const engineDaily = new Map(
      production.earnings.map((entry) => [
        entry.date,
        entry.netAmount.toFixed(2),
      ]),
    );
    const harnessDaily = new Map(
      replay
        .filter((day) => !day.postedNet.isZero())
        .map((day) => [day.date, day.postedNet.toFixed(2)]),
    );
    expect(harnessDaily).toEqual(engineDaily);
  });

  it('matches calculate() on Nubank too, tax profile included', () => {
    const { bank, rates } = nubankCase();
    const at = parseDate('2026-09-09');
    const production = calculate(bank, rates, at, { now: at });
    const replay = replayConvention(
      bank,
      rates,
      productionConventionFor(bank),
      '2026-09-09',
    );
    // Nubank Turbo rounds the taxable profit and truncates both taxes. Scoring
    // a baseline that skips that profile understates what ships and sends the
    // search hunting for a rule the engine already applies.
    expect(replay.at(-1)!.predictedNetBalance.toFixed(2)).toBe(
      production.netBalance.toFixed(2),
    );
    expect(production.netBalance.toFixed(2)).toBe('1400.88');
  });

  it('reproduces the estimated series recorded in the docs', () => {
    const { bank, rates } = mercadoPagoCase();
    // The series MOTOR_REGRAS_BANCOS.md records was produced while the engine
    // still provisioned income tax on this product, so it is reproduced under
    // that convention rather than under the current default.
    const posted = replayConvention(
      bank,
      rates,
      productionConvention,
      '2026-09-04',
    )
      .filter((day) => day.evaluable)
      .map((day) => day.postedNet.toFixed(2));
    expect(posted).toEqual(['0.88', '0.89', '0.87']);
  });
});

describe('scoring against the real statement', () => {
  it('scores the pre-cent-posting model at zero exact days', () => {
    const { bank, rates, observations } = mercadoPagoCase();
    const baseline = scoreConvention(
      bank,
      rates,
      observations,
      productionConvention,
    );
    expect(baseline.compared).toBe(3);
    expect(baseline.exact).toBe(0);
    expect(baseline.totalError.toFixed(2)).toBe('0.04');
  });

  it('finds a rule already inside the shipped family that scores better', () => {
    const { bank, rates, observations } = mercadoPagoCase();
    const candidate = scoreConvention(
      bank,
      rates,
      observations,
      variant({ rounding: 'gross-trunc-tax-round' }),
    );
    expect(candidate.exact).toBe(2);
    expect(candidate.totalError.toFixed(2)).toBe('0.01');
    expect(candidate.worstDays.map((day) => day.date)).toEqual(['2026-09-04']);
  });

  it('ranks that rule first and keeps the baseline separately', () => {
    const { bank, rates, observations } = mercadoPagoCase();
    const result = searchConventions(bank, rates, observations);
    expect(result.evaluated).toBe(enumerateConventions().length);
    // Posting whole cents already recovers one of the three documented days;
    // the search still finds a rule that does better.
    expect(result.baseline.exact).toBe(1);
    expect(result.ranked[0].exact).toBe(2);
    expect(result.ranked[0].exact).toBeGreaterThan(result.baseline.exact);
    // Three days of a single lot cannot separate rate scale, precision,
    // accrual base or cap basis: the report must collapse them rather than
    // present permutations of one behaviour as independent evidence.
    expect(result.ranked.length).toBeLessThan(result.evaluated);
  });
});

describe('scoring against balance reconciliations', () => {
  it('measures what the engine predicts, not the reconciled value it echoes back', () => {
    const { bank, rates, evidence } = nubankCase();
    const baseline = scoreConvention(
      bank,
      rates,
      evidence,
      productionConvention,
    );
    // calculate() reports these two balances exactly, but only because it
    // rebases the lots onto them. Scored as a prediction, ahead of the anchor,
    // the engine reproduces the first and misses the second by one cent.
    expect(baseline.byKind).toEqual({ credit: 0, balance: 2 });
    expect(baseline.exact).toBe(1);
    expect(baseline.worstDays).toHaveLength(1);
    expect(baseline.worstDays[0].date).toBe('2026-09-09');
    expect(baseline.worstDays[0].predicted.toFixed(2)).toBe('1400.87');
    expect(baseline.worstDays[0].actual.toFixed(2)).toBe('1400.88');
  });

  it('re-anchors on each reconciliation so intervals are independent tests', () => {
    const { bank, rates, evidence } = nubankCase();
    const days = replayConvention(
      bank,
      rates,
      productionConvention,
      '2026-09-09',
      {
        anchors: evidence.filter((item) => item.kind === 'balance'),
      },
    );
    const anchored = days.filter((day) => day.anchored).map((day) => day.date);
    expect(anchored).toEqual(['2026-09-05', '2026-09-09']);
    // The prediction recorded for an anchor day is taken before the rebase,
    // otherwise every reconciliation would score as a perfect match.
    const first = days.find((day) => day.date === '2026-09-05')!;
    expect(first.predictedNetBalance.toFixed(2)).toBe('1400.37');
  });

  it('cannot identify a rounding rule from balances alone', () => {
    const { bank, rates, evidence } = nubankCase();
    const result = searchConventions(bank, rates, evidence);
    // A standing balance grows by the full-precision accrual regardless of how
    // the bank rounds each posting. Balance evidence separates the accrual
    // base, the posting basis and the tax rule — all three move a balance — but
    // the seven posting-rounding rules collapse into one behaviour, because
    // none of them touches the balance. Identifying that rule needs credits.
    const fixed = result.ranked.filter(
      (score) =>
        score.convention.accrualBase === 'continuous' &&
        score.convention.postingBasis === 'gross-provisioned' &&
        conventionKey(score.convention).endsWith(
          conventionKey({ ...productionConvention, tax: score.convention.tax })
            .split('/')
            .slice(-4)
            .join('/'),
        ),
    );
    const perTax = new Map<string, number>();
    for (const score of fixed) {
      const key = JSON.stringify(score.convention.tax);
      perTax.set(key, (perTax.get(key) ?? 0) + 1);
    }
    for (const count of perTax.values()) expect(count).toBe(1);
    expect(new Set(enumerateConventions().map((c) => c.rounding)).size).toBe(7);
  });
});

describe('the two incompatible Nubank Turbo tax profiles', () => {
  /** The live vault: R$ 1.400,00 on 01/09/2026, R$ 700,00 on 15/09, and the
   * eight balances read off the app between 05/09 and 18/09. */
  function liveNubankVault() {
    const { bank } = nubankCase();
    bank.transactions = [
      {
        ...bank.transactions[0],
        occurred_at: '2026-09-01T12:00:00+00:00',
        created_at: '2026-09-01T11:10:37Z',
        updated_at: '2026-09-01T11:10:37Z',
      },
      {
        ...bank.transactions[0],
        id: 'deposit-2',
        amount: '700',
        occurred_at: '2026-09-15T12:00:00+00:00',
        created_at: '2026-09-15T13:14:41Z',
        updated_at: '2026-09-15T13:14:41Z',
      },
    ];
    const rates: DailyRate[] = [
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
    ]
      .map((date) => ({ date, rate: '0.051660' }))
      .concat([{ date: '2026-09-17', rate: '0.050788' }]);
    const balances: [string, string][] = [
      ['2026-09-05', '1400.37'],
      ['2026-09-09', '1400.88'],
      ['2026-09-11', '1401.54'],
      ['2026-09-13', '1402.07'],
      ['2026-09-15', '2102.74'],
      ['2026-09-16', '2103.26'],
      ['2026-09-17', '2103.90'],
      ['2026-09-18', '2104.52'],
    ];
    return { bank, rates, balances };
  }

  const score = (profile: 'print' | 'balances') => {
    const { bank, rates, balances } = liveNubankVault();
    return balances.filter(([date, expected]) => {
      const at = parseDate(date);
      return (
        calculate(bank, rates, at, {
          now: at,
          turboTaxProfile: profile,
        }).netBalance.toFixed(2) === expected
      );
    }).length;
  };

  it('reproduces every reconciliation under the balances profile', () => {
    expect(score('balances')).toBe(8);
  });

  it('misses two of them under the profile fitted to the 04/09 print', () => {
    // The shipping profile was derived from a single statement print, whose
    // components are each displayed rounded. It reproduces that print's split
    // exactly and the balance history two cents short.
    expect(score('print')).toBe(6);
  });

  it('still reproduces the print the shipping profile was derived from', () => {
    const { bank, rates } = liveNubankVault();
    bank.transactions = [bank.transactions[0]];
    const at = parseDate('2026-09-04');
    const printed = calculate(bank, rates, at, {
      now: at,
      turboTaxProfile: 'print',
    });
    expect(printed.grossProfit.toFixed(2)).toBe('2.50');
    expect(printed.iof.toFixed(2)).toBe('2.25');
    expect(printed.incomeTax.toFixed(2)).toBe('0.05');
    // The balances profile agrees on the balance and splits it differently —
    // which is the whole conflict: no rounding rule reproduces both.
    const alternative = calculate(bank, rates, at, { now: at });
    expect(alternative.netBalance.eq(printed.netBalance)).toBe(true);
    expect(alternative.iof.toFixed(2)).toBe('2.24');
    expect(alternative.incomeTax.toFixed(2)).toBe('0.06');
  });
});

describe('a product that credits already net of tax', () => {
  /** The real Mercado Pago vault: R$ 1.835,00 on 01/09/2026, the credits read
   * off the statement, and the balances the app showed on 10, 14 and 16/09.
   * Every one of those balances has gross equal to net — the product withholds
   * at posting time and provisions nothing. */
  function mercadoPagoVault() {
    const { bank } = mercadoPagoCase();
    bank.transactions = [
      {
        ...bank.transactions[0],
        amount: '1835',
        occurred_at: '2026-09-01T11:18:00+00:00',
        created_at: '2026-09-01T11:18:44Z',
        updated_at: '2026-09-01T11:18:44Z',
      },
    ];
    const credits: [string, string][] = [
      ['2026-09-02T07:42:00+00:00', '0.87'],
      ['2026-09-03T07:45:00+00:00', '0.87'],
      ['2026-09-04T07:00:00+00:00', '0.88'],
      ['2026-09-08T07:24:00+00:00', '0.88'],
      ['2026-09-09T08:23:00+00:00', '0.87'],
      ['2026-09-10T07:41:00+00:00', '0.88'],
    ];
    bank.earningCredits = credits.map(([occurred_at, net_amount], index) => ({
      id: `credit-${index}`,
      user_id: bank.user_id,
      piggy_bank_id: bank.id,
      occurred_at,
      net_amount,
      source: 'extrato',
      created_at: occurred_at,
    }));
    const rates: DailyRate[] = [
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
    ].map((date) => ({ date, rate: '0.051660' }));
    return { bank, rates };
  }

  it('stops reporting a provision the statement says does not exist', () => {
    const { bank, rates } = mercadoPagoVault();
    const at = parseDate('2026-09-16');
    const shipping = calculate(bank, rates, at, { now: at });
    const provisioned = calculate(bank, rates, at, {
      now: at,
      postingBasis: 'gross-provisioned',
    });
    // Provisioning against a redemption invents a gap between gross and net
    // that this product's statements do not have.
    expect(
      provisioned.grossBalance.minus(provisioned.netBalance).toFixed(2),
    ).toBe('1.03');
    expect(shipping.grossBalance.eq(shipping.netBalance)).toBe(true);
  });

  it('tracks the real statement balances to the cent', () => {
    const { bank, rates } = mercadoPagoVault();
    const at = parseDate('2026-09-10');
    const result = calculate(bank, rates, at, { now: at });
    expect(result.netBalance.toFixed(2)).toBe('1840.25');
    expect(result.grossBalance.toFixed(2)).toBe('1840.25');
  });

  it('leaves a provisioned product alone', () => {
    const { bank, rates } = nubankCase();
    const at = parseDate('2026-09-09');
    const shipping = calculate(bank, rates, at, { now: at });
    const netPosted = calculate(bank, rates, at, {
      now: at,
      postingBasis: 'net-posted',
    });
    // Nubank's screen does show a provision, and the statement agrees with the
    // shipping model to the cent. The option describes a product, not a global
    // improvement: turning it on here would break a vault that already matches.
    expect(shipping.grossBalance.gt(shipping.netBalance)).toBe(true);
    expect(shipping.netBalance.toFixed(2)).toBe('1400.88');
    expect(netPosted.netBalance.toFixed(2)).not.toBe('1400.88');
  });
});

describe('what the Mercado Pago reconciliations imply', () => {
  /** The live vault: R$ 1.835,00 on 01/09/2026 and the three balances read off
   * the app on 10, 14 and 16/09. Its credits are left out on purpose — these
   * balances are the evidence that does not depend on which day a manually
   * recorded credit was filed under. */
  function liveVault(cdiPercentage: number) {
    const { bank } = mercadoPagoCase();
    bank.cdi_percentage = cdiPercentage;
    bank.transactions = [
      {
        ...bank.transactions[0],
        occurred_at: '2026-09-01T11:18:00+00:00',
        created_at: '2026-09-01T11:18:44Z',
        updated_at: '2026-09-01T11:18:44Z',
      },
    ];
    const rates: DailyRate[] = [
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
    ].map((date) => ({ date, rate: '0.051660' }));
    const balances: [string, string][] = [
      ['2026-09-10', '1840.25'],
      ['2026-09-14', '1842.00'],
      ['2026-09-16', '1843.76'],
    ];
    return { bank, rates, balances };
  }

  const exact = (cdiPercentage: number, postsWholeCents: boolean) => {
    const { bank, rates, balances } = liveVault(cdiPercentage);
    return balances.filter(([date, expected]) => {
      const at = parseDate(date);
      return (
        calculate(bank, rates, at, {
          now: at,
          postsWholeCents,
        }).netBalance.toFixed(2) === expected
      );
    }).length;
  };

  it('rules out the configured 120%: the drift grows and rounding cannot cause it', () => {
    // Every balance is short, and by more each time — 5, 6 then 8 cents. A
    // rounding rule can move a day by half a cent, so it cannot produce this.
    expect(exact(120, false)).toBe(0);
    expect(exact(120, true)).toBe(0);
  });

  it('reproduces every balance at 119% once whole cents are posted', () => {
    // Three independent windows imply 118.7%, 119.0% and 119.3% of the daily
    // CDI. 119% is the only round figure inside the 118.92-119.07% band that
    // reproduces all three, and it needs the cent posting to land the middle
    // one: carrying the sub-cent remainder is worth exactly that cent.
    expect(exact(119, false)).toBe(2);
    expect(exact(119, true)).toBe(3);
  });
});

describe('selection with a chronological holdout', () => {
  /** A synthetic bank that genuinely follows one convention, used to prove the
   * selector can recover a rule and reach high accuracy on days it never saw.
   * It demonstrates the machinery; it is not evidence about a real product. */
  function syntheticVault(truth: YieldConvention, days: number) {
    const { bank, rates: seed } = mercadoPagoCase();
    const calendar = makeCalendar([]);
    const start = parseDate('2026-03-02');
    const rates: DailyRate[] = Array.from({ length: days + 5 }, (_, index) => ({
      date: isoDate(calendar.move(start, index)),
      rate: seed[0].rate,
    }));
    bank.transactions = [
      {
        ...bank.transactions[0],
        amount: '4200',
        occurred_at: `${rates[0].date}T10:00:00-03:00`,
        created_at: `${rates[0].date}T10:00:00-03:00`,
        updated_at: `${rates[0].date}T10:00:00-03:00`,
      },
    ];
    const until = rates.at(-1)!.date;
    const evidence: Evidence[] = replayConvention(bank, rates, truth, until)
      .filter((day) => day.evaluable && day.postedNet.gt(0))
      .slice(0, days)
      .map((day) => ({
        kind: 'credit' as const,
        date: day.date,
        netAmount: day.postedNet.toFixed(2),
      }));
    return { bank, rates, evidence };
  }

  it('recovers the true rule and clears 90% on days held out of the choice', () => {
    const truth = variant({ rounding: 'gross-trunc-tax-round', carry: true });
    const { bank, rates, evidence } = syntheticVault(truth, 40);
    const report = selectConvention(bank, rates, evidence);

    expect(report.trustworthy).toBe(true);
    expect(report.validationDates.length).toBeGreaterThanOrEqual(5);
    expect(report.validation.exactRate).toBeGreaterThan(0.9);
    expect(report.validation.exact).toBe(report.validation.compared);
    expect(report.baseline.exactRate).toBeLessThan(report.validation.exactRate);
  }, 120_000);

  it('refuses to report a figure when the holdout is too thin to mean anything', () => {
    const { bank, rates, observations } = mercadoPagoCase();
    const report = selectConvention(
      bank,
      rates,
      observations.map((item) => ({ kind: 'credit' as const, ...item })),
    );
    expect(report.trustworthy).toBe(false);
    expect(report.reason).toContain('treino');
  });

  it('keeps the shipping convention when no candidate earns the switch', () => {
    const { bank } = mercadoPagoCase();
    const { rates, evidence } = syntheticVault(
      productionConventionFor(bank),
      40,
    );
    const report = selectConvention(bank, rates, evidence);
    expect(report.selected).toEqual(productionConventionFor(bank));
    expect(report.validation.exact).toBe(report.validation.compared);
  }, 120_000);
});

describe('harness hygiene', () => {
  it('never mutates the vault it replays', () => {
    const { bank, rates } = mercadoPagoCase();
    const before = JSON.stringify(bank);
    for (const convention of enumerateConventions().slice(0, 50))
      replayConvention(bank, rates, convention, '2026-09-04');
    expect(JSON.stringify(bank)).toBe(before);
  });

  it('skips days without published CDI instead of extrapolating', () => {
    const { bank, rates, observations } = mercadoPagoCase();
    const partial = rates.filter((rate) => rate.date !== '2026-09-02');
    const score = scoreConvention(
      bank,
      rates,
      observations,
      productionConvention,
    );
    const reduced = scoreConvention(
      bank,
      partial,
      observations,
      productionConvention,
    );
    expect(score.compared).toBe(3);
    expect(reduced.compared).toBe(2);
  });

  it('separates cap basis once yield pushes the balance past the ceiling', () => {
    const { rates } = mercadoPagoCase();
    const policy = bankPolicy('Mercado Pago');
    const bank: PiggyBank = {
      id: 'cap',
      user_id: 'user',
      bank: 'Mercado Pago',
      name: 'No teto',
      product: policy.product,
      cdi_percentage: 120,
      rate_limit: 1000,
      excess_rate: 10,
      tax_rule: 'Regressivo',
      iof_rule: 'Isento desde o primeiro dia',
      accrues_on_deposit_day: false,
      policy_version: policy.version,
      policy_started_at: null,
      policy_ends_at: null,
      archived_at: null,
      created_at: '2026-09-01T10:00:00-03:00',
      updated_at: '2026-09-01T10:00:00-03:00',
      snapshots: [],
      transactions: [
        {
          id: 'deposit',
          user_id: 'user',
          piggy_bank_id: 'cap',
          kind: 'deposit',
          amount: '1000',
          occurred_at: '2026-09-01T10:00:00-03:00',
          note: null,
          created_at: '2026-09-01T10:00:00-03:00',
          updated_at: '2026-09-01T10:00:00-03:00',
        },
      ],
    };
    const onPrincipal = replayConvention(
      bank,
      rates,
      variant({ capBasis: 'principal', rounding: 'net-round' }),
      '2026-09-04',
    );
    const onBalance = replayConvention(
      bank,
      rates,
      variant({ capBasis: 'balance', rounding: 'net-round' }),
      '2026-09-04',
    );
    // Contributed principal already fills the ceiling, so every cent of yield
    // sits above it: measuring the cap on the balance moves that yield to the
    // excess rate and the two conventions diverge.
    const last = (days: ReturnType<typeof replayConvention>) =>
      days.at(-1)!.balanceAfter;
    expect(last(onBalance).lt(last(onPrincipal))).toBe(true);
  });

  it('gives every convention a distinct key', () => {
    const keys = enumerateConventions().map(conventionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('carries the sub-cent remainder only when asked', () => {
    const { bank, rates } = mercadoPagoCase();
    const plain = replayConvention(
      bank,
      rates,
      variant({ rounding: 'net-truncate', carry: false }),
      '2026-09-04',
    );
    const carried = replayConvention(
      bank,
      rates,
      variant({ rounding: 'net-truncate', carry: true }),
      '2026-09-04',
    );
    const total = (days: ReturnType<typeof replayConvention>) =>
      days.reduce((sum, day) => sum.plus(day.postedNet), new Decimal(0));
    expect(total(carried).gte(total(plain))).toBe(true);
  });
});
