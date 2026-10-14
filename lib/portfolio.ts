import Decimal from 'decimal.js';
import type { DailyRate, PiggyBank } from './domain';
import { calculate, isoDate, makeCalendar, parseDate } from './finance';

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
 * Até quando o cofrinho é realizado: o último saldo do banco. Tudo vem do
 * banco; não há previsão. Banco atrasado mostra o último saldo com aviso
 * (`staleBankDate`).
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

/**
 * O gráfico de rendimento: os últimos 14 dias úteis até o último saldo que o
 * banco informou (o mais antigo entre os cofrinhos). Só o realizado: dia que
 * o banco ainda não informou não aparece, nada é previsto.
 */
export function buildBankSeries(
  banks: PiggyBank[],
  rates: DailyRate[],
  now = new Date(),
) {
  const calendar = makeCalendar(rates);
  const today = isoDate(now);
  const known = (banks.map(lastBankDate).filter(Boolean) as string[]).sort();
  const last = known[0] && known[0] < today ? known[0] : today;
  const anchor = parseDate(last);
  const days = Array.from({ length: 14 }, (_, index) =>
    calendar.move(anchor, index - 13),
  );
  const portfolio = calculatePortfolio(banks, rates, now);
  const ledgers = portfolio.results.map(
    ({ result }) =>
      new Map(result.dailyBalances.map((balance) => [balance.date, balance])),
  );
  const points = days.map((date, index) => {
    // O ganho do dia útil inclui o fim de semana e o feriado antes dele.
    const from =
      index > 0 ? new Date(days[index - 1].getTime() + 86_400_000) : date;
    return {
      date,
      today: isoDate(date) === today,
      value: ledgers.reduce(
        (sum, ledger) => sum.plus(ledger.get(isoDate(date))?.netBalance ?? 0),
        new Decimal(0),
      ),
      dailyNetGain: portfolioEarnings(portfolio, isoDate(from), isoDate(date)),
    };
  });
  return { points, lastDate: last };
}
