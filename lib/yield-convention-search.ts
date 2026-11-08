// Busca da convenção de rendimento (yield-convention.ts): enumera as
// combinações, poda pelo que o banco mostrou e escolhe a que melhor bate.
import Decimal from 'decimal.js';
import type { DailyRate, PiggyBank } from './domain';
import { isoDate, parseDate } from './finance';
import {
  type RoundingRule,
  type YieldConvention,
  type TaxConvention,
  genericTax,
  productionConvention,
  productionConventionFor,
  conventionKey,
  buildPostings,
  type ReplayDay,
  dailyFactor,
  type ConventionScore,
  type Evidence,
  splitEvidence,
  replayForEvidence,
  scoreDays,
} from './yield-convention';

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
