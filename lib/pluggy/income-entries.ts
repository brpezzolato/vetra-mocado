// Entradas das contas correntes → lançamentos de renda. Puro.
// Toda entrada vira lançamento; no "Entrou" só conta o que casa com uma fonte
// de `income_sources` (por trecho da descrição). O resto chega "fora das
// contas". Transferências próprias, resgates e rendimentos nem viram lançamento.
// O que conta leva o nome da fonte; o resto, o de quem pagou.
import Decimal from 'decimal.js';
import { scrubIdentifiers } from '../ai-privacy';
import type { CardEntry } from './card-entries';
import { counterpart } from './pix-entries';
import type { PluggyTransaction } from './types';

/** Para onde vão as entradas de renda, de qualquer banco. */
export const INCOME_ACCOUNT = 'Renda';

export type IncomeSource = {
  /** `skip`: esta transação não conta, mesmo que uma regra a pegue. */
  match: 'contains' | 'transaction' | 'skip';
  pattern: string;
  label: string;
  category: string;
};

const plain = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

export function incomeSourceFor(
  transaction: Pick<PluggyTransaction, 'id' | 'description'>,
  sources: IncomeSource[],
) {
  // Escolha por id vence a regra por trecho.
  if (
    sources.some(
      (source) => source.match === 'skip' && source.pattern === transaction.id,
    )
  )
    return null;
  return (
    sources.find(
      (source) =>
        source.match === 'transaction' && source.pattern === transaction.id,
    ) ??
    sources.find(
      (source) =>
        source.match === 'contains' &&
        plain(transaction.description).includes(plain(source.pattern)),
    ) ??
    null
  );
}

export function mapIncomeTransactions(
  transactions: PluggyTransaction[],
  sources: IncomeSource[],
): CardEntry[] {
  return transactions.filter(isIncomeCandidate).map((transaction) => {
    const source = incomeSourceFor(transaction, sources);
    return {
      externalId: transaction.id,
      entryType: 'income',
      amount: new Decimal(Math.abs(transaction.amount))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toFixed(2),
      description: source?.label ?? payer(transaction.description),
      category: source?.category ?? 'Receita',
      // O registro fica sempre; o que não é renda só não conta.
      excluded: !source,
      occurredAt: transaction.date,
      bankStatus: transaction.status === 'POSTED' ? 'POSTED' : 'PENDING',
      invoiceDue: null,
      installment: null,
    };
  });
}

/** O nome de quem pagou, sem o prefixo do banco nem número de documento. */
export const payer = (description: string) =>
  scrubIdentifiers(counterpart(description)).slice(0, 80) || 'Entrada';

/**
 * Categorias/operações da Pluggy que nunca são renda (dinheiro próprio
 * mudando de lugar, retorno e rendimento de cofrinho).
 */
const NOT_INCOME_CATEGORIES = new Set([
  'Same person transfer',
  'Transfer - Internal',
  'Investments',
  'Automatic investment',
  'Proceeds interests and dividends',
]);
const NOT_INCOME_OPERATIONS = new Set([
  'TRANSFERENCIA_SALDO_RESERVADO',
  'RESGATE_APLIC_FINANCEIRA',
  'RENDIMENTO_APLIC_FINANCEIRA',
]);

/** Uma entrada que pode ser renda: vira lançamento na conta "Renda". */
export const isIncomeCandidate = (transaction: PluggyTransaction) =>
  transaction.type === 'CREDIT' &&
  Number.isFinite(transaction.amount) &&
  transaction.amount !== 0 &&
  !NOT_INCOME_CATEGORIES.has(transaction.category ?? '') &&
  !NOT_INCOME_OPERATIONS.has(transaction.operationType ?? '');
