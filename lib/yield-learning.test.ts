import { describe, expect, it } from 'vitest';
import { bankPolicy, type PiggyBank, type DailyRate } from './domain';
import { calculate, isoDate, makeCalendar, parseDate } from './finance';
import { calibrationSource } from './yield-calibration';

// Synthetic rates and credits: demonstrates learning, NOT a Mercado Pago rule.
// The credits are what a bank truncating each daily net would post, which the
// standard model does not reproduce — otherwise there is nothing to learn.
function fixture() {
  const calendar = makeCalendar([]);
  const start = parseDate('2026-07-01');
  const days = Array.from({ length: 23 }, (_, i) =>
    isoDate(calendar.move(start, i)),
  );
  const rates: DailyRate[] = days.map((date) => ({ date, rate: '.009333333' }));
  const policy = bankPolicy('Mercado Pago');
  const bank: PiggyBank = {
    id: 'mp',
    user_id: 'user',
    bank: 'Mercado Pago',
    name: 'Teste',
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
    created_at: days[0],
    updated_at: days[0],
    snapshots: [],
    transactions: [
      {
        id: 'deposit',
        user_id: 'user',
        piggy_bank_id: 'mp',
        kind: 'deposit',
        amount: '1000',
        occurred_at: `${days[0]}T10:00:00-03:00`,
        note: null,
        created_at: days[0],
        updated_at: days[0],
      },
    ],
  };
  bank.earningCredits = days.slice(1, 16).map((date) => ({
    id: date,
    user_id: 'user',
    piggy_bank_id: bank.id,
    occurred_at: `${date}T04:00:00-03:00`,
    net_amount: '.08',
    source: calibrationSource(bank),
    created_at: `${date}T05:00:00-03:00`,
  }));
  // Calibration learns a rounding correction from observed credits. Once the
  // engine models a product's cent posting directly there is nothing left for
  // it to approximate, so this fixture keeps the continuous model the learning
  // was written against.
  return {
    bank,
    rates,
    days,
    now: new Date(`${days[15]}T12:00:00-03:00`),
    options: { postsWholeCents: false },
  };
}
describe('learning integrated with the ledger', () => {
  it('tests counterfactuals, not the already reconciled daily credit', () => {
    const { bank, rates, now, options } = fixture();
    const result = calculate(bank, rates, now, { now, ...options });
    expect(result.calibration.count).toBe(15);
    expect(result.calibration.status).toBe('active');
    expect(result.calibration.baselineError).toBeGreaterThan(0);
    expect(result.calibration.candidateError).toBe(0);
    expect(result.netBalance.toFixed(2)).toBe('1001.20');
    expect(result.calibrationApplied).toBe(false);
  });
  it('only changes future forecasts; chart, daily ledger and totals agree', () => {
    const { bank, rates, now, days, options } = fixture();
    const at = parseDate(days[22]);
    const learned = calculate(bank, rates, at, {
      now,
      mode: 'projection',
      ...options,
    });
    const standard = calculate(bank, rates, at, {
      now,
      mode: 'projection',
      calibration: false,
      ...options,
    });
    expect(learned.calibrationApplied).toBe(true);
    expect(learned.netBalance.eq(standard.netBalance)).toBe(false);
    expect(
      learned.dailyBalances.filter((day) => day.date <= isoDate(now)),
    ).toEqual(standard.dailyBalances.filter((day) => day.date <= isoDate(now)));
    expect(learned.earnings.filter((entry) => entry.confirmed)).toEqual(
      standard.earnings.filter((entry) => entry.confirmed),
    );
    expect(learned.taxDetailsIncomplete).toBe(true);
    expect(learned.earnings.at(-1)?.grossAmount).toBeNull();
    expect(learned.earnings.at(-1)?.confirmed).not.toBe(true);
    expect(
      learned.netBalance.eq(learned.dailyBalances.at(-1)!.netBalance),
    ).toBe(true);
  });
  it('never consumes future observations, future registrations or future CDI for training', () => {
    const { bank, rates, days, options } = fixture();
    const now = new Date(`${days[10]}T12:00:00-03:00`);
    const result = calculate(bank, rates, parseDate(days[22]), {
      now,
      mode: 'projection',
      ...options,
    });
    expect(result.calibration.count).toBe(10);
    expect(result.calibrationApplied).toBe(false);
    bank.earningCredits![0].created_at = '2099-01-01T00:00:00Z';
    expect(
      calculate(bank, rates, now, { now, ...options }).calibration.count,
    ).toBe(9);
  });
  it('does not pool banks, products or legacy observations without explicit confirmation', () => {
    const { bank, rates, now, options } = fixture();
    bank.product = 'Outro produto';
    expect(
      calculate(bank, rates, now, { now, ...options }).calibration.count,
    ).toBe(0);
    bank.earningCredits!.forEach(
      (credit) => (credit.source = 'Extrato antigo'),
    );
    expect(
      calculate(bank, rates, now, { now, ...options }).calibration.count,
    ).toBe(0);
  });
  it('does not train days with missing CDI or multiple credits', () => {
    const { bank, rates, now, options } = fixture();
    bank.earningCredits!.push({
      ...bank.earningCredits![0],
      id: 'duplicate',
      occurred_at: `${isoDate(new Date(bank.earningCredits![0].occurred_at))}T06:00:00-03:00`,
    });
    expect(
      calculate(bank, rates, now, { now, ...options }).calibration.count,
    ).toBe(14);
    expect(
      calculate(bank, rates.slice(0, 5), now, { now }).calibration.count,
    ).toBeLessThan(15);
  });
  it('keeps prior learning and skips only the movement day', () => {
    const { bank, rates, now, days, options } = fixture();
    bank.transactions.push({
      ...bank.transactions[0],
      id: 'withdrawal',
      kind: 'withdrawal',
      amount: '1',
      occurred_at: `${days[14]}T09:00:00-03:00`,
    });
    expect(
      calculate(bank, rates, now, { now, ...options }).calibration.count,
    ).toBe(14);
  });
  it('keeps Nubank observations separate from taxable lots', () => {
    const { bank, rates, now, options } = fixture();
    bank.bank = 'Nubank';
    bank.policy_version = 'NUB-TURBO-115';
    bank.iof_rule = 'Regressivo';
    bank.earningCredits!.forEach(
      (credit) => (credit.source = calibrationSource(bank)),
    );
    const withObservations = calculate(bank, rates, now, { now, ...options });
    const without = calculate({ ...bank, earningCredits: [] }, rates, now, {
      now,
      ...options,
    });
    // Monday observations do not belong to the Tue-Sat Nubank posting
    // calendar and therefore cannot train its model.
    expect(withObservations.calibration.count).toBe(12);
    expect(withObservations.netBalance.eq(without.netBalance)).toBe(true);
    expect(withObservations.iof.eq(without.iof)).toBe(true);
    expect(withObservations.confirmedCreditCount).toBe(0);
  });
});
