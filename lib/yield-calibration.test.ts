import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  evaluateCalibration,
  predictYield,
  type YieldSample,
} from './yield-calibration';

const sample = (day: number, actual = '.87'): YieldSample => ({
  date: `2026-07-${String(day).padStart(2, '0')}`,
  actual: new Decimal(actual),
  standard: new Decimal('.88'),
  rawNet: new Decimal('.879'),
  rawGross: new Decimal('1.134'),
  rawTaxes: new Decimal('.255'),
});
describe('chronological yield calibration', () => {
  it('requires 10 training and five unseen validation days', () => {
    expect(
      evaluateCalibration(Array.from({ length: 14 }, (_, i) => sample(i + 1)))
        .status,
    ).toBe('collecting');
    const report = evaluateCalibration(
      Array.from({ length: 15 }, (_, i) => sample(i + 1)),
    );
    expect(report.status).toBe('active');
    expect(report.selected).toBe('net-truncate');
    expect(report.baselineError).toBe(0.01);
    expect(report.candidateError).toBe(0);
    expect(report.trainingCount).toBe(10);
    expect(report.validationCount).toBe(5);
  });
  it('does not pick a different candidate to fit the holdout', () => {
    const samples = Array.from({ length: 15 }, (_, i) =>
      sample(i + 1, i < 10 ? '.87' : '.88'),
    );
    const report = evaluateCalibration(samples);
    expect(report.candidate).toBe('net-truncate');
    expect(report.status).toBe('standard');
    expect(report.selected).toBe('standard');
  });
  it('withdraws calibration when recent days drift', () => {
    const samples = Array.from({ length: 20 }, (_, i) =>
      sample(i + 1, i >= 15 ? '1.00' : '.87'),
    );
    expect(evaluateCalibration(samples).status).toBe('standard');
  });
  it('prefers standard on a tie and rejects insufficient improvement', () => {
    expect(
      evaluateCalibration(
        Array.from({ length: 15 }, (_, i) => sample(i + 1, '.88')),
      ).selected,
    ).toBe('standard');
    const samples = Array.from({ length: 15 }, (_, i) => sample(i + 1));
    samples[10].actual = new Decimal('.88');
    samples[11].actual = new Decimal('.88');
    expect(evaluateCalibration(samples).status).toBe('standard');
  });
  it('rejects repeated dates and invalid numeric inputs', () => {
    expect(() => evaluateCalibration([sample(1), sample(1)])).toThrow(
      'duplicado',
    );
    expect(() =>
      evaluateCalibration([{ ...sample(1), rawNet: new Decimal(NaN) }]),
    ).toThrow('inválida');
  });
  it('calculates decimal rounding without a learned cents offset', () => {
    expect(predictYield('net-round', sample(1)).toFixed(2)).toBe('0.88');
    expect(predictYield('net-truncate', sample(1)).toFixed(2)).toBe('0.87');
    expect(predictYield('tax-truncate', sample(1)).toFixed(2)).toBe('0.88');
    expect(predictYield('gross-truncate', sample(1)).toFixed(2)).toBe('0.87');
  });
});
