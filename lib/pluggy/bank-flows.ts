import type { BankTransaction } from './bank-detail';

/* Repasses: entrada e saída de mesmo valor, próximas, são dinheiro que só
   passou pela conta. Regra: mesmo valor ao centavo, sinais opostos, até 12 h,
   cada transação em um par, o mais próximo primeiro. */

const WINDOW_MS = 12 * 60 * 60 * 1000;

export type PassThrough = {
  /** A entrada que cobriu a saída. */
  in: BankTransaction;
  out: BankTransaction;
};

/** Os pares de repasse, e o conjunto de ids que entraram em algum. */
export function findPassThroughs(transactions: BankTransaction[]) {
  const time = (transaction: BankTransaction) =>
    Date.parse(transaction.at ?? `${transaction.date}T12:00:00Z`);
  const cents = (value: number) => Math.round(Math.abs(value) * 100);

  // Candidatos do mais próximo ao mais distante, aceitos gulosamente.
  const credits = transactions.filter(
    (t) => t.amount > 0 && t.flow !== 'yield',
  );
  const debits = transactions.filter((t) => t.amount < 0);
  const candidates: {
    in: BankTransaction;
    out: BankTransaction;
    gap: number;
  }[] = [];
  for (const credit of credits)
    for (const debit of debits) {
      if (cents(credit.amount) !== cents(debit.amount)) continue;
      const gap = Math.abs(time(credit) - time(debit));
      if (gap <= WINDOW_MS) candidates.push({ in: credit, out: debit, gap });
    }
  candidates.sort((a, b) => a.gap - b.gap);

  const used = new Set<string>();
  const pairs: PassThrough[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.in.id) || used.has(candidate.out.id)) continue;
    used.add(candidate.in.id);
    used.add(candidate.out.id);
    pairs.push({ in: candidate.in, out: candidate.out });
  }
  return { pairs, ids: used };
}
