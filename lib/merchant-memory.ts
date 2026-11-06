import { cleanBankMerchant, merchantKey } from './merchant-names';

/**
 * O que a sincronização aprende com as compras já gravadas, para dar nome às
 * novas sem precisar de regra:
 * - nome do banco → o nome que a última compra igual recebeu (inclusive
 *   renomeada à mão);
 * - parcela → o nome das outras parcelas da mesma compra;
 * - grafia → a forma mais usada do mesmo nome ("Hiltonpipocas" vira
 *   "Hilton Pipocas" se é assim que o lugar já aparece).
 */
export type NamedEntry = {
  description: string;
  /** Nome como veio do banco (`financial_entries.bank_description`). */
  bank_description?: string | null;
  installment_group_id?: string | null;
  occurred_at: string;
};

export type MerchantMemory = {
  name: (entry: {
    description: string;
    bankDescription?: string | null;
    installmentGroupId?: string | null;
  }) => string;
};

export function merchantMemory(rows: NamedEntry[]): MerchantMemory {
  const byBank = new Map<string, string>();
  const byGroup = new Map<string, string>();
  const spellings = new Map<string, Map<string, number>>();
  const ordered = [...rows].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  );
  for (const row of ordered) {
    const description = row.description.trim();
    if (!description) continue;
    // A mais recente vence: se o nome mudou de novo, vale o último.
    if (row.bank_description) {
      const key = merchantKey(cleanBankMerchant(row.bank_description));
      if (key) byBank.set(key, description);
    }
    if (row.installment_group_id)
      byGroup.set(row.installment_group_id, description);
    const key = merchantKey(description);
    // Grafia gritada (antiga, de antes da limpeza) não serve de modelo.
    if (
      !key ||
      (/[A-Z]{4}/.test(description) &&
        description === description.toUpperCase())
    )
      continue;
    const counts = spellings.get(key) ?? new Map<string, number>();
    counts.set(description, (counts.get(description) ?? 0) + 1);
    spellings.set(key, counts);
  }
  const spelling = (description: string) => {
    const counts = spellings.get(merchantKey(description));
    if (!counts) return null;
    return [...counts].sort((a, b) => b[1] - a[1])[0][0];
  };
  return {
    name: ({ description, bankDescription, installmentGroupId }) =>
      (installmentGroupId && byGroup.get(installmentGroupId)) ||
      (bankDescription &&
        byBank.get(merchantKey(cleanBankMerchant(bankDescription)))) ||
      spelling(description) ||
      description,
  };
}
