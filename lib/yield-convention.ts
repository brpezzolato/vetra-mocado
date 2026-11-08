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

export const round = (value: Decimal) =>
  value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const truncate = (value: Decimal) =>
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

export function dailyFactor(
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
  | ({ kind?: 'credit' } & Observation)
  | ({ kind: 'balance' } & BalanceAnchor);

const isBalance = (
  item: Evidence,
): item is { kind: 'balance' } & BalanceAnchor => item.kind === 'balance';

/** Splits evidence into credits and balances by date. */
export function splitEvidence(evidence: Evidence[]) {
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
