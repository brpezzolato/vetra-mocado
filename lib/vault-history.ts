// "Quanto já ganhei" por mês, cofrinhos atuais e encerrados (só os do Vetra).
// Puro. Só rendimento, nunca negativo (`yieldOnly`).
import Decimal from 'decimal.js';
import type { EarningEntry } from './finance';
import { yieldOnly } from './portfolio';

export type VaultEarnings = {
  name: string;
  bank: string;
  earnings: EarningEntry[];
  /** Só nos encerrados: quando saiu do app; o rendimento vai até esse dia. */
  archivedAt?: string;
};

export type MonthYield = { month: string; total: Decimal };

export function monthlyYields(vaults: VaultEarnings[]): MonthYield[] {
  const totals = new Map<string, Decimal>();
  for (const vault of vaults) {
    const months = new Set(
      vault.earnings.map((entry) => entry.date.slice(0, 7)),
    );
    for (const month of months)
      totals.set(
        month,
        (totals.get(month) ?? new Decimal(0)).plus(
          yieldOnly(vault.earnings, `${month}-01`, `${month}-31`),
        ),
      );
  }
  return [...totals]
    .filter(([, total]) => total.gt(0))
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, total]) => ({ month, total }));
}

export type ClosedSummary = {
  key: string;
  label: string;
  detail: string;
  total: Decimal;
};

const shortDate = (day: string) => {
  const [, month, dd] = day.slice(0, 10).split('-');
  return `${dd}/${month}`;
};

/** Uma linha por cofrinho encerrado, com o quanto ele rendeu no total. */
export function closedSummaries(archived: VaultEarnings[]): ClosedSummary[] {
  return archived
    .map((vault) => ({
      key: `vault-${vault.bank}-${vault.name}-${vault.archivedAt}`,
      label: `${vault.bank} · ${vault.name}`,
      detail: vault.archivedAt
        ? `Encerrado em ${shortDate(vault.archivedAt)}`
        : 'Encerrado',
      total: yieldOnly(vault.earnings),
    }))
    .filter((item) => item.total.gt(0));
}
