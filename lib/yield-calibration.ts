import Decimal from 'decimal.js';
import type { PiggyBank } from './domain';

// Versioned observations bind learning to the exact product configuration.
// A net credit alone does not identify gross interest, taxes or bank policy.
export const calibrationSource = (bank: PiggyBank) =>
  `vetra:daily:v1:${JSON.stringify([
    bank.bank,
    bank.product,
    bank.policy_version,
    String(bank.cdi_percentage),
    String(bank.rate_limit),
    String(bank.excess_rate),
    bank.tax_rule,
    bank.iof_rule,
    bank.accrues_on_deposit_day,
    bank.policy_started_at,
    bank.policy_ends_at,
  ])}`;

export type YieldInputs = {
  standard: Decimal;
  rawNet: Decimal;
  rawGross: Decimal;
  rawTaxes: Decimal;
};
export type YieldSample = YieldInputs & { date: string; actual: Decimal };
export const yieldModels = [
  { id: 'standard', label: 'Motor padrão' },
  { id: 'net-round', label: 'Arredondamento do líquido diário' },
  { id: 'net-truncate', label: 'Truncamento do líquido diário' },
  { id: 'tax-truncate', label: 'Bruto arredondado e imposto truncado' },
  { id: 'gross-truncate', label: 'Bruto truncado e imposto arredondado' },
] as const;
export type YieldModel = (typeof yieldModels)[number]['id'];
export function predictYield(model: YieldModel, input: YieldInputs) {
  const round = (value: Decimal) =>
    value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const truncate = (value: Decimal) =>
    value.toDecimalPlaces(2, Decimal.ROUND_DOWN);
  switch (model) {
    case 'net-round':
      return round(input.rawNet);
    case 'net-truncate':
      return truncate(input.rawNet);
    case 'tax-truncate':
      return round(input.rawGross).minus(truncate(input.rawTaxes));
    case 'gross-truncate':
      return truncate(input.rawGross).minus(round(input.rawTaxes));
    default:
      return input.standard;
  }
}
export type CalibrationReport = {
  status: 'collecting' | 'standard' | 'active';
  count: number;
  trainingCount: number;
  validationCount: number;
  selected: YieldModel;
  candidate: YieldModel;
  baselineError: number | null;
  candidateError: number | null;
  exactMatches: number;
};
const score = (model: YieldModel, samples: YieldSample[]) => {
  const errors = samples.map((sample) =>
    predictYield(model, sample).minus(sample.actual).abs(),
  );
  return {
    total: errors.reduce((sum, error) => sum.plus(error), new Decimal(0)),
    max: errors.reduce((max, error) => Decimal.max(max, error), new Decimal(0)),
    exact: errors.filter((error) => error.isZero()).length,
  };
};

/** Chronological holdout: the last five days never choose the candidate.
 * Re-evaluation withdraws a candidate when recent evidence no longer supports it.
 * This compares a small fixed family; it never fits a CDI or a cents offset.
 */
export function evaluateCalibration(input: YieldSample[]): CalibrationReport {
  const dates = new Map<string, YieldSample>();
  for (const sample of input) {
    if (dates.has(sample.date)) throw new Error('Dia de calibração duplicado.');
    if (
      ![
        sample.actual,
        sample.standard,
        sample.rawNet,
        sample.rawGross,
        sample.rawTaxes,
      ].every((value) => value.isFinite())
    )
      throw new Error('Amostra de calibração inválida.');
    dates.set(sample.date, sample);
  }
  const samples = [...dates.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-60);
  const empty: CalibrationReport = {
    status: 'collecting',
    count: samples.length,
    trainingCount: 0,
    validationCount: 0,
    selected: 'standard',
    candidate: 'standard',
    baselineError: null,
    candidateError: null,
    exactMatches: 0,
  };
  if (samples.length < 15) return empty;
  const training = samples.slice(0, -5);
  const validation = samples.slice(-5);
  // Stable ordering favors the standard model when training scores tie.
  const candidate = [...yieldModels].sort((a, b) =>
    score(a.id, training).total.cmp(score(b.id, training).total),
  )[0].id;
  const baseline = score('standard', validation);
  const trial = score(candidate, validation);
  const active =
    candidate !== 'standard' &&
    trial.exact >= 4 &&
    trial.max.lte('.01') &&
    baseline.total.minus(trial.total).gte('.03') &&
    trial.total.lt(baseline.total);
  return {
    ...empty,
    status: active ? 'active' : 'standard',
    trainingCount: training.length,
    validationCount: validation.length,
    candidate,
    selected: active ? candidate : 'standard',
    baselineError: baseline.total.div(5).toNumber(),
    candidateError: trial.total.div(5).toNumber(),
    exactMatches: trial.exact,
  };
}
