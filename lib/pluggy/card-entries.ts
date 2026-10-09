// Transações de cartão da Pluggy → lançamentos do Vetra. Puro.
// - Crédito: compra é DEBIT positivo; CREDIT é pagamento de fatura (fica de
//   fora) ou estorno (receita "Estorno" que abate a fatura).
// - Lançada traz `billId`; pendente traz `billForecastDate`, cujo mês varia
//   por banco (medido em `forecastShift`).
// - Parcela lançada vem com a data da compra original: o corte é pela fatura.
// - Pendente com gêmea lançada é descartada (Nubank manda as duas).
// - Débito Itaú: só `operationType` CARTAO.
// Descrição passa por `scrubIdentifiers` e `normalizeMerchant`.
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { scrubIdentifiers } from '../ai-privacy';
import { stripEmoji } from '../financial-tracker';
import { normalizeMerchant } from '../merchant-names';
import type { PluggyTransaction } from './types';
import { saoPauloDay } from './vault-movements';
import { monthDay } from '../card-due-dates';

export type CardLinkKind = 'credit' | 'debit_purchases' | 'pix_outgoing';

export type CardEntry = {
  externalId: string;
  entryType: 'expense' | 'income';
  amount: string;
  description: string;
  occurredAt: string;
  bankStatus: 'POSTED' | 'PENDING';
  /** Fatura fechada informada pelo banco. Nulo no débito e sem fatura. */
  invoiceDue: string | null;
  installment: {
    groupId: string;
    number: number;
    total: number;
    purchaseTotal: string;
  } | null;
  /** Só nas entradas de renda (income-entries.ts): a categoria da fonte. */
  category?: string;
  /** Só renda: chega fora do "Entrou". Vale só na chegada; depois o usuário decide. */
  excluded?: boolean;
};

export const REFUND_CATEGORY = 'Estorno';

const cents = (value: number) =>
  new Decimal(Math.abs(value)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Remove o "5/8" do fim da descrição (Nubank) para não separar as parcelas. */
const INSTALLMENT_SUFFIX = /\s+\d{1,2}\s*\/\s*\d{1,2}$/;

export function cleanDescription(value: string) {
  const name = normalizeMerchant(
    stripEmoji(scrubIdentifiers(value))
      .replace(/\s+/g, ' ')
      .trim()
      .replace(INSTALLMENT_SUFFIX, ''),
  );
  return (name || 'Compra no cartão').slice(0, 160);
}

const monthIndex = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return year * 12 + monthNumber - 1;
};
const monthOf = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

/**
 * Meses a somar ao `billForecastDate` para chegar ao vencimento (Nubank 0,
 * PicPay 1). Medido nas compras com fatura fechada que ainda trazem previsão
 * (vale a diferença mais comum); sem elas, regra da primeira fatura prevista.
 */
function forecastShift(
  transactions: PluggyTransaction[],
  latestBillDue: string | null,
  billDue: Map<string, string>,
) {
  const votes = new Map<number, number>();
  for (const transaction of transactions) {
    const meta = transaction.installment;
    const due = meta?.billId ? billDue.get(meta.billId) : undefined;
    if (!due || !meta?.billForecastDate) continue;
    if (!/^\d{4}-\d{2}/.test(meta.billForecastDate)) continue;
    const shift =
      monthIndex(due.slice(0, 7)) -
      monthIndex(meta.billForecastDate.slice(0, 7));
    votes.set(shift, (votes.get(shift) ?? 0) + 1);
  }
  const calibrated = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (calibrated === 0 || calibrated === 1) return calibrated;

  const forecasts = transactions
    .filter((transaction) => !transaction.installment?.billId)
    .map((transaction) => transaction.installment?.billForecastDate)
    .filter((value): value is string => !!value && /^\d{4}-\d{2}/.test(value))
    .map((value) => monthIndex(value.slice(0, 7)));
  if (!forecasts.length || !latestBillDue) return 0;
  const shift =
    monthIndex(latestBillDue.slice(0, 7)) + 1 - Math.min(...forecasts);
  return shift === 0 || shift === 1 ? shift : 0;
}

/**
 * Id estável por compra parcelada: conta, dia, nº de parcelas e loja (sem
 * valor: a 1ª parcela pode diferir em centavos).
 */
function installmentGroupId(
  account: string,
  purchaseDay: string,
  total: number,
  description: string,
) {
  const hash = createHash('sha256')
    .update(`${account}|${purchaseDay}|${total}|${description.toLowerCase()}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// Gêmeas exigem o mesmo número de parcela.
const sameOperation = (a: PluggyTransaction, b: PluggyTransaction) =>
  a.type === b.type &&
  (a.installment?.installmentNumber ?? null) ===
    (b.installment?.installmentNumber ?? null) &&
  cents(a.amount).eq(cents(b.amount)) &&
  a.description.trim().toLowerCase() === b.description.trim().toLowerCase() &&
  Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 3 * 86_400_000;

/**
 * Pagamentos de fatura ("Credit card payment"). Chegam antes da fatura
 * publicada; a "compra a chegar" precisa saber que o limite subiu.
 */
export function cardPayments(transactions: PluggyTransaction[]) {
  const paid = transactions.filter(
    (transaction) =>
      transaction.type === 'CREDIT' &&
      transaction.category === 'Credit card payment' &&
      Number.isFinite(transaction.amount) &&
      transaction.amount !== 0,
  );
  // Pendente com gêmeo lançado sai (Nubank manda os dois).
  const posted = paid.filter((transaction) => transaction.status === 'POSTED');
  return paid
    .filter(
      (transaction) =>
        transaction.status === 'POSTED' ||
        !posted.some((other) => sameOperation(other, transaction)),
    )
    .map((transaction) => ({
      transactionId: transaction.id,
      paidOn: saoPauloDay(transaction.date),
      amount: Math.abs(transaction.amount).toFixed(2),
    }));
}

export function mapCardTransactions(
  transactions: PluggyTransaction[],
  options: {
    account: string;
    kind: CardLinkKind;
    /** billId → vencimento da fatura fechada. */
    billDue: Map<string, string>;
    /** Vencimento real da fatura de um mês (lib/card-due-dates.ts ou fatura publicada). */
    dueForMonth?: (month: string) => string | null;
  },
): CardEntry[] {
  const relevant = transactions.filter((transaction) => {
    if (!Number.isFinite(transaction.amount) || transaction.amount === 0)
      return false;
    if (options.kind === 'debit_purchases')
      return transaction.operationType === 'CARTAO';
    return transaction.category !== 'Credit card payment';
  });
  const posted = relevant.filter(
    (transaction) => transaction.status === 'POSTED',
  );
  const latestBillDue = [...options.billDue.values()].sort().at(-1) ?? null;
  const shift = forecastShift(relevant, latestBillDue, options.billDue);
  const entries = relevant.flatMap((transaction): CardEntry[] => {
    const pending = transaction.status !== 'POSTED';
    if (pending && posted.some((other) => sameOperation(other, transaction)))
      return [];
    const amount = cents(transaction.amount);
    const description = cleanDescription(transaction.description);
    const meta = transaction.installment;

    let invoiceDue: string | null = null;
    if (options.kind === 'credit') {
      if (meta?.billId) invoiceDue = options.billDue.get(meta.billId) ?? null;
      else if (meta?.billForecastDate && options.dueForMonth)
        invoiceDue = options.dueForMonth(
          monthOf(monthIndex(meta.billForecastDate.slice(0, 7)) + shift),
        );
    }

    const total = meta?.totalInstallments ?? 0;
    const number = meta?.installmentNumber ?? 0;
    const installment =
      transaction.type === 'DEBIT' &&
      total > 1 &&
      number >= 1 &&
      number <= total
        ? {
            groupId: installmentGroupId(
              options.account,
              meta?.purchaseDate
                ? saoPauloDay(meta.purchaseDate)
                : saoPauloDay(transaction.date),
              total,
              description,
            ),
            number,
            total,
            purchaseTotal: amount.times(total).toFixed(2),
          }
        : null;

    return [
      {
        externalId: transaction.id,
        entryType: transaction.type === 'CREDIT' ? 'income' : 'expense',
        amount: amount.toFixed(2),
        description,
        occurredAt: transaction.date,
        bankStatus: pending ? 'PENDING' : 'POSTED',
        invoiceDue,
        installment,
      },
    ];
  });
  sequenceInstallments(entries, options.dueForMonth);
  return entries;
}

/**
 * Fatura de cada parcela pendente pela sequência da compra, não pelo
 * `billForecastDate` (a Pluggy erra a última). Âncora: a lançada, senão a
 * pendente de menor número; cada seguinte cai um mês depois.
 */
function sequenceInstallments(
  entries: CardEntry[],
  dueForMonth?: (month: string) => string | null,
) {
  const groups = new Map<string, CardEntry[]>();
  for (const entry of entries)
    if (entry.installment)
      groups.set(entry.installment.groupId, [
        ...(groups.get(entry.installment.groupId) ?? []),
        entry,
      ]);
  for (const group of groups.values()) {
    const anchor = group
      .filter((entry) => entry.invoiceDue)
      .sort(
        (a, b) =>
          Number(a.bankStatus !== 'POSTED') -
            Number(b.bankStatus !== 'POSTED') ||
          a.installment!.number - b.installment!.number,
      )[0];
    if (!anchor?.invoiceDue) continue;
    for (const entry of group) {
      if (entry.bankStatus === 'POSTED') continue;
      const month = monthOf(
        monthIndex(anchor.invoiceDue.slice(0, 7)) +
          entry.installment!.number -
          anchor.installment!.number,
      );
      entry.invoiceDue =
        dueForMonth?.(month) ??
        monthDay(month, Number(anchor.invoiceDue.slice(8, 10)));
    }
  }
}

export type ExistingCardEntry = {
  id: string;
  external_id: string | null;
  entry_type: string;
  amount: number | string;
  occurred_at: string;
  bank_status: string | null;
  invoice_due_override: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
};

export type CardWritePlan = {
  insert: CardEntry[];
  update: { id: string; patch: Record<string, unknown> }[];
  remove: string[];
};

/** Vencimento estimado pelo ciclo do cartão, para quem ainda não tem fatura. */
export type EstimateDue = (day: string) => string | null;

/**
 * Dia que decide a virada: vencimento da fatura (do banco ou do ciclo),
 * senão a data (débito).
 */
const windowDay = (
  invoiceDue: string | null,
  occurredAt: string,
  estimate?: EstimateDue,
) => {
  const day = saoPauloDay(occurredAt);
  return invoiceDue ?? estimate?.(day) ?? day;
};

/**
 * O que gravar para uma conta: insere, atualiza valor/data/estado/fatura
 * (nunca descrição, categoria ou nota) e remove pendente que sumiu.
 * Compra apagada (`ignored`) não volta. Antes de `importFrom`, nada muda.
 */
export function planCardWrites(
  bank: CardEntry[],
  existing: ExistingCardEntry[],
  ignored: Set<string>,
  importFrom: string,
  estimate?: EstimateDue,
): CardWritePlan {
  const wanted = bank.filter(
    (entry) =>
      !ignored.has(entry.externalId) &&
      windowDay(entry.invoiceDue, entry.occurredAt, estimate) >= importFrom,
  );
  const byExternal = new Map(
    existing
      .filter((row) => row.external_id)
      .map((row) => [row.external_id!, row]),
  );
  // Duas parceladas idênticas no mesmo dia: a segunda perde o grupo.
  const takenInstallments = new Set(
    existing
      .filter((row) => row.installment_group_id)
      .map((row) => `${row.installment_group_id}|${row.installment_number}`),
  );
  const plan: CardWritePlan = { insert: [], update: [], remove: [] };
  const seen = new Set<string>();
  for (const entry of wanted) {
    seen.add(entry.externalId);
    const current = byExternal.get(entry.externalId);
    const installmentKey = entry.installment
      ? `${entry.installment.groupId}|${entry.installment.number}`
      : null;
    if (!current) {
      const installment =
        installmentKey && takenInstallments.has(installmentKey)
          ? null
          : entry.installment;
      if (installmentKey && installment) takenInstallments.add(installmentKey);
      plan.insert.push({ ...entry, installment });
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (current.entry_type !== entry.entryType)
      patch.entry_type = entry.entryType;
    if (!new Decimal(current.amount).eq(entry.amount))
      patch.amount = entry.amount;
    if (Date.parse(current.occurred_at) !== Date.parse(entry.occurredAt))
      patch.occurred_at = entry.occurredAt;
    if (current.bank_status !== entry.bankStatus)
      patch.bank_status = entry.bankStatus;
    if ((current.invoice_due_override ?? null) !== entry.invoiceDue)
      patch.invoice_due_override = entry.invoiceDue;
    if (
      entry.installment &&
      current.installment_group_id !== entry.installment.groupId &&
      !takenInstallments.has(installmentKey!)
    ) {
      takenInstallments.add(installmentKey!);
      patch.installment_group_id = entry.installment.groupId;
      patch.installment_number = entry.installment.number;
      patch.installment_total = entry.installment.total;
      patch.installment_purchase_total = entry.installment.purchaseTotal;
    }
    if (Object.keys(patch).length) plan.update.push({ id: current.id, patch });
  }
  // Só pendente sai; lançada que some da API fica.
  for (const row of existing)
    if (
      row.external_id &&
      row.bank_status === 'PENDING' &&
      !seen.has(row.external_id) &&
      windowDay(row.invoice_due_override, row.occurred_at, estimate) >=
        importFrom
    )
      plan.remove.push(row.id);
  return plan;
}
