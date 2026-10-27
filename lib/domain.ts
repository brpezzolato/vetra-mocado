export type BankName = 'Nubank' | 'Mercado Pago' | 'Itaú';
export type TransactionKind = 'deposit' | 'withdrawal' | 'adjustment';

export type PiggyBankRow = {
  id: string;
  user_id: string;
  bank: BankName;
  name: string;
  product: string;
  cdi_percentage: number | string;
  tax_rule: 'Regressivo' | 'Isento';
  iof_rule: string;
  accrues_on_deposit_day: boolean;
  rate_limit: number | string | null;
  excess_rate: number | string;
  policy_version: string;
  policy_started_at: string | null;
  policy_ends_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TransactionRow = {
  id: string;
  user_id: string;
  piggy_bank_id: string;
  kind: TransactionKind;
  amount: number | string;
  occurred_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type SnapshotRow = {
  id: string;
  user_id: string;
  piggy_bank_id: string;
  snapshot_date: string;
  gross_balance: number | string;
  net_balance: number | string;
  /** The bank's own split of what it withholds, when it was copied from the
   * "Impostos no resgate" screen. Both or neither; together they equal
   * gross − net (enforced by the database). */
  iof?: number | string | null;
  income_tax?: number | string | null;
  source: string;
  created_at: string;
};

export type DailyRate = { date: string; rate: string };

export type BankEarningCredit = {
  id: string;
  user_id: string;
  piggy_bank_id: string;
  occurred_at: string;
  net_amount: number | string;
  source: string;
  created_at: string;
};

export type PiggyBank = PiggyBankRow & {
  transactions: TransactionRow[];
  snapshots: SnapshotRow[];
  earningCredits?: BankEarningCredit[];
};

const BANK_POLICIES = {
  Nubank: {
    product: 'Caixinha Turbo',
    cdi: 115,
    limit: 5000,
    excess: 100,
    taxRule: 'Regressivo' as const,
    iofRule: 'Regressivo até o 29º dia; zero a partir do 30º',
    accruesOnDepositDay: false,
    version: 'NUB-TURBO-115',
    color: '#b517f5',
    logo: '/logos/nubank-ui.webp',
  },
  'Mercado Pago': {
    product: 'Cofrinho Meli+',
    cdi: 120,
    limit: 10000,
    excess: 100,
    taxRule: 'Regressivo' as const,
    iofRule: 'Isento desde o primeiro dia',
    accruesOnDepositDay: false,
    version: 'MP-MELI-120-2026-08',
    color: '#ffe600',
    logo: '/logos/mercado-pago-ui.webp',
  },
  // Cofrinho do Itaú: CDB a 100% do CDI (taxa do lote na Pluggy), sem teto.
  Itaú: {
    product: 'Cofrinho',
    cdi: 100,
    limit: null,
    excess: 100,
    taxRule: 'Regressivo' as const,
    iofRule: 'Regressivo até o 29º dia; zero a partir do 30º',
    accruesOnDepositDay: false,
    version: 'ITAU-COFRINHO-100',
    color: '#ec7000',
    logo: '/logos/itau-app.webp',
  },
} satisfies Record<BankName, unknown>;

export const bankPolicy = (bank: BankName) => BANK_POLICIES[bank];

/** Logo do banco do cofrinho; `null` para um nome que não é de cofrinho. */
export const bankLogo = (bank: string): string | null =>
  bank in BANK_POLICIES ? BANK_POLICIES[bank as BankName].logo : null;
