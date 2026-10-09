import Decimal from 'decimal.js';
import type {
  BankEarningCredit,
  DailyRate,
  PiggyBank,
  SnapshotRow,
  TransactionRow,
} from './domain';
import {
  isFinancialBusinessDay,
  isNationalFinancialHoliday,
} from './business-calendar';
import {
  calibrationSource,
  evaluateCalibration,
  predictYield,
  type YieldSample,
  type CalibrationReport,
} from './yield-calibration';

/**
 * Dois perfis de imposto do Nubank Turbo 115, incompatíveis entre si.
 * `balances` (padrão) reproduz os saldos de 05–18/09/2026; `print` reproduz a
 * divisão do print de 04/09/2026. Nenhuma regra de arredondamento acerta os dois.
 */
export type TurboTaxProfile = 'print' | 'balances';

const isTurbo = (profile?: Pick<PiggyBank, 'bank' | 'policy_version'>) =>
  profile?.bank === 'Nubank' && profile.policy_version === 'NUB-TURBO-115';

// Arredonda só na saída, nunca na capitalização diária. O truncamento do
// Turbo 115 vale só para esta versão de política.
export function settleBalance(
  values: {
    principal: Decimal;
    grossBalance: Decimal;
    iof: Decimal;
    incomeTax: Decimal;
  },
  profile?: Pick<PiggyBank, 'bank' | 'policy_version'>,
  turboTaxProfile: TurboTaxProfile = 'balances',
) {
  const turbo = isTurbo(profile);
  const cents = (value: Decimal) =>
    value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const principal = cents(values.principal);
  const grossBalance = cents(values.grossBalance);
  // Em `balances`, IOF e IR são truncados ao fechar o dia.
  const iof =
    turbo && turboTaxProfile === 'balances'
      ? values.iof.toDecimalPlaces(2, Decimal.ROUND_DOWN)
      : cents(values.iof);
  const incomeTax = values.incomeTax.toDecimalPlaces(
    2,
    turbo ? Decimal.ROUND_DOWN : Decimal.ROUND_HALF_UP,
  );
  return {
    principal,
    grossBalance,
    grossProfit: grossBalance.minus(principal),
    iof,
    incomeTax,
    netBalance: grossBalance.minus(iof).minus(incomeTax),
  };
}

export const IOF_RATES = [
  '1',
  '.96',
  '.93',
  '.90',
  '.86',
  '.83',
  '.80',
  '.76',
  '.73',
  '.70',
  '.66',
  '.63',
  '.60',
  '.56',
  '.53',
  '.50',
  '.46',
  '.43',
  '.40',
  '.36',
  '.33',
  '.30',
  '.26',
  '.23',
  '.20',
  '.16',
  '.13',
  '.10',
  '.06',
  '.03',
];
const saoPauloDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const isoDate = (date: Date) => {
  const parts = saoPauloDateFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
export const parseDate = (date: string) => {
  const day = date.slice(0, 10);
  const parsedDay = new Date(`${day}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(parsedDay.getTime()) ||
    parsedDay.toISOString().slice(0, 10) !== day
  )
    throw new Error('Data financeira inválida.');
  if (date.length === 10) return parsedDay;
  const instant = new Date(date);
  if (!Number.isFinite(instant.getTime()))
    throw new Error('Horário financeiro inválido.');
  return new Date(`${isoDate(instant)}T12:00:00Z`);
};
export const calendarDays = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));

export function irRate(days: number) {
  if (days <= 180) return new Decimal('.225');
  if (days <= 360) return new Decimal('.20');
  if (days <= 720) return new Decimal('.175');
  return new Decimal('.15');
}

export function makeCalendar(rates: DailyRate[]) {
  const sorted = [...rates].sort((a, b) => a.date.localeCompare(b.date));
  const map = new Map(
    sorted.map((item) => {
      parseDate(item.date);
      const rate = new Decimal(item.rate);
      if (!rate.isFinite() || rate.isNegative())
        throw new Error('CDI inválido. Atualize os dados.');
      return [item.date, rate] as const;
    }),
  );
  if (
    sorted.some(
      (item, index) =>
        index > 0 &&
        item.date === sorted[index - 1].date &&
        !new Decimal(item.rate).eq(sorted[index - 1].rate),
    )
  )
    throw new Error('Taxas CDI conflitantes para a mesma data.');
  const lastDate = sorted.at(-1)?.date ?? '';
  const firstDate = sorted[0]?.date ?? '';
  const isBusinessDay = (date: Date) =>
    map.has(isoDate(date)) || isFinancialBusinessDay(date);
  const move = (date: Date, amount: number) => {
    if (
      !Number.isFinite(date.getTime()) ||
      !Number.isSafeInteger(amount) ||
      Math.abs(amount) > 36600
    )
      throw new Error('Intervalo de dias úteis inválido.');
    const result = new Date(date);
    let left = Math.abs(amount);
    const direction = amount < 0 ? -1 : 1;
    while (left) {
      result.setUTCDate(result.getUTCDate() + direction);
      if (isBusinessDay(result)) left -= 1;
    }
    return result;
  };
  return {
    map,
    isBusinessDay,
    move,
    lastRate: sorted.length ? new Decimal(sorted.at(-1)!.rate) : new Decimal(0),
    lastDate,
    firstDate,
  };
}

// O CDI corre em dias úteis, mas cada produto credita no seu calendário:
// MP no dia útil seguinte; Nubank credita seg–sex em ter–sáb.
export function earningCreditDate(
  bank: PiggyBank['bank'],
  rateDate: Date,
  calendar: ReturnType<typeof makeCalendar>,
) {
  if (!calendar.isBusinessDay(rateDate))
    throw new Error('Competência CDI fora de dia útil.');
  if (bank === 'Mercado Pago') return calendar.move(rateDate, 1);
  const result = new Date(rateDate);
  do result.setUTCDate(result.getUTCDate() + 1);
  while (
    result.getUTCDay() === 0 ||
    result.getUTCDay() === 1 ||
    isNationalFinancialHoliday(result)
  );
  return result;
}

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

type Lot = {
  transaction: TransactionRow;
  original: Decimal;
  remaining: Decimal;
  grossProfit: Decimal;
  iof: Decimal;
  incomeTax: Decimal;
  grossBalance: Decimal;
  netBalance: Decimal;
  age: number;
  businessDays: number;
  settled: ReturnType<typeof settleBalance>;
  taxDetailsIncomplete?: boolean;
  /** Rendimento abaixo de um centavo ainda não creditado (produto paga centavos inteiros). */
  pendingCents: Decimal;
};
export type EarningEntry = {
  date: string;
  grossAmount: Decimal | null;
  netAmount: Decimal;
  taxes: Decimal | null;
  iof?: Decimal;
  incomeTax?: Decimal;
  confirmed?: boolean;
  creditId?: string;
  occurredAt?: string;
  calibrated?: boolean;
  reconciled?: boolean;
};
export type Redemption = {
  transactionId: string;
  date: string;
  netAmount: Decimal;
  grossAmount: Decimal;
  principalAmount: Decimal;
  iof: Decimal;
  incomeTax: Decimal;
  roundingDifference: Decimal;
  taxDetailsIncomplete?: boolean;
};
export type DailyBalance = ReturnType<typeof settleBalance> & {
  date: string;
  netGain: Decimal;
  taxDetailsIncomplete?: boolean;
};
export function iofExemptionAt(occurredAt: string) {
  const date = parseDate(occurredAt);
  date.setUTCDate(date.getUTCDate() + 30);
  return new Date(`${isoDate(date)}T00:00:00-03:00`);
}
/**
 * Atraso, em dias úteis, com que o produto aplica o CDI. O MP usa o CDI de
 * dois dias úteis antes (confirmado no corte do Copom de 16/09/2026).
 */
export const CDI_LAG_BUSINESS_DAYS = 2;

export const defaultCdiLag = (bank: Pick<PiggyBank, 'bank'>) =>
  bank.bank === 'Mercado Pago' ? CDI_LAG_BUSINESS_DAYS : 0;

/** O cofrinho isento de IOF do MP credita já líquido de IR. */
export const creditsArriveNet = (bank: Pick<PiggyBank, 'bank' | 'iof_rule'>) =>
  bank.bank === 'Mercado Pago' &&
  bank.iof_rule.toLowerCase().includes('isento');

type WorkingLot = {
  transaction: TransactionRow;
  original: Decimal;
  bonusBasis: Decimal;
  excessBasis: Decimal;
  bonusGross: Decimal;
  excessGross: Decimal;
  businessDays: number;
  // Rendimento já líquido: fora da base tributável.
  confirmedNetProfit: Decimal;
  // Parte lida do extrato (não modelada): bruto e imposto desconhecidos.
  observedNetProfit: Decimal;
  // Fração de centavo retida até completar um centavo.
  postedCarry: Decimal;
  reconciliationTax?: { iof: Decimal; ir: Decimal; iofRate: Decimal };
  calibrated?: boolean;
};

export function dailyYieldSafetyLimit(bank: PiggyBank) {
  const contributed = bank.transactions
    .filter((item) => item.kind !== 'withdrawal')
    .reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
  const reconciledBalance = bank.snapshots.reduce(
    (highest, snapshot) => Decimal.max(highest, snapshot.gross_balance),
    new Decimal(0),
  );
  // 1% é bem acima de um dia de CDI: só pega erro grosseiro (saldo lançado
  // como rendimento).
  return Decimal.max(contributed, reconciledBalance)
    .mul('.01')
    .plus('.05')
    .toDecimalPlaces(2, Decimal.ROUND_UP);
}

export function isPlausibleDailyYield(bank: PiggyBank, amount: Decimal.Value) {
  const value = new Decimal(amount);
  return (
    value.isFinite() &&
    value.gt(0) &&
    value.decimalPlaces() <= 2 &&
    value.lte(dailyYieldSafetyLimit(bank))
  );
}

function lotValues(
  lot: WorkingLot,
  bank: PiggyBank,
  date: Date,
  turboTaxProfile: TurboTaxProfile = 'balances',
) {
  const remaining = lot.bonusBasis.plus(lot.excessBasis);
  const grossBalance = lot.bonusGross.plus(lot.excessGross);
  const grossProfit = Decimal.max(0, grossBalance.minus(remaining));
  const taxableProfit = Decimal.max(
    0,
    grossProfit.minus(lot.confirmedNetProfit),
  );
  const age = calendarDays(parseDate(lot.transaction.occurred_at), date);
  const nubankTurbo = isTurbo(bank) && turboTaxProfile === 'print';
  const turboBalances = isTurbo(bank) && turboTaxProfile === 'balances';
  const fiscalGrossProfit = nubankTurbo
    ? taxableProfit.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : taxableProfit;
  const rawIof =
    bank.iof_rule.toLowerCase().includes('isento') || age >= 30
      ? new Decimal(0)
      : fiscalGrossProfit.mul(IOF_RATES[Math.max(0, age)] ?? 0);
  let iof = nubankTurbo
    ? rawIof.toDecimalPlaces(2, Decimal.ROUND_DOWN)
    : rawIof;
  const rawIncomeTax =
    bank.tax_rule === 'Isento'
      ? new Decimal(0)
      : Decimal.max(0, fiscalGrossProfit.minus(iof)).mul(irRate(age));
  let incomeTax = nubankTurbo
    ? rawIncomeTax.toDecimalPlaces(2, Decimal.ROUND_DOWN)
    : turboBalances
      ? rawIncomeTax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : rawIncomeTax;
  if (lot.reconciliationTax) {
    const anchor = lot.reconciliationTax;
    const currentIofRate = new Decimal(IOF_RATES[age] ?? 0);
    iof = Decimal.max(
      0,
      iof.plus(
        anchor.iofRate.gt(0)
          ? anchor.iof.mul(currentIofRate).div(anchor.iofRate)
          : 0,
      ),
    );
    incomeTax = Decimal.max(0, incomeTax.plus(anchor.ir));
    // IOF não passa do rendimento; o resíduo da conciliação poderia inventar imposto.
    iof = Decimal.min(iof, Decimal.max(0, fiscalGrossProfit));
    iof = Decimal.min(iof, grossBalance);
    incomeTax = Decimal.min(incomeTax, grossBalance.minus(iof));
  }
  return {
    remaining,
    grossProfit,
    iof,
    incomeTax,
    grossBalance,
    netBalance: grossBalance.minus(iof).minus(incomeTax),
    age,
  };
}

export function calculate(
  bank: PiggyBank,
  rates: DailyRate[],
  asOf = new Date(),
  options: {
    mode?: 'realized' | 'projection';
    now?: Date;
    calibration?: boolean;
    /**
     * Teto promocional mede o principal (padrão) ou o saldo (`balance`, em
     * avaliação em ./yield-convention.ts).
     */
    capBasis?: 'principal' | 'balance';
    /** Rendimento modelado provisiona imposto ou chega líquido. Padrão por produto. */
    postingBasis?: 'gross-provisioned' | 'net-posted';
    /** Credita centavos inteiros e capitaliza sobre o creditado. Padrão: igual a `net-posted`. */
    postsWholeCents?: boolean;
    /** Perfil de imposto do Turbo. Ver TurboTaxProfile. */
    turboTaxProfile?: TurboTaxProfile;
    /** Atraso do CDI. Padrão por produto; 0 isola a estimativa do calendário. */
    cdiLagBusinessDays?: number;
  } = {},
) {
  const turboTaxProfile = options.turboTaxProfile ?? 'balances';
  const netPosted =
    (options.postingBasis ??
      (creditsArriveNet(bank) ? 'net-posted' : 'gross-provisioned')) ===
    'net-posted';
  // Capitaliza sobre o creditado; a fração é carregada até virar centavo.
  const postsWholeCents = options.postsWholeCents ?? netPosted;
  const projection = options.mode === 'projection';
  const today = isoDate(options.now ?? new Date());
  const valuationDate = parseDate(isoDate(asOf));
  const calendar = makeCalendar(rates);
  const snapshots = bank.snapshots
    .filter(
      (snapshot) =>
        snapshot.snapshot_date <= isoDate(valuationDate) &&
        snapshot.snapshot_date <= today,
    )
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  for (const snapshot of snapshots) {
    parseDate(snapshot.snapshot_date);
    const gross = new Decimal(snapshot.gross_balance);
    const net = new Decimal(snapshot.net_balance);
    if (
      snapshot.user_id !== bank.user_id ||
      snapshot.piggy_bank_id !== bank.id ||
      !gross.isFinite() ||
      !net.isFinite() ||
      gross.lt(0) ||
      net.lt(0) ||
      net.gt(gross) ||
      gross.decimalPlaces() > 2 ||
      net.decimalPlaces() > 2
    )
      throw new Error('Conciliação de saldo inválida.');
  }
  const snapshotsByDate = new Map(
    snapshots.map((snapshot) => [snapshot.snapshot_date, snapshot]),
  );
  const snapshotAudits: {
    snapshot: SnapshotRow;
    calculatedGross: Decimal;
    calculatedNet: Decimal;
    grossDifference: Decimal;
    netDifference: Decimal;
  }[] = [];
  let grossReconciliation = new Decimal(0);
  let netReconciliation = new Decimal(0);
  let reconciled = false;
  for (const event of bank.transactions) {
    const amount = new Decimal(event.amount);
    parseDate(event.occurred_at);
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2)
      throw new Error('Movimentação com valor monetário inválido.');
  }
  const events = bank.transactions
    .filter((item) => parseDate(item.occurred_at) <= valuationDate)
    .sort(
      (a, b) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
  // Só o cofrinho isento do MP é conciliado assim; RDB não mexe nos lotes do Nubank.
  const creditIds = new Map<string, string>();
  const creditsByInstant = new Map<number, BankEarningCredit>();
  const ignoredEarningCreditIds: string[] = [];
  if (
    bank.bank === 'Mercado Pago' &&
    bank.iof_rule.toLowerCase().includes('isento')
  ) {
    for (const credit of bank.earningCredits ?? []) {
      if (credit.piggy_bank_id !== bank.id || credit.user_id !== bank.user_id)
        throw new Error('Crédito de rendimento pertence a outro cofrinho.');
      parseDate(credit.occurred_at);
      const value = new Decimal(credit.net_amount);
      if (!value.isFinite() || value.lte(0) || value.decimalPlaces() > 2)
        throw new Error('Crédito de rendimento inválido.');
      const instant = new Date(credit.occurred_at).getTime();
      const fingerprint = `${instant}:${value.toFixed(2)}`;
      if (creditIds.has(credit.id) && creditIds.get(credit.id) !== fingerprint)
        throw new Error(
          'Identificador de crédito duplicado com dados diferentes.',
        );
      const duplicate = creditsByInstant.get(instant);
      if (duplicate && !new Decimal(duplicate.net_amount).eq(value))
        throw new Error('Créditos conflitantes para o mesmo horário.');
      if (duplicate || creditIds.has(credit.id)) continue;
      creditIds.set(credit.id, fingerprint);
      if (!isPlausibleDailyYield(bank, value)) {
        ignoredEarningCreditIds.push(credit.id);
        continue;
      }
      // Previsão nunca consome crédito que ainda não aconteceu.
      if (
        instant <=
        Math.min(asOf.getTime(), (options.now ?? new Date()).getTime())
      )
        creditsByInstant.set(instant, credit);
    }
  }
  const credits = [...creditsByInstant.values()].sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  if (!events.length && !credits.length && !snapshots.length)
    return {
      principal: new Decimal(0),
      grossProfit: new Decimal(0),
      iof: new Decimal(0),
      incomeTax: new Decimal(0),
      grossBalance: new Decimal(0),
      netBalance: new Decimal(0),
      lots: [] as Lot[],
      earnings: [] as EarningEntry[],
      estimatedDates: [] as string[],
      missingRateDates: [] as string[],
      unfundedWithdrawals: [] as { transactionId: string; amount: Decimal }[],
      redemptions: [] as Redemption[],
      lifetimeNetGain: new Decimal(0),
      taxesFromBank: false,
      dailyBalances: [] as DailyBalance[],
      taxDetailsIncomplete: false,
      confirmedCreditCount: 0,
      ignoredEarningCreditIds,
      snapshotAudits: [],
      reconciliationAdjustment: {
        gross: new Decimal(0),
        net: new Decimal(0),
      },
      reconciled: false,
      calibration: evaluateCalibration([]),
      calibrationApplied: false,
    };
  const working: WorkingLot[] = [];
  const earnings: EarningEntry[] = [];
  const estimatedDates: string[] = [];
  const missingRateDates: string[] = [];
  const unfundedWithdrawals: { transactionId: string; amount: Decimal }[] = [];
  const redemptions: Redemption[] = [];
  const dailyBalances: DailyBalance[] = [];
  const samples: YieldSample[] = [];
  let learned: CalibrationReport | undefined;
  let calibrationApplied = false;
  const observationSource = calibrationSource(bank);
  const observations = (bank.earningCredits ?? []).filter(
    (credit) =>
      credit.user_id === bank.user_id &&
      credit.piggy_bank_id === bank.id &&
      new Date(credit.occurred_at).getTime() <=
        (options.now ?? new Date()).getTime() &&
      new Date(credit.created_at).getTime() <=
        (options.now ?? new Date()).getTime() &&
      isPlausibleDailyYield(bank, credit.net_amount),
  );
  const futureMovements = events.some(
    (event) => isoDate(parseDate(event.occurred_at)) > today,
  );
  const cursor = parseDate(
    [
      events[0]?.occurred_at,
      credits[0]?.occurred_at,
      snapshots[0]?.snapshot_date,
    ]
      .filter((value): value is string => !!value)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0],
  );
  const creditsByDay = new Map<string, BankEarningCredit[]>();
  for (const credit of credits) {
    const day = isoDate(parseDate(credit.occurred_at));
    creditsByDay.set(day, [...(creditsByDay.get(day) ?? []), credit]);
  }
  const eventsByDay = new Map<string, TransactionRow[]>();
  for (const event of events) {
    const day = isoDate(parseDate(event.occurred_at));
    eventsByDay.set(day, [...(eventsByDay.get(day) ?? []), event]);
  }
  const settledAt = (date: Date) => {
    const values = working.map((lot) =>
      lotValues(lot, bank, date, turboTaxProfile),
    );
    const sum = (key: 'remaining' | 'grossBalance' | 'iof' | 'incomeTax') =>
      values.reduce((total, item) => total.plus(item[key]), new Decimal(0));
    return settleBalance(
      {
        principal: sum('remaining'),
        grossBalance: sum('grossBalance'),
        iof: sum('iof'),
        incomeTax: sum('incomeTax'),
      },
      bank,
      turboTaxProfile,
    );
  };
  const rawAt = (date: Date) =>
    working.reduce(
      (sum, lot) => {
        const values = lotValues(lot, bank, date, turboTaxProfile);
        return {
          net: sum.net.plus(values.netBalance),
          gross: sum.gross.plus(values.grossBalance),
        };
      },
      { net: new Decimal(0), gross: new Decimal(0) },
    );

  while (cursor <= valuationDate) {
    const date = isoDate(cursor);
    const previousDate = new Date(cursor);
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    const opening = settledAt(previousDate);
    const rawOpening = rawAt(previousDate);
    let deposits = new Decimal(0);
    let paidWithdrawals = new Decimal(0);
    let redeemedGross = new Decimal(0);
    let redeemedIof = new Decimal(0);
    let redeemedIr = new Decimal(0);
    const dailyCredits = creditsByDay.get(date) ?? [];
    const confirmedNet = dailyCredits.reduce(
      (sum, credit) => sum.plus(credit.net_amount),
      new Decimal(0),
    );
    const dailyEvents = eventsByDay.get(date) ?? [];
    const addDeposit = (event: TransactionRow) => {
      const original = new Decimal(event.amount);
      deposits = deposits.plus(original);
      const usedBonus = working.reduce(
        (sum, lot) => sum.plus(lot.bonusBasis),
        new Decimal(0),
      );
      const bonusAvailable =
        bank.rate_limit === null
          ? original
          : Decimal.max(0, new Decimal(bank.rate_limit).minus(usedBonus));
      const bonusBasis = Decimal.min(original, bonusAvailable);
      const excessBasis = original.minus(bonusBasis);
      working.push({
        transaction: event,
        original,
        bonusBasis,
        excessBasis,
        bonusGross: bonusBasis,
        excessGross: excessBasis,
        businessDays: 0,
        confirmedNetProfit: new Decimal(0),
        observedNetProfit: new Decimal(0),
        postedCarry: new Decimal(0),
      });
    };

    // O fator DI pertence ao dia útil de competência; o calendário do banco
    // decide quando aparece.
    const creditedRateDates = bank.accrues_on_deposit_day
      ? calendar.isBusinessDay(cursor)
        ? [new Date(cursor)]
        : []
      : rateDatesCreditedOn(bank.bank, cursor, calendar);
    const creditedRates = creditedRateDates.map((sourceDate) => {
      const rateDate = isoDate(sourceDate);
      // CDI de qual dia paga este dia. Ver CDI_LAG_BUSINESS_DAYS.
      const lag = options.cdiLagBusinessDays ?? defaultCdiLag(bank);
      const lagged = lag ? calendar.move(sourceDate, -lag) : sourceDate;
      // Série curta sem dia anterior: usa o CDI do próprio dia.
      const valueSource =
        isoDate(lagged) < calendar.firstDate ? sourceDate : lagged;
      const valueDate = isoDate(valueSource);
      const publishedRate = calendar.map.get(valueDate);
      // Taxa ainda não publicada pelo BC: estima qualquer crédito até hoje (o de
      // sexta sai no sábado e a taxa só na segunda). Limite de sete dias.
      const recentPublicationPending =
        calendar.map.size > 0 &&
        date <= today &&
        valueDate > calendar.lastDate &&
        calendarDays(parseDate(calendar.lastDate), valueSource) <= 7;
      const projectedBeyondToday = projection && date > today;
      const estimated =
        !publishedRate &&
        valueDate > calendar.lastDate &&
        (recentPublicationPending || projectedBeyondToday);
      const rate =
        !projection && date > today
          ? undefined
          : (publishedRate ?? (estimated ? calendar.lastRate : undefined));
      return { rateDate, rate, estimated };
    });
    const rate = creditedRates.length
      ? creditedRates.every((item) => item.rate)
        ? creditedRates
        : undefined
      : undefined;
    const hasEligibleBalance = working.some(
      (lot) =>
        lot.bonusGross.plus(lot.excessGross).gt(0) &&
        (bank.accrues_on_deposit_day ||
          creditedRates.some(
            (item) =>
              isoDate(parseDate(lot.transaction.occurred_at)) <= item.rateDate,
          )),
    );
    if (
      hasEligibleBalance &&
      !dailyCredits.length &&
      (projection || date <= today)
    ) {
      for (const item of creditedRates) {
        if (item.rate && !item.estimated) continue;
        if (item.estimated) estimatedDates.push(date);
        else missingRateDates.push(item.rateDate);
      }
    }
    const accrue = (lot: WorkingLot, preview = false) => {
      // Crédito diário observado substitui o modelo; nunca soma os dois.
      if (!rate || (dailyCredits.length && !preview)) return;
      const before = lot.bonusGross.plus(lot.excessGross);
      for (const item of rate) {
        if (isoDate(parseDate(lot.transaction.occurred_at)) > item.rateDate)
          continue;
        const normalized = item.rate!.div(100);
        lot.bonusGross = lot.bonusGross.mul(
          normalized.mul(new Decimal(bank.cdi_percentage).div(100)).plus(1),
        );
        lot.excessGross = lot.excessGross.mul(
          normalized.mul(new Decimal(bank.excess_rate).div(100)).plus(1),
        );
        lot.businessDays += 1;
      }
      // Produto que credita líquido: o saldo cresce pelo líquido, sem provisão.
      if (!netPosted) return;
      const after = lot.bonusGross.plus(lot.excessGross);
      const growth = after.minus(before);
      if (!growth.gt(0)) return;
      const age = calendarDays(parseDate(lot.transaction.occurred_at), cursor);
      const iofDue =
        bank.iof_rule.toLowerCase().includes('isento') || age >= 30
          ? new Decimal(0)
          : growth.mul(IOF_RATES[Math.max(0, age)] ?? 0);
      const taxDue =
        bank.tax_rule === 'Isento'
          ? iofDue
          : iofDue.plus(Decimal.max(0, growth.minus(iofDue)).mul(irRate(age)));
      let net = growth.minus(taxDue);
      if (postsWholeCents) {
        const due = net.plus(lot.postedCarry);
        net = due.toDecimalPlaces(2, Decimal.ROUND_DOWN);
        lot.postedCarry = due.minus(net);
      }
      const scale = before.plus(net).div(after);
      lot.bonusGross = lot.bonusGross.mul(scale);
      lot.excessGross = lot.excessGross.mul(scale);
      lot.confirmedNetProfit = lot.confirmedNetProfit.plus(net);
    };
    // Em `balance`, o que passa do teto rende a taxa excedente.
    if (bank.rate_limit !== null && options.capBasis === 'balance') {
      let capLeft = new Decimal(bank.rate_limit);
      for (const lot of working) {
        const balance = lot.bonusGross.plus(lot.excessGross);
        const bonus = Decimal.min(balance, capLeft);
        capLeft = capLeft.minus(bonus);
        lot.bonusGross = bonus;
        lot.excessGross = balance.minus(bonus);
      }
    }
    // Contrafactual antes de consumir a observação de hoje (não treinar no valor conciliado).
    const savedLots = working.map((lot) => ({ ...lot }));
    for (const lot of working) accrue(lot, true);
    const rawClosing = rawAt(cursor);
    const inputs = {
      standard: settledAt(cursor).netBalance.minus(opening.netBalance),
      rawNet: rawClosing.net.minus(rawOpening.net),
      rawGross: rawClosing.gross.minus(rawOpening.gross),
      rawTaxes: rawClosing.gross
        .minus(rawOpening.gross)
        .minus(rawClosing.net.minus(rawOpening.net)),
    };
    working.splice(0, working.length, ...savedLots);
    const dayObservations = observations.filter(
      (credit) => isoDate(new Date(credit.occurred_at)) === date,
    );
    if (
      date <= today &&
      dayObservations.length === 1 &&
      dayObservations[0].source === observationSource &&
      !dailyEvents.length &&
      hasEligibleBalance &&
      rate &&
      creditedRates.every((item) => calendar.map.has(item.rateDate)) &&
      !missingRateDates.length &&
      (!bank.policy_started_at ||
        date >= bank.policy_started_at.slice(0, 10)) &&
      (!bank.policy_ends_at || date <= bank.policy_ends_at.slice(0, 10))
    ) {
      const actual = new Decimal(dayObservations[0].net_amount);
      if (actual.isFinite() && actual.gt(0) && actual.decimalPlaces() <= 2)
        samples.push({ ...inputs, date, actual });
    }
    for (const lot of working) accrue(lot);

    if (
      projection &&
      date > today &&
      options.calibration !== false &&
      !futureMovements
    ) {
      learned ??= evaluateCalibration(samples);
      if (
        learned.status === 'active' &&
        rate &&
        !dailyEvents.length &&
        !dailyCredits.length &&
        hasEligibleBalance &&
        (!bank.policy_ends_at || date <= bank.policy_ends_at.slice(0, 10))
      ) {
        const delta = predictYield(learned.selected, inputs).minus(
          inputs.standard,
        );
        // Correção aprendida não é juro/IR confirmado: fora da base fiscal.
        const weights = working.map((lot) =>
          lot.bonusGross.plus(lot.excessGross),
        );
        const total = weights.reduce(
          (sum, weight) => sum.plus(weight),
          new Decimal(0),
        );
        if (
          total.gt(0) &&
          delta.abs().lte('.02') &&
          predictYield(learned.selected, inputs).gte(0)
        ) {
          let remainder = delta;
          working.forEach((lot, index) => {
            const share =
              index === working.length - 1
                ? remainder
                : delta.mul(weights[index]).div(total);
            const bonusShare = weights[index].isZero()
              ? new Decimal(0)
              : share.mul(lot.bonusGross).div(weights[index]);
            lot.bonusGross = lot.bonusGross.plus(bonusShare);
            lot.excessGross = lot.excessGross.plus(share.minus(bonusShare));
            lot.confirmedNetProfit = lot.confirmedNetProfit.plus(share);
            lot.calibrated = true;
            remainder = remainder.minus(share);
          });
          calibrationApplied = true;
        }
      }
    }

    const timeline = [
      ...dailyEvents.map((movement) => ({
        at: movement.occurred_at,
        movement,
        credit: undefined as BankEarningCredit | undefined,
      })),
      ...dailyCredits.map((credit) => ({
        at: credit.occurred_at,
        movement: undefined as TransactionRow | undefined,
        credit,
      })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    for (const event of timeline) {
      if (event.credit) {
        const credit = event.credit;
        const net = new Decimal(credit.net_amount);
        const activeLots = working.filter((lot) =>
          lot.bonusGross.plus(lot.excessGross).gt(0),
        );
        const basis = activeLots.reduce(
          (sum, lot) => sum.plus(lot.bonusGross).plus(lot.excessGross),
          new Decimal(0),
        );
        if (basis.gt(0)) {
          let left = net;
          activeLots.forEach((lot, index) => {
            const balance = lot.bonusGross.plus(lot.excessGross);
            const share =
              index === activeLots.length - 1
                ? left
                : net.mul(balance).div(basis);
            const bonusShare = share.mul(lot.bonusGross).div(balance);
            lot.bonusGross = lot.bonusGross.plus(bonusShare);
            lot.excessGross = lot.excessGross.plus(share.minus(bonusShare));
            lot.confirmedNetProfit = lot.confirmedNetProfit.plus(share);
            lot.observedNetProfit = lot.observedNetProfit.plus(share);
            left = left.minus(share);
          });
        } else {
          // Crédito atrasado pode chegar após resgate total: vira rendimento sem principal.
          working.push({
            transaction: {
              id: `credit-${credit.id}`,
              user_id: credit.user_id,
              piggy_bank_id: bank.id,
              kind: 'adjustment',
              amount: '0',
              occurred_at: credit.occurred_at,
              created_at: credit.created_at,
              updated_at: credit.created_at,
              note: 'Crédito líquido do banco; não é aporte',
            },
            original: new Decimal(0),
            bonusBasis: new Decimal(0),
            excessBasis: new Decimal(0),
            bonusGross: net,
            excessGross: new Decimal(0),
            businessDays: 0,
            confirmedNetProfit: net,
            observedNetProfit: net,
            postedCarry: new Decimal(0),
          });
        }
        earnings.push({
          date,
          netAmount: net,
          grossAmount: null,
          taxes: null,
          confirmed: true,
          creditId: credit.id,
          occurredAt: credit.occurred_at,
        });
        continue;
      }
      const withdrawal = event.movement!;
      if (withdrawal.kind !== 'withdrawal') {
        addDeposit(withdrawal);
        if (bank.accrues_on_deposit_day) accrue(working[working.length - 1]);
        continue;
      }
      let cashRemaining = new Decimal(withdrawal.amount);
      const beforeRedemption = settledAt(cursor);
      const taxDetailsIncomplete = working.some(
        (lot) => lot.observedNetProfit.gt(0) || !!lot.reconciliationTax,
      );
      const displayedAvailable = beforeRedemption.netBalance;
      let paid = new Decimal(0);
      if (cashRemaining.gte(displayedAvailable)) {
        paid = displayedAvailable;
        cashRemaining = cashRemaining.minus(displayedAvailable);
        working.length = 0;
      }
      for (const lot of working) {
        if (cashRemaining.lte(0)) break;
        const values = lotValues(lot, bank, cursor, turboTaxProfile);
        if (values.netBalance.lte(0)) continue;
        const original = {
          bonusBasis: lot.bonusBasis,
          excessBasis: lot.excessBasis,
          bonusGross: lot.bonusGross,
          excessGross: lot.excessGross,
          confirmedNetProfit: lot.confirmedNetProfit,
          observedNetProfit: lot.observedNetProfit,
          postedCarry: lot.postedCarry,
          reconciliationTax: lot.reconciliationTax,
        };
        const keepFraction = (keep: Decimal) => {
          lot.bonusBasis = original.bonusBasis.mul(keep);
          lot.excessBasis = original.excessBasis.mul(keep);
          lot.bonusGross = original.bonusGross.mul(keep);
          lot.excessGross = original.excessGross.mul(keep);
          lot.confirmedNetProfit = original.confirmedNetProfit.mul(keep);
          lot.observedNetProfit = original.observedNetProfit.mul(keep);
          lot.postedCarry = original.postedCarry.mul(keep);
          if (original.reconciliationTax)
            lot.reconciliationTax = {
              iof: original.reconciliationTax.iof.mul(keep),
              ir: original.reconciliationTax.ir.mul(keep),
              iofRate: original.reconciliationTax.iofRate,
            };
        };
        const beforeNet = settledAt(cursor).netBalance;
        keepFraction(new Decimal(0));
        const available = beforeNet.minus(settledAt(cursor).netBalance);
        if (available.lte(0)) {
          keepFraction(new Decimal(1));
          continue;
        }
        const cash = Decimal.min(cashRemaining, available);
        if (cash.lt(available)) {
          // Resolve o resgate a partir do LÍQUIDO pedido, com imposto em centavos.
          const target = beforeNet.minus(cash);
          let low = new Decimal(0);
          let high = new Decimal(1);
          let matched = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const keep = low.plus(high).div(2);
            keepFraction(keep);
            const net = settledAt(cursor).netBalance;
            if (net.eq(target)) {
              matched = true;
              break;
            }
            if (net.lt(target)) low = keep;
            else high = keep;
          }
          if (!matched)
            throw new Error('Não foi possível liquidar o resgate em centavos.');
        }
        cashRemaining = cashRemaining.minus(cash);
      }
      if (working.length)
        paid = new Decimal(withdrawal.amount)
          .minus(cashRemaining)
          .toDecimalPlaces(2);
      paidWithdrawals = paidWithdrawals.plus(paid);
      const afterRedemption = settledAt(cursor);
      const grossAmount = beforeRedemption.grossBalance.minus(
        afterRedemption.grossBalance,
      );
      const iof = beforeRedemption.iof.minus(afterRedemption.iof);
      const incomeTax = beforeRedemption.incomeTax.minus(
        afterRedemption.incomeTax,
      );
      redeemedGross = redeemedGross.plus(grossAmount);
      redeemedIof = redeemedIof.plus(iof);
      redeemedIr = redeemedIr.plus(incomeTax);
      redemptions.push({
        transactionId: withdrawal.id,
        date,
        netAmount: paid,
        grossAmount,
        principalAmount: beforeRedemption.principal.minus(
          afterRedemption.principal,
        ),
        iof,
        incomeTax,
        roundingDifference: paid.minus(grossAmount.minus(iof).minus(incomeTax)),
        taxDetailsIncomplete,
      });
      if (cashRemaining.toDecimalPlaces(2).gt(0)) {
        unfundedWithdrawals.push({
          transactionId: withdrawal.id,
          amount: cashRemaining.toDecimalPlaces(2),
        });
      }
    }
    const modeledClosing = settledAt(cursor);
    const snapshot = snapshotsByDate.get(date);
    if (snapshot) {
      const targetGross = new Decimal(snapshot.gross_balance);
      const targetNet = new Decimal(snapshot.net_balance);
      snapshotAudits.push({
        snapshot,
        calculatedGross: modeledClosing.grossBalance,
        calculatedNet: modeledClosing.netBalance,
        grossDifference: modeledClosing.grossBalance.minus(targetGross),
        netDifference: modeledClosing.netBalance.minus(targetNet),
      });
      reconciled = true;
      grossReconciliation = grossReconciliation.plus(
        targetGross.minus(modeledClosing.grossBalance),
      );
      netReconciliation = netReconciliation.plus(
        targetNet.minus(modeledClosing.netBalance),
      );
      if (
        !modeledClosing.grossBalance.eq(targetGross) ||
        !modeledClosing.netBalance.eq(targetNet)
      ) {
        // Rebase dos lotes após o dia, preservando datas e principal. A correção não
        // vira principal; amostras anteriores continuam calibrando a política.
        learned = undefined;
        if (targetGross.isZero()) working.length = 0;
        else {
          const active = working.filter((lot) =>
            lot.bonusGross.plus(lot.excessGross).gt(0),
          );
          working.splice(0, working.length, ...active);
          if (!working.length)
            working.push({
              transaction: {
                id: `snapshot-${snapshot.id}`,
                user_id: bank.user_id,
                piggy_bank_id: bank.id,
                kind: 'adjustment',
                amount: '0',
                occurred_at: `${date}T12:00:00-03:00`,
                created_at: snapshot.created_at,
                updated_at: snapshot.created_at,
                note: 'Saldo conciliado',
              },
              original: new Decimal(0),
              bonusBasis: new Decimal(0),
              excessBasis: new Decimal(0),
              bonusGross: targetGross,
              excessGross: new Decimal(0),
              businessDays: 0,
              confirmedNetProfit: new Decimal(0),
              observedNetProfit: new Decimal(0),
              postedCarry: new Decimal(0),
            });
          const weights = working.map((lot) =>
            lot.bonusGross.plus(lot.excessGross),
          );
          const weightTotal = weights.reduce(
            (sum, weight) => sum.plus(weight),
            new Decimal(0),
          );
          let grossLeft = targetGross;
          // Primeiro rebase do bruto em todos os lotes, depois modela, depois divide o
          // imposto observado na proporção do modelo.
          const rebased = working.map((lot, index) => {
            const last = index === working.length - 1;
            const gross = last
              ? grossLeft
              : targetGross
                  .mul(weights[index])
                  .div(weightTotal)
                  .toDecimalPlaces(2, Decimal.ROUND_DOWN);
            grossLeft = grossLeft.minus(gross);
            const ratio = lot.bonusGross.div(weights[index]);
            const scale = gross.div(weights[index]);
            lot.bonusGross = gross.mul(ratio);
            lot.excessGross = gross.minus(lot.bonusGross);
            lot.confirmedNetProfit = lot.confirmedNetProfit.mul(scale);
            lot.observedNetProfit = lot.observedNetProfit.mul(scale);
            lot.postedCarry = new Decimal(0);
            lot.reconciliationTax = undefined;
            const model = lotValues(lot, bank, cursor, turboTaxProfile);
            return { lot, model, modeledTax: model.iof.plus(model.incomeTax) };
          });
          // Imposto é dividido pelo imposto modelado, não pelo saldo.
          const modeledTotal = rebased.reduce(
            (sum, item) => sum.plus(item.modeledTax),
            new Decimal(0),
          );
          // O banco trunca a provisão: 6,99 significa [6,99; 7,00). Só corrige o
          // modelo quando ele sai desse intervalo, até a borda mais próxima.
          const observedTax = targetGross.minus(targetNet);
          const ceiling = observedTax.plus('0.01').minus('0.000001');
          const target = Decimal.min(
            Decimal.max(modeledTotal, observedTax),
            ceiling,
          );
          const correction = target.minus(modeledTotal);
          if (!correction.isZero()) {
            // A correção vai para o IOF (onde está a incerteza); o IR fica em centavos
            // inteiros. Após 30 dias não há IOF: vai para o IR.
            const modeledIof = rebased.reduce(
              (sum, item) => sum.plus(item.model.iof),
              new Decimal(0),
            );
            rebased.forEach(({ lot, model }) => {
              const onIof = modeledIof.gt(0);
              const share = onIof
                ? model.iof.div(modeledIof)
                : modeledTotal.gt(0)
                  ? model.iof.plus(model.incomeTax).div(modeledTotal)
                  : new Decimal(1).div(rebased.length);
              lot.reconciliationTax = {
                iof: onIof ? correction.mul(share) : new Decimal(0),
                ir: onIof ? new Decimal(0) : correction.mul(share),
                iofRate: new Decimal(IOF_RATES[model.age] ?? 0),
              };
            });
          }
        }
      }
    }
    // O snapshot oficial fecha o dia; retorno recalculado sem os aportes.
    const closing = settledAt(cursor);
    const snapshotEstablishesOpeningBalance =
      Boolean(snapshot) &&
      modeledClosing.grossBalance.isZero() &&
      opening.grossBalance.isZero() &&
      deposits.isZero() &&
      paidWithdrawals.isZero();
    // Primeiro snapshot isolado é saldo de abertura, não rendimento.
    const dailyNet = snapshotEstablishesOpeningBalance
      ? new Decimal(0)
      : closing.netBalance
          .minus(opening.netBalance)
          .minus(deposits)
          .plus(paidWithdrawals)
          .toDecimalPlaces(2);
    const grossAmount = snapshotEstablishesOpeningBalance
      ? new Decimal(0)
      : closing.grossBalance
          .minus(opening.grossBalance)
          .minus(deposits)
          .plus(redeemedGross);
    const modeledNet = dailyNet.minus(confirmedNet);
    const modeledGross = grossAmount.minus(confirmedNet);
    const reconciliationCanTeach =
      Boolean(snapshot) &&
      !snapshotEstablishesOpeningBalance &&
      date <= today &&
      hasEligibleBalance &&
      Boolean(rate) &&
      creditedRates.every((item) => calendar.map.has(item.rateDate)) &&
      !samples.some((sample) => sample.date === date) &&
      (!bank.policy_started_at ||
        date >= bank.policy_started_at.slice(0, 10)) &&
      (!bank.policy_ends_at || date <= bank.policy_ends_at.slice(0, 10)) &&
      dailyNet.gt(0) &&
      inputs.standard.gte(0) &&
      // Até 10 centavos é arredondamento; acima, provavelmente falta movimento.
      dailyNet.minus(inputs.standard).abs().lte('.10');
    if (reconciliationCanTeach)
      samples.push({ ...inputs, date, actual: dailyNet });
    const calibratedDay = working.some((lot) => lot.calibrated);
    if (!modeledGross.isZero() || !modeledNet.isZero())
      earnings.push({
        date,
        grossAmount: calibratedDay ? null : modeledGross,
        netAmount: modeledNet,
        taxes: calibratedDay ? null : modeledGross.minus(modeledNet),
        iof:
          calibratedDay || snapshot
            ? undefined
            : closing.iof.minus(opening.iof).plus(redeemedIof),
        incomeTax:
          calibratedDay || snapshot
            ? undefined
            : closing.incomeTax.minus(opening.incomeTax).plus(redeemedIr),
        calibrated: calibratedDay,
        reconciled: Boolean(snapshot),
      });
    dailyBalances.push({
      ...closing,
      date,
      netGain: dailyNet,
      taxDetailsIncomplete: working.some(
        (lot) =>
          lot.observedNetProfit.gt(0) ||
          lot.calibrated ||
          !!lot.reconciliationTax,
      ),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const lots: Lot[] = working
    .filter((lot) => lot.bonusGross.plus(lot.excessGross).gt('0.000001'))
    .map((lot) => {
      const values = lotValues(lot, bank, valuationDate, turboTaxProfile);
      return {
        transaction: lot.transaction,
        original: lot.original,
        businessDays: lot.businessDays,
        pendingCents: lot.postedCarry,
        ...values,
        taxDetailsIncomplete:
          lot.observedNetProfit.gt(0) ||
          !!lot.calibrated ||
          !!lot.reconciliationTax,
        settled: settleBalance(
          {
            principal: values.remaining,
            grossBalance: values.grossBalance,
            iof: values.iof,
            incomeTax: values.incomeTax,
          },
          bank,
          turboTaxProfile,
        ),
      };
    });
  const principal = lots.reduce(
    (sum, lot) => sum.plus(lot.remaining),
    new Decimal(0),
  );
  const iof = lots.reduce((sum, lot) => sum.plus(lot.iof), new Decimal(0));
  const incomeTax = lots.reduce(
    (sum, lot) => sum.plus(lot.incomeTax),
    new Decimal(0),
  );
  const grossBalance = lots.reduce(
    (sum, lot) => sum.plus(lot.grossBalance),
    new Decimal(0),
  );
  const rawFinal = settleBalance(
    { principal, grossBalance, iof, incomeTax },
    bank,
    turboTaxProfile,
  );
  const reconciledFinal = dailyBalances.at(-1);
  // Se o banco informou IR (`taxes`) e IOF (`taxes2`) separados, vale a
  // divisão dele; nos outros dias, a estimativa.
  const bankSplit = snapshotsByDate.get(isoDate(valuationDate));
  const bankTaxes =
    bankSplit &&
    bankSplit.iof !== null &&
    bankSplit.iof !== undefined &&
    bankSplit.income_tax !== null &&
    bankSplit.income_tax !== undefined
      ? {
          iof: new Decimal(bankSplit.iof),
          incomeTax: new Decimal(bankSplit.income_tax),
        }
      : null;
  return {
    ...rawFinal,
    ...bankTaxes,
    grossBalance: reconciledFinal?.grossBalance ?? rawFinal.grossBalance,
    grossProfit: reconciledFinal?.grossProfit ?? rawFinal.grossProfit,
    netBalance: reconciledFinal?.netBalance ?? rawFinal.netBalance,
    /** IR e IOF de hoje vieram do banco. */
    taxesFromBank: !!bankTaxes,
    taxDetailsIncomplete: bankTaxes
      ? false
      : lots.some((lot) => lot.taxDetailsIncomplete) ||
        !grossReconciliation.isZero() ||
        !netReconciliation.isZero(),
    confirmedCreditCount: credits.length,
    ignoredEarningCreditIds: [
      ...new Set([
        ...ignoredEarningCreditIds,
        ...(bank.earningCredits ?? [])
          .filter((credit) => !isPlausibleDailyYield(bank, credit.net_amount))
          .map((credit) => credit.id),
      ]),
    ],
    snapshotAudits,
    reconciliationAdjustment: {
      gross: grossReconciliation,
      net: netReconciliation,
    },
    reconciled,
    calibration: learned ?? evaluateCalibration(samples),
    calibrationApplied,
    lots,
    earnings,
    estimatedDates,
    missingRateDates,
    unfundedWithdrawals,
    redemptions,
    dailyBalances,
    lifetimeNetGain: earnings.reduce(
      (sum, entry) => sum.plus(entry.netAmount),
      new Decimal(0),
    ),
  };
}
