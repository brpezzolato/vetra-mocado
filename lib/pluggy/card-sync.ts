// Cartões pela Pluggy: para cada conta em `pluggy_card_links`, grava compras
// (`financial_entries`, source 'pluggy'), faturas fechadas (`card_bills`),
// limite e ciclo real (`card_cycles`).
// Categoria nunca vem do banco: `merchant_rules`, herança da virada, IA (com
// teto por rodada) ou "Outros".
// Só no servidor, com service role. Nunca loga corpo de resposta nem id.
import type { SupabaseClient } from '@supabase/supabase-js';
import { categorizeExpenseWithAI } from '../ai-categorizer';
import { invoiceFor, type CardCycle } from '../expense-insights';
import { dueDateFor, inferDueRule, monthDay } from '../card-due-dates';
import type { PluggyClient } from './client';
import {
  cardPayments,
  mapCardTransactions,
  planCardWrites,
  REFUND_CATEGORY,
  type CardEntry,
  type CardLinkKind,
  type EstimateDue,
  type ExistingCardEntry,
} from './card-entries';
import { matchMerchantAlias, type MerchantAlias } from '../merchant-aliases';
import { mapPixTransactions } from './pix-entries';
import {
  INCOME_ACCOUNT,
  mapIncomeTransactions,
  type IncomeSource,
} from './income-entries';
import { discoverCreditCards } from './card-discovery';
import { syncCheckingBillPayments } from './bill-payments';
import type { PluggyBill, PluggyTransaction } from './types';
import { saoPauloDay } from './vault-movements';

export type CardSyncResult = {
  cards: number;
  inserted: number;
  /** Soma das saídas e das entradas novas desta rodada, para o resumo. */
  spent: number;
  earned: number;
  updated: number;
  removed: number;
  bills: number;
  errors: number;
  /** Cartões de crédito novos que esta rodada achou e ligou. */
  discovered?: number;
};

type CardLink = {
  user_id: string;
  account: string;
  pluggy_item_id: string;
  pluggy_account_id: string;
  kind: CardLinkKind;
  import_from: string;
};

export type CardSyncOptions = {
  userId?: string;
  /** Categoria de um lançamento antigo igual, usada só na virada. */
  inherit?: (account: string, entry: CardEntry) => string | null;
  /** Quantas compras novas podem ir para a IA nesta rodada. */
  aiLimit?: number;
};

const DAY = 86_400_000;

export async function syncCardsFromPluggy(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  options: CardSyncOptions = {},
): Promise<CardSyncResult> {
  const result: CardSyncResult = {
    cards: 0,
    inserted: 0,
    spent: 0,
    earned: 0,
    updated: 0,
    removed: 0,
    bills: 0,
    errors: 0,
    discovered: 0,
  };
  // Primeiro, descobre cartão de crédito novo (card-discovery.ts).
  result.discovered = await discoverCreditCards(
    admin,
    pluggy,
    options.userId,
  ).catch(() => 0);
  let query = admin
    .from('pluggy_card_links')
    .select(
      'user_id, account, pluggy_item_id, pluggy_account_id, kind, import_from',
    );
  if (options.userId) query = query.eq('user_id', options.userId);
  const { data, error } = await query;
  if (error) throw new Error('Não foi possível ler os cartões.');
  const links = (data ?? []) as CardLink[];
  result.cards = links.length;
  let aiBudget = options.aiLimit ?? 15;
  // Hora dos dados de cada conexão (`lastUpdatedAt`) para a foto do limite.
  // Uma consulta por item, só se houver foto.
  const dataTime = new Map<string, Promise<string | null>>();
  const dataAt = (itemId: string) => {
    if (!dataTime.has(itemId))
      dataTime.set(
        itemId,
        pluggy
          .getItem(itemId)
          .then((item) => item.lastUpdatedAt)
          .catch(() => null),
      );
    return dataTime.get(itemId)!;
  };

  /** Grava os lançamentos de uma conta pelo plano, com a categoria do app. */
  async function writeEntries(
    target: Pick<CardLink, 'user_id' | 'account' | 'import_from'>,
    bankEntries: CardEntry[],
    estimate?: EstimateDue,
  ) {
    const [
      { data: existingRows, error: existingError },
      { data: ignoredRows },
    ] = await Promise.all([
      admin
        .from('financial_entries')
        .select(
          'id, external_id, entry_type, amount, occurred_at, bank_status, invoice_due_override, installment_group_id, installment_number',
        )
        .eq('user_id', target.user_id)
        .eq('account', target.account)
        .eq('source', 'pluggy'),
      admin
        .from('pluggy_ignored_transactions')
        .select('transaction_id')
        .eq('user_id', target.user_id),
    ]);
    if (existingError) throw existingError;
    const plan = planCardWrites(
      bankEntries,
      (existingRows ?? []) as ExistingCardEntry[],
      new Set((ignoredRows ?? []).map((row) => row.transaction_id as string)),
      target.import_from,
      estimate,
    );

    if (plan.insert.length) {
      const [{ data: rules }, { data: aliasRows }] = await Promise.all([
        admin
          .from('merchant_rules')
          .select('merchant, category')
          .eq('user_id', target.user_id),
        admin
          .from('merchant_aliases')
          .select('id, match, pattern, name, category')
          .eq('user_id', target.user_id),
      ]);
      const learned = new Map(
        (rules ?? []).map((rule) => [
          String(rule.merchant).toLocaleLowerCase('pt-BR'),
          String(rule.category),
        ]),
      );
      const aliases = (aliasRows ?? []) as MerchantAlias[];
      const rows = [];
      for (const bankEntry of plan.insert) {
        // Regras de nome do usuário antes da categoria e da IA.
        const alias =
          bankEntry.entryType === 'expense'
            ? matchMerchantAlias(bankEntry.description, aliases)
            : null;
        const entry = alias
          ? { ...bankEntry, description: alias.name }
          : bankEntry;
        let category =
          entry.entryType === 'income'
            ? (entry.category ?? REFUND_CATEGORY)
            : (alias?.category ??
              learned.get(entry.description.toLocaleLowerCase('pt-BR')) ??
              options.inherit?.(target.account, entry) ??
              null);
        if (!category && aiBudget > 0) {
          aiBudget--;
          category = await categorizeExpenseWithAI({
            description: entry.description,
            account: target.account,
          }).catch(() => null);
        }
        rows.push({
          user_id: target.user_id,
          entry_type: entry.entryType,
          amount: entry.amount,
          description: entry.description,
          category: category ?? 'Outros',
          account: target.account,
          occurred_at: entry.occurredAt,
          source: 'pluggy',
          external_id: entry.externalId,
          bank_status: entry.bankStatus,
          invoice_due_override: entry.invoiceDue,
          installment_group_id: entry.installment?.groupId ?? null,
          installment_number: entry.installment?.number ?? null,
          installment_total: entry.installment?.total ?? null,
          installment_purchase_total: entry.installment?.purchaseTotal ?? null,
          ...(entry.excluded !== undefined && {
            excluded_from_totals: entry.excluded,
          }),
        });
      }
      const { error: insertError } = await admin
        .from('financial_entries')
        .insert(rows);
      if (insertError) throw insertError;
      result.inserted += rows.length;
      for (const row of rows) {
        if (row.entry_type === 'income') result.earned += Number(row.amount);
        else result.spent += Number(row.amount);
      }
    }
    for (const { id, patch } of plan.update) {
      const { error: updateError } = await admin
        .from('financial_entries')
        .update(patch)
        .eq('id', id);
      if (updateError) throw updateError;
      result.updated++;
    }
    if (plan.remove.length) {
      const { error: removeError } = await admin
        .from('financial_entries')
        .delete()
        .in('id', plan.remove);
      if (removeError) throw removeError;
      result.removed += plan.remove.length;
    }
    await admin
      .from('pluggy_card_links')
      .update({ synced_at: new Date().toISOString() })
      .eq('user_id', target.user_id)
      .eq('account', target.account);
  }

  // Todas as correntes alimentam a conta "Pix" juntas (o Pix pode voltar por
  // outro banco).
  const pixGroups = new Map<string, CardLink[]>();
  for (const link of links.filter((item) => item.kind === 'pix_outgoing')) {
    const key = `${link.user_id}|${link.account}`;
    pixGroups.set(key, [...(pixGroups.get(key) ?? []), link]);
  }
  for (const group of pixGroups.values()) {
    try {
      const today = saoPauloDay(new Date().toISOString());
      const transactions: PluggyTransaction[] = [];
      for (const link of group)
        transactions.push(
          ...(await pluggy.listTransactions(
            link.pluggy_account_id,
            link.import_from,
            today,
          )),
        );
      const importFrom = group.map((link) => link.import_from).sort()[0];
      await writeEntries(
        {
          user_id: group[0].user_id,
          account: group[0].account,
          import_from: importFrom,
        },
        mapPixTransactions(transactions),
      );
      // Entradas das mesmas contas viram "Renda" (income-entries.ts). Só as que
      // casam com uma fonte contam no "Entrou". Sem ler as fontes, não grava.
      const { data: sources, error: sourcesError } = await admin
        .from('income_sources')
        .select('match, pattern, label, category')
        .eq('user_id', group[0].user_id);
      if (sourcesError) throw sourcesError;
      await writeEntries(
        {
          user_id: group[0].user_id,
          account: INCOME_ACCOUNT,
          import_from: importFrom,
        },
        mapIncomeTransactions(transactions, (sources ?? []) as IncomeSource[]),
      );
    } catch {
      result.errors++;
    }
  }

  for (const link of links.filter((item) => item.kind !== 'pix_outgoing')) {
    try {
      const today = saoPauloDay(new Date().toISOString());
      let billDue = new Map<string, string>();
      let estimate: EstimateDue | undefined;
      let dueForMonth: ((month: string) => string | null) | undefined;

      if (link.kind === 'credit') {
        const accounts = await pluggy.listAccounts(link.pluggy_item_id);
        const account = accounts.find(
          (item) => item.id === link.pluggy_account_id,
        );
        const bills = await pluggy.listBills(link.pluggy_account_id);
        billDue = new Map(
          bills.map((bill) => [bill.id, bill.dueDate.slice(0, 10)]),
        );
        await saveBills(admin, link, bills);
        result.bills += bills.length;
        const cycle = await saveCycle(admin, link, bills);
        if (cycle) {
          estimate = (day) => invoiceFor(day, cycle).due;
          // Vencimento de cada fatura: o publicado ou o da regra do cartão.
          const published = new Map(
            bills.map((bill) => [
              bill.dueDate.slice(0, 7),
              bill.dueDate.slice(0, 10),
            ]),
          );
          const rule = {
            day: cycle.due_day,
            rollsForward: !!cycle.due_rolls_forward,
          };
          dueForMonth = (month) =>
            published.get(month) ?? dueDateFor(month, rule);
        }
        await admin
          .from('pluggy_card_links')
          .update({
            credit_limit: account?.creditLimit ?? null,
            available_limit: account?.availableCreditLimit ?? null,
          })
          .eq('user_id', link.user_id)
          .eq('account', link.account);
        // Foto do limite desta rodada (lib/unidentified-spend.ts).
        if (
          account?.creditLimit != null &&
          account.availableCreditLimit != null
        )
          await admin.from('card_limit_snapshots').insert({
            user_id: link.user_id,
            account: link.account,
            credit_limit: account.creditLimit,
            available: account.availableCreditLimit,
            data_at: await dataAt(link.pluggy_item_id),
          });
      }

      // Crédito: um ano para frente (parcelas) e para trás (parcela lançada vem
      // com a data da compra). O corte é feito depois, pela fatura.
      const credit = link.kind === 'credit';
      const from = credit
        ? new Date(Date.parse(`${link.import_from}T00:00:00Z`) - 400 * DAY)
            .toISOString()
            .slice(0, 10)
        : link.import_from;
      const until = credit
        ? new Date(Date.now() + 400 * DAY).toISOString().slice(0, 10)
        : today;
      const transactions = await pluggy.listTransactions(
        link.pluggy_account_id,
        from,
        until,
      );
      const bankEntries = mapCardTransactions(transactions, {
        account: link.account,
        kind: link.kind,
        billDue,
        dueForMonth,
      });
      // Pagamentos de fatura já visíveis (`cardPayments`), para a compra a chegar
      // não os confundir.
      if (credit) {
        const paid = cardPayments(transactions);
        if (paid.length)
          await admin.from('card_payment_events').upsert(
            paid.map((payment) => ({
              user_id: link.user_id,
              account: link.account,
              transaction_id: payment.transactionId,
              paid_on: payment.paidOn,
              amount: payment.amount,
            })),
            { onConflict: 'user_id,transaction_id' },
          );
      }

      await writeEntries(link, bankEntries, estimate);
    } catch {
      // Um cartão com erro não impede os outros; o motivo não é repassado (pode
      // conter dados).
      result.errors++;
    }
  }
  // Pagamento de fatura que só aparece na corrente (Itaú), depois das fotos
  // do limite desta rodada.
  await syncCheckingBillPayments(admin, pluggy, links).catch(() => {
    result.errors++;
  });
  return result;
}

async function saveBills(
  admin: SupabaseClient,
  link: CardLink,
  bills: PluggyBill[],
) {
  if (!bills.length) return;
  const { error } = await admin.from('card_bills').upsert(
    bills.map((bill) => ({
      user_id: link.user_id,
      account: link.account,
      pluggy_bill_id: bill.id,
      closing_date: bill.closingDate?.slice(0, 10) ?? null,
      due_date: bill.dueDate.slice(0, 10),
      total: bill.total.toFixed(2),
      minimum: bill.minimum === null ? null : bill.minimum.toFixed(2),
      paid: bill.paid.toFixed(2),
      payments: bill.payments,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'user_id,pluggy_bill_id' },
  );
  if (error) throw error;
}

/**
 * Ciclo real pela fatura mais recente: dia de vencimento e dias até o
 * fechamento. Devolve o ciclo gravado.
 */
async function saveCycle(
  admin: SupabaseClient,
  link: CardLink,
  bills: PluggyBill[],
) {
  const latest = [...bills]
    .filter((bill) => bill.closingDate)
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
  if (!latest?.closingDate) return null;
  // Dia contratado e se o banco empurra para dia útil; o fechamento conta do
  // dia contratado.
  const rule = inferDueRule(bills.map((bill) => bill.dueDate.slice(0, 10)));
  const due = latest.dueDate.slice(0, 10);
  const closing = latest.closingDate.slice(0, 10);
  const dueDay = rule?.day ?? Number(due.slice(8, 10));
  const nominal = monthDay(due.slice(0, 7), dueDay);
  const offset = Math.round(
    (Date.parse(`${nominal}T00:00:00Z`) - Date.parse(`${closing}T00:00:00Z`)) /
      DAY,
  );
  const cycle: CardCycle = {
    account: link.account,
    kind: 'credit',
    due_day: dueDay,
    closing_day: Number(closing.slice(8, 10)),
    closing_offset_days: offset >= 1 && offset <= 15 ? offset : null,
    due_rolls_forward: rule?.rollsForward ?? false,
  };
  const { error } = await admin
    .from('card_cycles')
    .upsert(
      { user_id: link.user_id, ...cycle },
      { onConflict: 'user_id,account' },
    );
  if (error) throw error;
  return cycle;
}
