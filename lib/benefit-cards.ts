import Decimal from 'decimal.js';
import type { ExpenseCategory } from './expense-categories';
import { saoDate } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';

/**
 * Um cartão Flash, dois saldos que não se misturam: VT (transporte) e
 * VR/VA (alimentação). `account` é a chave dos snapshots em
 * `benefit_card_balances`; a carteira de cada lançamento vem de `walletForEntry`.
 */
export const FLASH_WALLETS = [
  {
    key: 'alimentacao',
    label: 'Alimentação e Refeição',
    account: 'Flash Alimentação',
    category: 'Alimentação' satisfies ExpenseCategory,
  },
  {
    key: 'transporte',
    label: 'Transporte',
    account: 'Flash Transporte',
    category: 'Transporte' satisfies ExpenseCategory,
  },
] as const;

export type FlashWallet = (typeof FLASH_WALLETS)[number];

/**
 * De qual carteira saiu o movimento: VT só aceita 99, Uber e Metrô/CPTM;
 * todo o resto vai para alimentação. A regra é total de propósito: carteira
 * errada se corrige na próxima leitura de saldo, lançamento perdido não.
 * `category` aceita null porque vem direto do Postgres.
 */
export function walletForEntry(entry: { category: string | null }) {
  // Por chave, nunca por posição: a ordem de FLASH_WALLETS é de exibição.
  const named = FLASH_WALLETS.find(
    (item) => item.category === entry.category?.trim(),
  );
  return named ?? FLASH_WALLETS.find((item) => item.key === 'alimentacao')!;
}

/** Movimentos da carteira. As duas juntas devolvem todos os lançamentos. */
export function walletEntries(wallet: FlashWallet, entries: FinancialEntry[]) {
  return entries.filter((entry) => walletForEntry(entry).key === wallet.key);
}

export type BenefitCardBalance = {
  id: string;
  user_id: string;
  account: string;
  balance: number | string;
  /** The day the card itself reported this figure, YYYY-MM-DD. */
  measured_at: string;
  source: 'manual' | 'benefit_statement';
  created_at: string;
  updated_at: string;
};

export type BenefitBalanceView = {
  /** What the card should hold right now. */
  current: string;
  /** The figure the card reported, untouched. */
  reported: string;
  reportedOn: string;
  /** Movements recorded after that day, which is what moved the two apart. */
  spentSince: string;
  receivedSince: string;
  movementsSince: number;
};

/**
 * Saldo atual = saldo informado − gastos + entradas desde aquele dia.
 * Lançamentos do mesmo dia já estão dentro da leitura. `entries` já vem
 * filtrado pelo chamador (cartão inteiro ou uma carteira).
 */
export function benefitBalanceView(
  snapshot: Pick<BenefitCardBalance, 'balance' | 'measured_at'> | null,
  entries: FinancialEntry[],
): BenefitBalanceView | null {
  if (!snapshot) return null;
  const since = entries.filter(
    (entry) => saoDate(entry.occurred_at) > snapshot.measured_at,
  );
  const total = (type: FinancialEntry['entry_type']) =>
    since
      .filter((entry) => entry.entry_type === type)
      .reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
  const spent = total('expense');
  const received = total('income');
  const reported = new Decimal(snapshot.balance);
  return {
    current: reported.minus(spent).plus(received).toFixed(2),
    reported: reported.toFixed(2),
    reportedOn: snapshot.measured_at,
    spentSince: spent.toFixed(2),
    receivedSince: received.toFixed(2),
    movementsSince: since.length,
  };
}

/** Leitura mais recente pelo dia a que se refere, não pelo dia em que foi digitada. */
export function latestBenefitBalance(
  balances: BenefitCardBalance[],
  account: string,
) {
  return (
    balances
      .filter((balance) => balance.account === account)
      .sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0] ?? null
  );
}

export type BenefitCycle = {
  /** O dia do depósito que abriu o ciclo, YYYY-MM-DD. */
  start: string;
  /** Dia do depósito seguinte (limite exclusivo); `null` no ciclo aberto. */
  next: string | null;
  entries: FinancialEntry[];
};

/**
 * Extrato em ciclos, do mais novo ao mais velho. Só o depósito de Alimentação
 * e Refeição abre ciclo: o do Transporte cai em outro dia e partia o mês em
 * dois (26/10/2026, pedido do Bruno); ele entra no ciclo em que cair. O mais
 * antigo não tem limite inferior para nenhum lançamento sumir; sem depósitos,
 * um ciclo só.
 */
export function benefitCycles(entries: FinancialEntry[]): BenefitCycle[] {
  const day = (entry: FinancialEntry) => saoDate(entry.occurred_at);
  const sorted = [...entries].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at),
  );
  const starts = [
    ...new Set(
      sorted
        .filter(
          (entry) =>
            entry.entry_type === 'income' &&
            walletForEntry(entry).key === 'alimentacao',
        )
        .map(day),
    ),
  ].sort((a, b) => b.localeCompare(a));
  if (!starts.length) return [{ start: '', next: null, entries: sorted }];
  return starts.map((start, index) => {
    const floor = index === starts.length - 1 ? '' : start;
    const next = index === 0 ? null : starts[index - 1]!;
    return {
      start,
      next,
      entries: sorted.filter((entry) => {
        const value = day(entry);
        return value >= floor && (next === null || value < next);
      }),
    };
  });
}

export type BenefitForecast = {
  /** Quanto saiu por dia, em média, desde o depósito que abriu o ciclo. */
  perDay: string;
  /** O dia em que, nesse ritmo, o saldo chega a zero. */
  runsOutOn: string;
  /** Data esperada do próximo depósito; `null` se já passou. */
  nextDeposit: string | null;
  /** Se o saldo aguenta até o próximo depósito. */
  lasts: boolean;
  /** O que deve sobrar no dia do próximo depósito, quando aguenta. */
  leftover: string | null;
};

/** Com menos dias a média seria um gasto só. */
export const FORECAST_MIN_DAYS = 3;

const daysApart = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86400000,
  );

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Último depósito + mediana dos intervalos (30 dias se houver só um).
 * `null` se a data já passou. `deposits` em ordem, YYYY-MM-DD.
 */
export function expectedNextDeposit(deposits: string[], today: string) {
  const last = deposits.at(-1);
  if (!last) return null;
  const gaps = deposits
    .slice(1)
    .map((day, index) => daysApart(deposits[index]!, day))
    .sort((a, b) => a - b);
  const gap = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)]! : 30;
  const expected = addDays(last, gap);
  return expected > today ? expected : null;
}

/** Previsão da carteira até o próximo depósito, no ritmo do ciclo aberto
 * (gasto desde o último depósito ÷ dias corridos, contando hoje). `entries`
 * só desta carteira. `null` sem depósito, com ciclo curto ou sem gasto. */
export function benefitForecast(
  current: Decimal.Value,
  entries: FinancialEntry[],
  today: string,
): BenefitForecast | null {
  const deposits = [
    ...new Set(
      entries
        .filter((entry) => entry.entry_type === 'income')
        .map((entry) => saoDate(entry.occurred_at))
        .filter((day) => day <= today),
    ),
  ].sort();
  const start = deposits.at(-1);
  if (!start) return null;
  const elapsed = daysApart(start, today) + 1;
  if (elapsed < FORECAST_MIN_DAYS) return null;
  const spent = entries
    .filter((entry) => entry.entry_type === 'expense')
    .filter((entry) => {
      const day = saoDate(entry.occurred_at);
      return day >= start && day <= today;
    })
    .reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
  if (spent.lte(0)) return null;
  const rate = spent.div(elapsed);
  const balance = Decimal.max(0, new Decimal(current));
  const runsOutOn = addDays(today, balance.div(rate).floor().toNumber());

  const nextDeposit = expectedNextDeposit(deposits, today);
  const lasts = nextDeposit !== null && runsOutOn >= nextDeposit;
  return {
    perDay: rate.toDecimalPlaces(2).toFixed(2),
    runsOutOn,
    nextDeposit,
    lasts,
    leftover: lasts
      ? balance
          .minus(rate.mul(daysApart(today, nextDeposit!)))
          .toDecimalPlaces(2)
          .toFixed(2)
      : null,
  };
}
