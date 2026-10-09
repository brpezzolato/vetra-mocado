import Decimal from 'decimal.js';
import type { DailyRate, PiggyBank } from './domain';
import {
  calendarDays,
  creditsArriveNet,
  earningCreditDate,
  IOF_RATES,
  irRate,
  isoDate,
  makeCalendar,
  parseDate,
} from './finance';

/**
 * Measurement harness: replays a vault under each candidate bank convention to
 * find the one that matches real statements. Read-only; production (./finance.ts)
 * is the baseline (`balance-round` + `continuous`). No free parameters.
 */
export type RoundingRule =
  | 'balance-round'
  | 'net-round'
  | 'net-truncate'
  | 'gross-trunc-tax-round'
  | 'gross-round-tax-trunc'
  | 'gross-trunc-tax-trunc'
  | 'gross-round-tax-round';

export type YieldConvention = {
  /** `linear`: taxa × percentual. `exponential`: (1 + taxa) ^ percentual − 1. */
  rateScale: 'linear' | 'exponential';
  /** Decimals kept on the daily CDI fraction before use; null keeps full precision. */
  ratePrecision: number | null;
  /** Decimals kept on the daily factor (1 + i) before use; null keeps full precision. */
  factorPrecision: number | null;
  /** `continuous`: compound on full precision. `posted`: compound on the cents actually credited. */
  accrualBase: 'continuous' | 'posted';
  /** Where the cent rounding happens when the vault holds more than one lot. */
  aggregation: 'per-lot' | 'aggregate';
  /** Whether the promotional ceiling measures contributed principal or current balance. */
  capBasis: 'principal' | 'balance';
  rounding: RoundingRule;
  /** Whether the sub-cent remainder is carried forward and paid once it completes a cent. */
  carry: boolean;
  /**
   * `gross-provisioned`: gross balance with tax provisioned (Nubank).
   * `net-posted`: each credit already net, no provision (Mercado Pago).
   */
  postingBasis: 'gross-provisioned' | 'net-posted';
  /** How the provision is rounded; each choice can move the balance by a cent. */
  tax: TaxConvention;
};

export type TaxConvention = {
  /** Whether taxable profit is rounded to cents before any tax is applied. */
  fiscalGrossRounding: 'none' | 'half-up';
  /** Whether each lot's IOF is truncated before the income tax base is taken. */
  iofRounding: 'none' | 'truncate';
  /** How each lot's income tax is rounded. */
  irRounding: 'none' | 'half-up' | 'truncate';
  /** How the summed provisions are rounded when the balance is settled. */
  settleRounding: 'half-up' | 'truncate';
};

/** What ./finance.ts does today for every product except Nubank Turbo 115. */
export const genericTax: TaxConvention = {
  fiscalGrossRounding: 'none',
  iofRounding: 'none',
  irRounding: 'none',
  settleRounding: 'half-up',
};

/** The profile ./finance.ts hard-codes for NUB-TURBO-115: the taxable profit is
 * rounded first, then IOF and income tax are truncated. */
export const turboTax: TaxConvention = {
  fiscalGrossRounding: 'half-up',
  iofRounding: 'truncate',
  irRounding: 'truncate',
  settleRounding: 'truncate',
};

/** The convention that reproduces what ships today for this vault, which is the
 * baseline every candidate is scored against. */
export function productionConventionFor(
  bank: Pick<PiggyBank, 'bank' | 'policy_version' | 'iof_rule'>,
): YieldConvention {
  return {
    ...productionConvention,
    // A product that credits whole cents compounds on them and carries the
    // remainder, which is what calculate() now does by default.
    postingBasis: creditsArriveNet(bank) ? 'net-posted' : 'gross-provisioned',
    accrualBase: creditsArriveNet(bank) ? 'posted' : 'continuous',
    carry: creditsArriveNet(bank),
    rounding: creditsArriveNet(bank) ? 'net-truncate' : 'balance-round',
    tax:
      bank.bank === 'Nubank' && bank.policy_version === 'NUB-TURBO-115'
        ? turboTax
        : genericTax,
  };
}

export const productionConvention: YieldConvention = {
  rateScale: 'linear',
  ratePrecision: null,
  factorPrecision: null,
  accrualBase: 'continuous',
  aggregation: 'aggregate',
  capBasis: 'principal',
  rounding: 'balance-round',
  carry: false,
  postingBasis: 'gross-provisioned',
  tax: {
    fiscalGrossRounding: 'none',
    iofRounding: 'none',
    irRounding: 'none',
    settleRounding: 'half-up',
  },
};

const round = (value: Decimal) =>
  value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const truncate = (value: Decimal) =>
  value.toDecimalPlaces(2, Decimal.ROUND_DOWN);

export const conventionKey = (convention: YieldConvention) =>
  [
    convention.rateScale,
    convention.ratePrecision ?? 'full',
    convention.factorPrecision ?? 'full',
    convention.accrualBase,
    convention.aggregation,
    convention.capBasis,
    convention.rounding,
    convention.carry ? 'carry' : 'no-carry',
    convention.postingBasis,
    convention.tax.fiscalGrossRounding,
    convention.tax.iofRounding,
    convention.tax.irRounding,
    convention.tax.settleRounding,
  ].join('/');

/** Mirrors the private helper in ./finance.ts so only the convention varies. */
function rateDatesCreditedOn(
  bank: PiggyBank['bank'],
  creditDate: Date,
  calendar: ReturnType<typeof makeCalendar>,
) {
  const matches: Date[] = [];
  const candidate = new Date(creditDate);
  candidate.setUTCDate(candidate.getUTCDate() - 10);
  while (candidate < creditDate) {
    if (
      calendar.isBusinessDay(candidate) &&
      isoDate(earningCreditDate(bank, candidate, calendar)) ===
        isoDate(creditDate)
    )
      matches.push(new Date(candidate));
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return matches;
}

type ReplayLot = {
  depositDate: string;
  /** Parsed once: re-parsing it per day per candidate dominated the search. */
  depositAt: Date;
  principal: Decimal;
  bonusBase: Decimal;
  excessBase: Decimal;
  /** Yield credited already net of tax; excluded from the taxable base so the
   * same money is not taxed twice. Mirrors confirmedNetProfit in ./finance.ts. */
  postedNetProfit: Decimal;
};

/**
 * CDI competence dates the bank posts on each day. Convention-independent,
 * so computed once per search.
 */
export function buildPostings(
  bank: Pick<PiggyBank, 'bank' | 'accrues_on_deposit_day'>,
  rates: DailyRate[],
  from: string,
  until: string,
) {
  const calendar = makeCalendar(rates);
  const postings = new Map<string, string[]>();
  const cursor = parseDate(from);
  const last = parseDate(until);
  while (cursor <= last) {
    postings.set(
      isoDate(cursor),
      (bank.accrues_on_deposit_day
        ? calendar.isBusinessDay(cursor)
          ? [new Date(cursor)]
          : []
        : rateDatesCreditedOn(bank.bank, cursor, calendar)
      ).map(isoDate),
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return postings;
}

export type ReplayDay = {
  date: string;
  /** Competence dates whose CDI the bank posts on this day. */
  rateDates: string[];
  /** False when CDI is missing, the vault is empty, or nothing posts that day. */
  evaluable: boolean;
  /** True when a deposit or withdrawal lands on this day. */
  hasMovement: boolean;
  grossYield: Decimal;
  taxes: Decimal;
  /** The credit this convention predicts the bank posts, in cents. */
  postedNet: Decimal;
  /** The net balance this convention predicts, before any anchor is applied. */
  predictedNetBalance: Decimal;
  balanceAfter: Decimal;
  /** True when a reconciliation re-anchored the lots at the end of this day. */
  anchored: boolean;
};

/**
 * A balance read off the bank. Anchoring on it makes each interval an
 * independent test.
 */
export type BalanceAnchor = {
  date: string;
  grossBalance: Decimal.Value;
  netBalance: Decimal.Value;
};

function dailyFactor(
  convention: YieldConvention,
  rate: Decimal,
  percentage: Decimal.Value,
) {
  let i = rate.div(100);
  if (convention.ratePrecision !== null)
    i = i.toDecimalPlaces(convention.ratePrecision, Decimal.ROUND_DOWN);
  const pct = new Decimal(percentage).div(100);
  const effective =
    convention.rateScale === 'exponential'
      ? i.plus(1).pow(pct).minus(1)
      : i.mul(pct);
  let factor = effective.plus(1);
  if (convention.factorPrecision !== null)
    factor = factor.toDecimalPlaces(
      convention.factorPrecision,
      Decimal.ROUND_DOWN,
    );
  return factor;
}

function applyTaxRounding(
  value: Decimal,
  mode: 'none' | 'half-up' | 'truncate',
) {
  if (mode === 'half-up') return round(value);
  if (mode === 'truncate') return truncate(value);
  return value;
}

function applyRule(rule: RoundingRule, gross: Decimal, taxes: Decimal) {
  switch (rule) {
    case 'net-round':
      return round(gross.minus(taxes));
    case 'net-truncate':
      return truncate(gross.minus(taxes));
    case 'gross-trunc-tax-round':
      return truncate(gross).minus(round(taxes));
    case 'gross-round-tax-trunc':
      return round(gross).minus(truncate(taxes));
    case 'gross-trunc-tax-trunc':
      return truncate(gross).minus(truncate(taxes));
    case 'gross-round-tax-round':
      return round(gross).minus(round(taxes));
    default:
      return gross.minus(taxes);
  }
}

/**
 * Replays one vault day by day under one convention. Cash flows apply at the
 * start of the day; withdrawals reduce lots pro rata (simulator choice).
 */
export function replayConvention(
  bank: PiggyBank,
  rates: DailyRate[],
  convention: YieldConvention,
  until: string,
  options: {
    anchors?: BalanceAnchor[];
    postings?: Map<string, string[]>;
  } = {},
): ReplayDay[] {
  const anchorsByDate = new Map(
    (options.anchors ?? []).map((anchor) => [anchor.date, anchor]),
  );
  const calendar = makeCalendar(rates);
  const iofExempt = bank.iof_rule.toLowerCase().includes('isento');
  const taxExempt = bank.tax_rule === 'Isento';
  const movements = [...bank.transactions].sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
  if (!movements.length) return [];

  const netPosted = convention.postingBasis === 'net-posted';
  const lots: ReplayLot[] = [];
  const days: ReplayDay[] = [];
  let carried = new Decimal(0);
  let previousNetBalance = new Decimal(0);

  const totalBase = () =>
    lots.reduce(
      (sum, lot) => sum.plus(lot.bonusBase).plus(lot.excessBase),
      new Decimal(0),
    );

  /** Provision on one lot's profit; shared by posting and balance so they agree. */
  const provision = (profit: Decimal, age: number) => {
    const taxable = applyTaxRounding(
      Decimal.max(0, profit),
      convention.tax.fiscalGrossRounding,
    );
    const rawIof =
      iofExempt || age >= 30
        ? new Decimal(0)
        : taxable.mul(IOF_RATES[Math.max(0, age)] ?? 0);
    const iof = applyTaxRounding(rawIof, convention.tax.iofRounding);
    const rawIr = taxExempt
      ? new Decimal(0)
      : Decimal.max(0, taxable.minus(iof)).mul(irRate(age));
    return {
      iof,
      incomeTax: applyTaxRounding(rawIr, convention.tax.irRounding),
    };
  };

  const netBalanceAt = (cursor: Date) => {
    let gross = new Decimal(0);
    let iof = new Decimal(0);
    let incomeTax = new Decimal(0);
    for (const lot of lots) {
      const base = lot.bonusBase.plus(lot.excessBase);
      const taxes = provision(
        base.minus(lot.principal).minus(lot.postedNetProfit),
        calendarDays(lot.depositAt, cursor),
      );
      gross = gross.plus(base);
      iof = iof.plus(taxes.iof);
      incomeTax = incomeTax.plus(taxes.incomeTax);
    }
    const settle = (value: Decimal) =>
      convention.tax.settleRounding === 'truncate'
        ? truncate(value)
        : round(value);
    return round(gross).minus(settle(iof)).minus(settle(incomeTax));
  };

  const cursor = parseDate(movements[0].occurred_at);
  const last = parseDate(until);
  while (cursor <= last) {
    const date = isoDate(cursor);
    const todaysMovements = movements.filter(
      (movement) => isoDate(parseDate(movement.occurred_at)) === date,
    );
    for (const movement of todaysMovements) {
      const amount = new Decimal(movement.amount);
      if (movement.kind === 'withdrawal') {
        const base = totalBase();
        if (base.lte(0)) continue;
        const keep = Decimal.max(0, base.minus(amount)).div(base);
        for (const lot of lots) {
          lot.principal = lot.principal.mul(keep);
          lot.bonusBase = lot.bonusBase.mul(keep);
          lot.excessBase = lot.excessBase.mul(keep);
          lot.postedNetProfit = lot.postedNetProfit.mul(keep);
        }
      } else {
        lots.push({
          depositDate: date,
          depositAt: new Date(cursor),
          principal: amount,
          bonusBase: amount,
          excessBase: new Decimal(0),
          postedNetProfit: new Decimal(0),
        });
      }
    }

    // The promotional ceiling is re-split every day, in deposit order, over
    // either contributed principal or current balance.
    let capLeft =
      bank.rate_limit === null ? null : new Decimal(bank.rate_limit);
    for (const lot of lots) {
      const base = lot.bonusBase.plus(lot.excessBase);
      if (capLeft === null) {
        lot.bonusBase = base;
        lot.excessBase = new Decimal(0);
        continue;
      }
      const measure =
        convention.capBasis === 'principal' ? lot.principal : base;
      const bonusMeasure = Decimal.min(measure, capLeft);
      capLeft = capLeft.minus(bonusMeasure);
      const fraction = measure.isZero()
        ? new Decimal(0)
        : bonusMeasure.div(measure);
      lot.bonusBase = base.mul(Decimal.min(1, fraction));
      lot.excessBase = base.minus(lot.bonusBase);
    }

    const rateKeys =
      options.postings?.get(date) ??
      (bank.accrues_on_deposit_day
        ? calendar.isBusinessDay(cursor)
          ? [new Date(cursor)]
          : []
        : rateDatesCreditedOn(bank.bank, cursor, calendar)
      ).map(isoDate);
    const published = rateKeys.every((key) => calendar.map.has(key));
    const hasBalance = totalBase().gt(0);
    const evaluable = rateKeys.length > 0 && published && hasBalance;

    const perLot: { gross: Decimal; taxes: Decimal; lot: ReplayLot }[] = [];
    if (evaluable) {
      for (const lot of lots) {
        const before = lot.bonusBase.plus(lot.excessBase);
        let bonus = lot.bonusBase;
        let excess = lot.excessBase;
        for (const key of rateKeys) {
          if (lot.depositDate > key) continue;
          const rate = calendar.map.get(key)!;
          bonus = bonus.mul(dailyFactor(convention, rate, bank.cdi_percentage));
          excess = excess.mul(dailyFactor(convention, rate, bank.excess_rate));
        }
        const gross = bonus.plus(excess).minus(before);
        const taxes = provision(gross, calendarDays(lot.depositAt, cursor));
        perLot.push({
          gross,
          taxes: taxes.iof.plus(taxes.incomeTax),
          lot,
        });
      }
    }

    const grossYield = perLot.reduce(
      (sum, item) => sum.plus(item.gross),
      new Decimal(0),
    );
    const taxes = perLot.reduce(
      (sum, item) => sum.plus(item.taxes),
      new Decimal(0),
    );

    let postedNet = new Decimal(0);
    if (evaluable) {
      if (convention.rounding === 'balance-round') {
        // Reproduces production: grow the lots, then take the difference of
        // the two rounded balances as the day's credit.
        for (const item of perLot) {
          const growth = netPosted ? item.gross.minus(item.taxes) : item.gross;
          const base = item.lot.bonusBase.plus(item.lot.excessBase);
          const share = base.isZero()
            ? new Decimal(0)
            : item.lot.bonusBase.div(base);
          item.lot.bonusBase = item.lot.bonusBase.plus(growth.mul(share));
          item.lot.excessBase = item.lot.excessBase.plus(
            growth.mul(new Decimal(1).minus(share)),
          );
          if (netPosted)
            item.lot.postedNetProfit = item.lot.postedNetProfit.plus(growth);
        }
      } else {
        const rule = convention.rounding;
        if (convention.aggregation === 'per-lot') {
          for (const item of perLot) {
            const target = convention.carry
              ? item.gross.minus(item.taxes).plus(carried)
              : item.gross.minus(item.taxes);
            const value = convention.carry
              ? applyRule(rule, target.plus(item.taxes), item.taxes)
              : applyRule(rule, item.gross, item.taxes);
            if (convention.carry) carried = target.minus(value);
            postedNet = postedNet.plus(value);
            const growth =
              convention.accrualBase === 'posted'
                ? value
                : netPosted
                  ? item.gross.minus(item.taxes)
                  : item.gross;
            const base = item.lot.bonusBase.plus(item.lot.excessBase);
            const share = base.isZero()
              ? new Decimal(0)
              : item.lot.bonusBase.div(base);
            item.lot.bonusBase = item.lot.bonusBase.plus(growth.mul(share));
            item.lot.excessBase = item.lot.excessBase.plus(
              growth.mul(new Decimal(1).minus(share)),
            );
            if (netPosted)
              item.lot.postedNetProfit = item.lot.postedNetProfit.plus(growth);
          }
        } else {
          const rawNet = grossYield.minus(taxes);
          const target = convention.carry ? rawNet.plus(carried) : rawNet;
          postedNet = convention.carry
            ? applyRule(rule, target.plus(taxes), taxes)
            : applyRule(rule, grossYield, taxes);
          if (convention.carry) carried = target.minus(postedNet);
          const growth =
            convention.accrualBase === 'posted'
              ? postedNet
              : netPosted
                ? grossYield.minus(taxes)
                : grossYield;
          const base = totalBase();
          for (const lot of lots) {
            const weight = base.isZero()
              ? new Decimal(0)
              : lot.bonusBase.plus(lot.excessBase).div(base);
            const lotGrowth = growth.mul(weight);
            const lotBase = lot.bonusBase.plus(lot.excessBase);
            const share = lotBase.isZero()
              ? new Decimal(0)
              : lot.bonusBase.div(lotBase);
            lot.bonusBase = lot.bonusBase.plus(lotGrowth.mul(share));
            lot.excessBase = lot.excessBase.plus(
              lotGrowth.mul(new Decimal(1).minus(share)),
            );
            if (netPosted)
              lot.postedNetProfit = lot.postedNetProfit.plus(lotGrowth);
          }
        }
      }
    }

    const predictedNetBalance = netBalanceAt(cursor);
    if (evaluable && convention.rounding === 'balance-round')
      postedNet = predictedNetBalance.minus(previousNetBalance);
    previousNetBalance = predictedNetBalance;

    const anchor = anchorsByDate.get(date);
    days.push({
      date,
      rateDates: rateKeys,
      evaluable,
      hasMovement: todaysMovements.length > 0,
      grossYield,
      taxes,
      postedNet,
      predictedNetBalance,
      balanceAfter: totalBase(),
      anchored: Boolean(anchor),
    });
    if (anchor) {
      // Rebase to the balance the bank actually reported, keeping deposit dates
      // so tax ages stay real. The scored prediction above was taken first.
      const target = new Decimal(anchor.grossBalance);
      const base = totalBase();
      if (target.isZero() || base.isZero() || !lots.length) {
        lots.length = 0;
        if (target.gt(0))
          lots.push({
            depositDate: date,
            depositAt: new Date(cursor),
            principal: target,
            bonusBase: target,
            excessBase: new Decimal(0),
            postedNetProfit: new Decimal(0),
          });
      } else {
        // Rebasing must not rewrite contributed principal, or the taxable profit breaks.
        const scale = target.div(base);
        for (const lot of lots) {
          lot.bonusBase = lot.bonusBase.mul(scale);
          lot.excessBase = lot.excessBase.mul(scale);
          lot.postedNetProfit = Decimal.min(
            lot.postedNetProfit,
            Decimal.max(
              0,
              lot.bonusBase.plus(lot.excessBase).minus(lot.principal),
            ),
          );
        }
      }
      carried = new Decimal(0);
      previousNetBalance = netBalanceAt(cursor);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export type ConventionScore = {
  convention: YieldConvention;
  key: string;
  /** Days compared against real evidence. */
  compared: number;
  /** Days the convention reproduced to the cent. */
  exact: number;
  exactRate: number;
  totalError: Decimal;
  maxError: Decimal;
  /** How many of the compared days were credits versus reconciliations. */
  byKind: { credit: number; balance: number };
  worstDays: {
    date: string;
    kind: EvidenceKind;
    predicted: Decimal;
    actual: Decimal;
    error: Decimal;
  }[];
};

export type EvidenceKind = 'credit' | 'balance';
export type Observation = { date: string; netAmount: Decimal.Value };

/**
 * Bank evidence: a daily credit (tests one day) or a reconciled balance
 * (tests the interval since the previous one).
 */
export type Evidence =
  ({ kind?: 'credit' } & Observation) | ({ kind: 'balance' } & BalanceAnchor);

const isBalance = (
  item: Evidence,
): item is { kind: 'balance' } & BalanceAnchor => item.kind === 'balance';

/** Splits evidence into credits and balances by date. */
function splitEvidence(evidence: Evidence[]) {
  const credits = new Map<string, Decimal>();
  const balances = new Map<string, BalanceAnchor>();
  for (const item of evidence)
    if (isBalance(item)) balances.set(item.date, item);
    else credits.set(item.date, new Decimal(item.netAmount));
  return {
    credits,
    balances,
    until: [...credits.keys(), ...balances.keys()].sort().at(-1) ?? '',
  };
}

/** Replays a convention once. Scoring the same replay against several date sets
 * is what keeps the search tractable: the replay is the expensive part. */
export function replayForEvidence(
  bank: PiggyBank,
  rates: DailyRate[],
  evidence: Evidence[],
  convention: YieldConvention,
  postings?: Map<string, string[]>,
  anchor = false,
) {
  const { balances, until } = splitEvidence(evidence);
  return until
    ? replayConvention(bank, rates, convention, until, {
        anchors: anchor ? [...balances.values()] : [],
        postings,
      })
    : [];
}

/** Scores an already-computed replay. */
export function scoreDays(
  days: ReplayDay[],
  evidence: Evidence[],
  convention: YieldConvention,
  options: { includeMovementDays?: boolean; scoreDates?: string[] } = {},
): ConventionScore {
  // Every reconciliation anchors the replay, even ones held out of scoring.
  const scoreDates = options.scoreDates && new Set(options.scoreDates);
  const { credits, balances } = splitEvidence(evidence);
  let compared = 0;
  let exact = 0;
  let totalError = new Decimal(0);
  let maxError = new Decimal(0);
  const byKind = { credit: 0, balance: 0 };
  const misses: ConventionScore['worstDays'] = [];
  const record = (
    date: string,
    kind: EvidenceKind,
    predicted: Decimal,
    actual: Decimal,
  ) => {
    const error = predicted.minus(actual);
    compared += 1;
    byKind[kind] += 1;
    if (error.isZero()) exact += 1;
    else misses.push({ date, kind, predicted, actual, error });
    totalError = totalError.plus(error.abs());
    maxError = Decimal.max(maxError, error.abs());
  };
  for (const day of days) {
    if (day.hasMovement && !options.includeMovementDays) continue;
    if (scoreDates && !scoreDates.has(day.date)) continue;
    const credit = credits.get(day.date);
    if (credit && day.evaluable)
      record(day.date, 'credit', day.postedNet, credit);
    const balance = balances.get(day.date);
    // A reconciliation is comparable whether or not the day itself accrued:
    // it reports the standing balance, not that day's return.
    if (balance)
      record(
        day.date,
        'balance',
        day.predictedNetBalance,
        new Decimal(balance.netBalance),
      );
  }
  return {
    convention,
    key: conventionKey(convention),
    compared,
    exact,
    exactRate: compared ? exact / compared : 0,
    totalError,
    maxError,
    byKind,
    worstDays: misses
      .sort((a, b) => b.error.abs().cmp(a.error.abs()))
      .slice(0, 5),
  };
}

/**
 * Scores one convention against all evidence. Days with cash movement are
 * excluded by default: they say nothing about rounding.
 */
export function scoreConvention(
  bank: PiggyBank,
  rates: DailyRate[],
  evidence: Evidence[],
  convention: YieldConvention,
  options: {
    includeMovementDays?: boolean;
    scoreDates?: string[];
    anchor?: boolean;
  } = {},
): ConventionScore {
  return scoreDays(
    replayForEvidence(
      bank,
      rates,
      evidence,
      convention,
      undefined,
      options.anchor ?? false,
    ),
    evidence,
    convention,
    options,
  );
}

const ratePrecisions = [null, 16, 10, 8] as const;
const factorPrecisions = [null, 16, 8] as const;
const roundingRules: RoundingRule[] = [
  'balance-round',
  'net-round',
  'net-truncate',
  'gross-trunc-tax-round',
  'gross-round-tax-trunc',
  'gross-trunc-tax-trunc',
  'gross-round-tax-round',
];

const taxConventions: TaxConvention[] = [];
for (const fiscalGrossRounding of ['none', 'half-up'] as const)
  for (const iofRounding of ['none', 'truncate'] as const)
    for (const irRounding of ['none', 'half-up', 'truncate'] as const)
      for (const settleRounding of ['half-up', 'truncate'] as const)
        taxConventions.push({
          fiscalGrossRounding,
          iofRounding,
          irRounding,
          settleRounding,
        });

/** The full candidate space. Every member is a deterministic rule with no free
 * parameter, so a winner is an identified convention rather than a fit. */
export function enumerateConventions(): YieldConvention[] {
  const all: YieldConvention[] = [];
  for (const rateScale of ['linear', 'exponential'] as const)
    for (const ratePrecision of ratePrecisions)
      for (const factorPrecision of factorPrecisions)
        for (const accrualBase of ['continuous', 'posted'] as const)
          for (const aggregation of ['per-lot', 'aggregate'] as const)
            for (const capBasis of ['principal', 'balance'] as const)
              for (const rounding of roundingRules)
                for (const carry of [false, true])
                  for (const postingBasis of [
                    'gross-provisioned',
                    'net-posted',
                  ] as const)
                    for (const tax of taxConventions)
                      all.push({
                        rateScale,
                        ratePrecision,
                        factorPrecision,
                        accrualBase,
                        aggregation,
                        capBasis,
                        rounding,
                        carry,
                        postingBasis,
                        tax,
                      });
  return all;
}

/**
 * Drops precision variants that give an identical factor for every rate in
 * the series (and therefore an identical replay).
 */
function distinctPrecisions(bank: PiggyBank, rates: DailyRate[]) {
  const sample = [...new Set(rates.map((rate) => rate.rate))].map(
    (rate) => new Decimal(rate),
  );
  const kept: Pick<
    YieldConvention,
    'rateScale' | 'ratePrecision' | 'factorPrecision'
  >[] = [];
  const seen = new Set<string>();
  for (const rateScale of ['linear', 'exponential'] as const)
    for (const ratePrecision of ratePrecisions)
      for (const factorPrecision of factorPrecisions) {
        const shape = { rateScale, ratePrecision, factorPrecision };
        const signature = sample
          .flatMap((rate) =>
            [bank.cdi_percentage, bank.excess_rate].map((percentage) =>
              dailyFactor(
                { ...productionConvention, ...shape },
                rate,
                percentage,
              ).toString(),
            ),
          )
          .join('|');
        if (seen.has(signature)) continue;
        seen.add(signature);
        kept.push(shape);
      }
  return kept;
}

/** A product that credits already-net yield provisions nothing, so every tax
 * rounding rule collapses to the same replay and only one needs to run. */
function taxesFor(
  bank: PiggyBank,
  postingBasis: YieldConvention['postingBasis'],
) {
  const iofExempt = bank.iof_rule.toLowerCase().includes('isento');
  const provisions =
    postingBasis === 'gross-provisioned' &&
    (bank.tax_rule !== 'Isento' || !iofExempt);
  if (!provisions) return [genericTax];
  // With no IOF to withhold, how IOF would be rounded cannot change a replay.
  return iofExempt
    ? taxConventions.filter((tax) => tax.iofRounding === 'none')
    : taxConventions;
}

/** The candidates worth replaying for this vault: the full space minus the
 * members proven identical to one already in it. */
export function prunedConventions(bank: PiggyBank, rates: DailyRate[]) {
  const all: YieldConvention[] = [];
  for (const shape of distinctPrecisions(bank, rates))
    for (const accrualBase of ['continuous', 'posted'] as const)
      for (const aggregation of ['per-lot', 'aggregate'] as const)
        for (const capBasis of ['principal', 'balance'] as const)
          for (const rounding of roundingRules)
            for (const carry of [false, true])
              for (const postingBasis of [
                'gross-provisioned',
                'net-posted',
              ] as const)
                for (const tax of taxesFor(bank, postingBasis))
                  all.push({
                    ...shape,
                    accrualBase,
                    aggregation,
                    capBasis,
                    rounding,
                    carry,
                    postingBasis,
                    tax,
                  });
  return all;
}

/** The posting calendar a search reuses across every candidate. */
function postingsFor(
  bank: PiggyBank,
  rates: DailyRate[],
  evidence: Evidence[],
) {
  const { until } = splitEvidence(evidence);
  const first = [...bank.transactions]
    .map((movement) => isoDate(parseDate(movement.occurred_at)))
    .sort()[0];
  return first && until ? buildPostings(bank, rates, first, until) : undefined;
}

/** Ranks every candidate, then collapses the ones that produced an identical
 * prediction series so the report shows distinct behaviours, not permutations. */
export function searchConventions(
  bank: PiggyBank,
  rates: DailyRate[],
  evidence: Evidence[],
  options: { includeMovementDays?: boolean; anchor?: boolean } = {},
) {
  const anchor = options.anchor ?? false;
  const postings = postingsFor(bank, rates, evidence);
  const scores = prunedConventions(bank, rates).map((convention) =>
    scoreDays(
      replayForEvidence(bank, rates, evidence, convention, postings, anchor),
      evidence,
      convention,
      options,
    ),
  );
  const seen = new Map<string, ConventionScore>();
  for (const score of scores) {
    const signature = `${score.exact}:${score.compared}:${score.totalError.toFixed(
      4,
    )}:${score.maxError.toFixed(4)}:${score.worstDays
      .map((day) => `${day.date}${day.error.toFixed(2)}`)
      .join(',')}`;
    if (!seen.has(signature)) seen.set(signature, score);
  }
  return {
    baseline: scoreDays(
      replayForEvidence(
        bank,
        rates,
        evidence,
        productionConventionFor(bank),
        postings,
        anchor,
      ),
      evidence,
      productionConventionFor(bank),
      options,
    ),
    // Total error ranks first, not exact-day count: few exact days with large
    // error elsewhere is a coincidence.
    ranked: [...seen.values()].sort(
      (a, b) => a.totalError.cmp(b.totalError) || b.exact - a.exact,
    ),
    // The pruned space is what ran; the full space is what it stands for.
    evaluated: enumerateConventions().length,
    replayed: scores.length,
  };
}

export type SelectionReport = {
  /** The convention chosen on the training days alone. */
  selected: YieldConvention;
  /** How it scored on days it never saw during selection. */
  validation: ConventionScore;
  /** How the shipping engine scored on those same days. */
  baseline: ConventionScore;
  training: ConventionScore;
  trainingDates: string[];
  validationDates: string[];
  /** True when the selection is honest: a real holdout, and enough of it. */
  trustworthy: boolean;
  reason: string;
};

/**
 * Selects on earlier evidence and validates on later, unseen evidence. Only
 * the validation figure is meaningful.
 */
export function selectConvention(
  bank: PiggyBank,
  rates: DailyRate[],
  evidence: Evidence[],
  options: {
    includeMovementDays?: boolean;
    holdout?: number;
    anchor?: boolean;
  } = {},
): SelectionReport {
  const sorted = [...evidence].sort((a, b) => a.date.localeCompare(b.date));
  const dates = sorted.map((item) => item.date);
  const holdout = options.holdout ?? Math.max(5, Math.ceil(dates.length * 0.3));
  const trainingDates = dates.slice(0, Math.max(0, dates.length - holdout));
  const validationDates = dates.slice(trainingDates.length);
  const postings = postingsFor(bank, rates, sorted);
  // One replay per candidate, scored twice: training picks, validation judges.
  const replays = new Map<string, ReplayDay[]>();
  const scored = (convention: YieldConvention, only: string[]) => {
    const key = conventionKey(convention);
    let days = replays.get(key);
    if (!days) {
      days = replayForEvidence(
        bank,
        rates,
        sorted,
        convention,
        postings,
        options.anchor ?? false,
      );
      replays.set(key, days);
    }
    return scoreDays(days, sorted, convention, {
      includeMovementDays: options.includeMovementDays,
      scoreDates: only,
    });
  };
  const candidates = prunedConventions(bank, rates).map((convention) =>
    scored(convention, trainingDates),
  );
  // Ties keep the shipping convention: a candidate must earn the switch.
  const better = (item: ConventionScore, than: ConventionScore) =>
    item.totalError.lt(than.totalError) ||
    (item.totalError.eq(than.totalError) && item.exact > than.exact);
  const best = candidates.reduce((winner, item) =>
    better(item, winner) ? item : winner,
  );
  const shipping = productionConventionFor(bank);
  const productionTraining = scored(shipping, trainingDates);
  const selected = better(best, productionTraining)
    ? best.convention
    : shipping;
  const validation = scored(selected, validationDates);
  const baseline = scored(shipping, validationDates);
  const enoughTraining = trainingDates.length >= 10;
  const enoughValidation = validation.compared >= 5;
  return {
    selected,
    validation,
    baseline,
    training: scored(selected, trainingDates),
    trainingDates,
    validationDates,
    trustworthy: enoughTraining && enoughValidation,
    reason: !enoughTraining
      ? `Apenas ${trainingDates.length} dia(s) de treino; são necessários 10.`
      : !enoughValidation
        ? `Apenas ${validation.compared} dia(s) de validação; são necessários 5.`
        : 'Treino e validação suficientes.',
  };
}
