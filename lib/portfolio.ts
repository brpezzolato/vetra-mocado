import Decimal from 'decimal.js';
import type { DailyRate, PiggyBank } from './domain';
import { calculate, isoDate, makeCalendar, parseDate } from './finance';
import { learnForecast } from './forecast-learning';

/**
 * Só rendimento, nunca negativo: dia negativo é dinheiro que saiu sem
 * retirada registrada (a conciliação absorve). Conta zero.
 */
export function yieldOnly(
  earnings: { date: string; netAmount: Decimal.Value }[],
  start = '',
  end = '9999-12-31',
) {
  return earnings.reduce((sum, entry) => {
    if (entry.date < start || entry.date > end) return sum;
    const amount = new Decimal(entry.netAmount);
    return amount.gt(0) ? sum.plus(amount) : sum;
  }, new Decimal(0));
}

/** O dia do último saldo informado pelo banco, ou `null` sem nenhum. */
export function lastBankDate(bank: PiggyBank): string | null {
  return (
    bank.snapshots
      .map((snapshot) => snapshot.snapshot_date)
      .sort()
      .at(-1) ?? null
  );
}

/**
 * Até quando o cofrinho é realizado: o último saldo do banco. O presente vem
 * só do banco; o motor fica para a previsão. Banco atrasado mostra o último
 * saldo com aviso (`staleBankDate`).
 */
export function realizedAsOf(bank: PiggyBank, asOf = new Date()): Date {
  const last = lastBankDate(bank);
  return last && last < isoDate(asOf) ? parseDate(last) : asOf;
}

/** `calculate` parado no último saldo do banco: o valor "de agora". */
export function calculateRealized(
  bank: PiggyBank,
  rates: DailyRate[],
  asOf = new Date(),
  options: Parameters<typeof calculate>[3] = {},
) {
  return calculate(bank, rates, realizedAsOf(bank, asOf), options);
}

/** Dia do último saldo quando anterior a hoje (desatualizado); `null` em dia. */
export function staleBankDate(
  banks: PiggyBank[],
  now = new Date(),
): string | null {
  const today = isoDate(now);
  const stale = banks
    .map(lastBankDate)
    .filter((date): date is string => date !== null && date < today)
    .sort();
  return stale[0] ?? null;
}

export function calculatePortfolio(
  banks: PiggyBank[],
  rates: DailyRate[],
  asOf = new Date(),
  options: Parameters<typeof calculate>[3] = {},
) {
  // O valor de agora para no último saldo; só a projeção usa o motor além.
  const results = banks.map((bank) => ({
    bank,
    result:
      options.mode === 'projection'
        ? calculate(bank, rates, asOf, options)
        : calculateRealized(bank, rates, asOf, options),
  }));
  const total = (
    key:
      | 'principal'
      | 'grossProfit'
      | 'iof'
      | 'incomeTax'
      | 'grossBalance'
      | 'netBalance',
  ) =>
    results.reduce((sum, { result }) => sum.plus(result[key]), new Decimal(0));
  return {
    results,
    principal: total('principal'),
    grossProfit: total('grossProfit'),
    iof: total('iof'),
    incomeTax: total('incomeTax'),
    grossBalance: total('grossBalance'),
    netBalance: total('netBalance'),
    lifetimeNetGain: results.reduce(
      (sum, { result }) => sum.plus(yieldOnly(result.earnings)),
      new Decimal(0),
    ),
    taxDetailsIncomplete: results.some(
      ({ result }) => result.taxDetailsIncomplete,
    ),
    taxesFromBank:
      results.length > 0 && results.every(({ result }) => result.taxesFromBank),
    grossBalanceKnown: results.every(
      ({ result }) => !result.taxDetailsIncomplete || result.reconciled,
    ),
    confirmedCreditCount: results.reduce(
      (sum, { result }) => sum + result.confirmedCreditCount,
      0,
    ),
    calibrationApplied: results.some(({ result }) => result.calibrationApplied),
    reconciled: results.some(({ result }) => result.reconciled),
  };
}

export function portfolioEarnings(
  portfolio: ReturnType<typeof calculatePortfolio>,
  start = '',
  end = '9999-12-31',
) {
  return portfolio.results.reduce(
    (sum, { result }) => sum.plus(yieldOnly(result.earnings, start, end)),
    new Decimal(0),
  );
}

export function buildPortfolioSeries(
  banks: PiggyBank[],
  rates: DailyRate[],
  now = new Date(),
  options: Parameters<typeof calculate>[3] = {},
) {
  const calendar = makeCalendar(rates);
  const anchor = parseDate(isoDate(now));
  // Depois do último saldo do banco já é previsão.
  const bankDates = banks.map(lastBankDate).filter(Boolean) as string[];
  const lastKnown = bankDates.length ? bankDates.sort()[0] : null;
  const projectedAfter = (date: Date) =>
    lastKnown !== null && isoDate(date) > lastKnown;
  const skeleton = [
    ...Array.from({ length: 6 }, (_, index) => {
      const date = calendar.move(anchor, index - 6);
      return { date, projected: projectedAfter(date) };
    }),
    { date: anchor, projected: projectedAfter(anchor) },
    ...Array.from({ length: 7 }, (_, index) => ({
      date: calendar.move(anchor, index + 1),
      projected: true,
    })),
  ];
  // One replay per vault builds every chart point.
  const projection = calculatePortfolio(banks, rates, skeleton[13].date, {
    ...options,
    now,
    mode: 'projection',
  });
  const ledgers = projection.results.map(
    ({ result }) =>
      new Map(result.dailyBalances.map((balance) => [balance.date, balance])),
  );
  // A previsão é corrigida por um fator aprendido com o erro do motor nos
  // últimos saldos (lib/forecast-learning.ts).
  const learning = projection.results.map(({ bank, result }) =>
    learnForecast(result.snapshotAudits, bank.snapshots, bank.transactions),
  );
  const correction = (from: string, to: string, gross: boolean) =>
    projection.results.reduce((sum, { bank, result }, index) => {
      const factor = learning[index].factor;
      if (factor.eq(1)) return sum;
      const known = lastBankDate(bank) ?? '';
      const projected = result.earnings.reduce((total, entry) => {
        if (entry.date <= known || entry.date < from || entry.date > to)
          return total;
        const amount = new Decimal(
          gross ? (entry.grossAmount ?? entry.netAmount) : entry.netAmount,
        );
        return amount.gt(0) ? total.plus(amount) : total;
      }, new Decimal(0));
      return sum.plus(projected.mul(factor.minus(1)));
    }, new Decimal(0));
  const learnedSamples = learning.reduce((sum, item) => sum + item.samples, 0);
  // Precisão da carteira: média das precisões, pesada pelas amostras.
  const accuracyWeight = learning.reduce(
    (sum, item) => (item.accuracy ? sum + item.samples : sum),
    0,
  );
  const accuracy = accuracyWeight
    ? learning
        .reduce(
          (sum, item) =>
            item.accuracy ? sum.plus(item.accuracy.mul(item.samples)) : sum,
          new Decimal(0),
        )
        .div(accuracyWeight)
    : null;
  const points = skeleton.map((point, index) => {
    const intervalStart =
      point.projected && index > 0
        ? new Date(skeleton[index - 1].date.getTime() + 86400000)
        : point.date;
    return {
      ...point,
      taxDetailsIncomplete: ledgers.some(
        (ledger) => ledger.get(isoDate(point.date))?.taxDetailsIncomplete,
      ),
      value: ledgers
        .reduce(
          (sum, ledger) =>
            sum.plus(ledger.get(isoDate(point.date))?.netBalance ?? 0),
          new Decimal(0),
        )
        .plus(correction('', isoDate(point.date), false)),
      grossValue: ledgers
        .reduce(
          (sum, ledger) =>
            sum.plus(ledger.get(isoDate(point.date))?.grossBalance ?? 0),
          new Decimal(0),
        )
        .plus(correction('', isoDate(point.date), true)),
      // Cash flows never enter yield; future dates include weekend/holiday tax release.
      dailyNetGain: portfolioEarnings(
        projection,
        isoDate(intervalStart),
        isoDate(point.date),
      ).plus(correction(isoDate(intervalStart), isoDate(point.date), false)),
    };
  });
  return {
    points,
    calibrationApplied: projection.calibrationApplied,
    projectedTotal: points[13].value,
    projectedGrossTotal: points[13].grossValue,
    projectedGain: points
      .slice(7)
      .reduce((sum, point) => sum.plus(point.dailyNetGain), new Decimal(0)),
    dailyGain: points[7].dailyNetGain,
    /** Saldos usados para corrigir a previsão e a precisão (0 a 1). */
    learning: { samples: learnedSamples, accuracy },
  };
}
