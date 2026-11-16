import Decimal from 'decimal.js';
import type { DailyRate, PiggyBank } from './domain';
import { calculate, isoDate, makeCalendar, parseDate } from './finance';
import {
  averageDailyRate,
  averageProjectedBalance,
  flowsBetween,
} from './vault-average';

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
  // Depois do último saldo de cada cofrinho, a previsão é a média do que ele
  // rendeu de fato (lib/vault-average.ts), sem regra do banco. Sem histórico
  // para medir (cofrinho novo), fica o motor.
  const averages = projection.results.map(({ bank }) =>
    averageDailyRate(bank, now),
  );
  const averaged = (index: number, date: string) =>
    averageProjectedBalance(
      projection.results[index].bank,
      averages[index],
      date,
    );
  const netOf = (index: number, date: string) =>
    averaged(index, date) ??
    new Decimal(ledgers[index].get(date)?.netBalance ?? 0);
  /** O imposto do último saldo do banco segue igual na previsão pela média. */
  const grossOf = (index: number, date: string) => {
    const projected = averaged(index, date);
    if (!projected)
      return new Decimal(ledgers[index].get(date)?.grossBalance ?? 0);
    const last = [...projection.results[index].bank.snapshots]
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      .at(-1)!;
    return projected.plus(
      new Decimal(last.gross_balance).minus(last.net_balance),
    );
  };
  const points = skeleton.map((point, index) => {
    const date = isoDate(point.date);
    const intervalStart =
      point.projected && index > 0
        ? new Date(skeleton[index - 1].date.getTime() + 86400000)
        : point.date;
    const previous = index > 0 ? isoDate(skeleton[index - 1].date) : null;
    // Cash flows never enter yield; future dates include weekend/holiday days.
    const dailyNetGain = projection.results.reduce(
      (sum, { bank, result }, bankIndex) => {
        if (previous && averaged(bankIndex, date)) {
          const gain = netOf(bankIndex, date)
            .minus(netOf(bankIndex, previous))
            .minus(flowsBetween(bank, previous, date));
          return gain.gt(0) ? sum.plus(gain) : sum;
        }
        return sum.plus(
          yieldOnly(result.earnings, isoDate(intervalStart), date),
        );
      },
      new Decimal(0),
    );
    return {
      ...point,
      taxDetailsIncomplete: ledgers.some(
        (ledger) => ledger.get(date)?.taxDetailsIncomplete,
      ),
      value: projection.results.reduce(
        (sum, _, bankIndex) => sum.plus(netOf(bankIndex, date)),
        new Decimal(0),
      ),
      grossValue: projection.results.reduce(
        (sum, _, bankIndex) => sum.plus(grossOf(bankIndex, date)),
        new Decimal(0),
      ),
      dailyNetGain,
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
  };
}
