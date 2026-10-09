import type {
  BankEarningCredit,
  PiggyBank,
  PiggyBankRow,
  SnapshotRow,
  TransactionRow,
} from '@/lib/domain';

/** Um cofrinho como o Supabase devolve, com as três tabelas de histórico
 * embutidas pelo select. */
export type BankWithRelations = PiggyBankRow & {
  transactions: TransactionRow[];
  balance_snapshots: SnapshotRow[];
  bank_earning_credits: BankEarningCredit[];
};

/** O formato que o motor (`calculate`) espera, com cada histórico em ordem
 * cronológica. Fora do hook para o servidor — o Vetra AI — poder usar sem
 * importar um módulo de cliente. */
export function normalizedBank(bank: BankWithRelations): PiggyBank {
  const { balance_snapshots, bank_earning_credits, ...row } = bank;
  return {
    ...row,
    transactions: [...(row.transactions ?? [])].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at),
    ),
    snapshots: [...(balance_snapshots ?? [])].sort((a, b) =>
      a.snapshot_date.localeCompare(b.snapshot_date),
    ),
    earningCredits: [...(bank_earning_credits ?? [])].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at),
    ),
  };
}
