// Pix das contas correntes → conta "Pix" do Vetra. Puro. Regras:
// - só Pix que sai;
// - fora: transferência entre contas próprias ("Same person transfer"),
//   pagamento de fatura e "Pix devolvido";
// - Pix que volta anula: saída e entrada de mesmo valor e mesma pessoa em até
//   60 dias somem os dois (cancelamentos, empréstimos devolvidos).
// A descrição vira o nome de quem recebeu (motor de nomes do cartão).
import Decimal from 'decimal.js';
import { cleanDescription, type CardEntry } from './card-entries';
import type { PluggyTransaction } from './types';

const RETURN_WINDOW_DAYS = 60;
const OWN_OR_BILL = new Set(['Same person transfer', 'Credit card payment']);

/** O que os bancos escrevem antes do nome de quem pagou ou recebeu. */
const PREFIXES = [
  /^pagamento com c[oó]digo qr pix\s*-\s*cancelado\s+/i,
  /^pagamento com qr pix\s+/i,
  /^pagamento de pix qr code\s+/i,
  /^pix (enviado|recebido|devolvido)\s+/i,
  /^transfer[eê]ncia (enviada|recebida)\s*\|\s*/i,
];

export const isPix = (transaction: PluggyTransaction) =>
  transaction.operationType === 'PIX' ||
  /\bpix\b/i.test(transaction.description);

/** Contraparte sem prefixo, acento e caixa, para casar saída e volta. */
export function counterpart(description: string) {
  let name = description.replace(/\s+/g, ' ').trim();
  for (const prefix of PREFIXES) name = name.replace(prefix, '');
  return name.replace(/\s+com saldo$/i, '').trim();
}

const key = (description: string) =>
  counterpart(description)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');

const cents = (value: number) =>
  new Decimal(Math.abs(value)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function mapPixTransactions(
  transactions: PluggyTransaction[],
): CardEntry[] {
  const pix = transactions.filter(
    (transaction) =>
      isPix(transaction) &&
      Number.isFinite(transaction.amount) &&
      transaction.amount !== 0,
  );
  const incoming = pix.filter(
    (transaction) =>
      transaction.type === 'CREDIT' &&
      !OWN_OR_BILL.has(transaction.category ?? ''),
  );
  const used = new Set<string>();
  const outgoing = pix.filter(
    (transaction) =>
      transaction.type === 'DEBIT' &&
      !OWN_OR_BILL.has(transaction.category ?? '') &&
      !/^pix devolvido\b/i.test(transaction.description.trim()),
  );
  const returns = (transaction: PluggyTransaction, other: PluggyTransaction) =>
    !used.has(other.id) &&
    cents(other.amount).eq(cents(transaction.amount)) &&
    key(other.description) === key(transaction.description) &&
    Math.abs(Date.parse(other.date) - Date.parse(transaction.date)) <=
      RETURN_WINDOW_DAYS * 86_400_000;
  // Duas passadas: mesma conta primeiro, depois entre contas (o cancelamento
  // volta para a conta de origem; parear por ordem sumia a compra real).
  const annulled = new Set<string>();
  for (const sameAccount of [true, false])
    for (const transaction of outgoing) {
      if (annulled.has(transaction.id)) continue;
      const back = incoming.find(
        (other) =>
          (!sameAccount || other.accountId === transaction.accountId) &&
          returns(transaction, other),
      );
      if (!back) continue;
      used.add(back.id);
      annulled.add(transaction.id);
    }
  return outgoing
    .filter((transaction) => !annulled.has(transaction.id))
    .map((transaction): CardEntry => ({
      externalId: transaction.id,
      entryType: 'expense',
      amount: cents(transaction.amount).toFixed(2),
      description: cleanDescription(counterpart(transaction.description)),
      occurredAt: transaction.date,
      bankStatus: transaction.status === 'POSTED' ? 'POSTED' : 'PENDING',
      invoiceDue: null,
      installment: null,
    }));
}
