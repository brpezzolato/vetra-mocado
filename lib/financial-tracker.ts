import Decimal from 'decimal.js';
// Import de tipo no sentido contrário: sem ciclo em runtime.
import { FLASH_ACCOUNT, suggestFlashCategory } from './flash-statement';
import { normalizeMerchant } from './merchant-names';

export type FinancialEntryType = 'income' | 'expense';

export type FinancialEntry = {
  id: string;
  user_id: string;
  entry_type: FinancialEntryType;
  amount: number | string;
  description: string;
  category: string;
  notes?: string;
  installment_group_id?: string | null;
  installment_number?: number | null;
  installment_total?: number | null;
  installment_purchase_total?: number | string | null;
  invoice_due_override?: string | null;
  account: string;
  occurred_at: string;
  source: 'manual' | 'apple_shortcuts' | 'benefit_statement' | 'pluggy';
  external_id: string | null;
  /** Só lançamentos do banco: PENDING (fatura aberta, parcela futura) ou POSTED. */
  bank_status?: 'POSTED' | 'PENDING' | null;
  /** Fora das contas: continua na fatura e na lista, sai de todo o resto. */
  excluded_from_totals?: boolean;
  /** Não conta no valor do dia (presente, gasto extraordinário). */
  excluded_from_daily?: boolean;
  /** Compra dividida: a parte do usuário (`amount` é o valor cheio). Ver lib/entry-share.ts. */
  split_share?: number | string | null;
  /** Dividida por igual entre tantas pessoas, ele incluído. */
  split_people?: number | null;
  /**
   * Só na leitura "dos gastos": `amount` já é a parte do usuário e o valor
   * cheio fica aqui. Nunca é gravado.
   */
  full_amount?: number | string;
  created_at: string;
  updated_at: string;
};

/**
 * Remove emoji do nome vindo do Atalho (a lista dele usa emoji); senão
 * `merchant_rules`, que compara texto exato, separaria "🚙 Uber" de "Uber".
 * Sem `Emoji_Component`: ele inclui 0–9, # e *.
 */
const EMOJI =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}️‍]/gu;

export function stripEmoji(value: string) {
  const cleaned = value.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
  // Nome só de emoji fica como está: melhor que rejeitar o lançamento.
  return cleaned || value.trim();
}

/**
 * Nomes de cartão do Atalho → nomes do app. "Benefits Virtual Card" vira
 * "Flash" (como o import do extrato), senão a mesma compra conta duas vezes.
 * Chave em minúsculas.
 */
const ACCOUNT_ALIASES = new Map([
  ['benefits virtual card', 'Flash'],
  // Cartão físico da Flash: só alimentação (ver FOOD_ONLY_CARDS).
  ['card used for meal and voucher', 'Flash'],
]);

/** Cartões da Flash só de alimentação: tudo vira `Alimentação`. */
const FOOD_ONLY_CARDS = new Set(['card used for meal and voucher']);

export function resolveAccountAlias(value: string) {
  const trimmed = value.trim();
  return ACCOUNT_ALIASES.get(trimmed.toLowerCase()) ?? trimmed;
}

export type ShortcutToken = {
  id: string;
  name: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export function parseShortcutEntry(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Envie um objeto JSON.');
  const body = input as Record<string, unknown>;
  const typeInput = body.tipo ?? body.type;
  if (typeof typeInput !== 'string')
    throw new Error('Tipo deve ser despesa ou receita.');
  const rawType = typeInput.trim().toLowerCase();
  const entryType: FinancialEntryType | undefined =
    rawType === 'despesa' || rawType === 'expense'
      ? 'expense'
      : rawType === 'receita' || rawType === 'income'
        ? 'income'
        : undefined;
  if (!entryType) throw new Error('Tipo deve ser despesa ou receita.');

  const amountInput = body.valor ?? body.amount;
  if (typeof amountInput !== 'string' && typeof amountInput !== 'number')
    throw new Error('Valor monetário inválido.');
  const rawAmount = String(amountInput)
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '');
  if (
    !/^(?:\d+(?:\.\d{1,2})?|\d+(?:,\d{1,2})?|\d{1,3}(?:\.\d{3})+,\d{1,2})$/.test(
      rawAmount,
    )
  )
    throw new Error('Valor monetário inválido.');
  const normalizedAmount = rawAmount.includes(',')
    ? rawAmount.replace(/\./g, '').replace(',', '.')
    : rawAmount;
  let amount: Decimal;
  try {
    amount = new Decimal(normalizedAmount || 0);
  } catch {
    throw new Error('Valor monetário inválido.');
  }
  if (
    !amount.isFinite() ||
    amount.lte(0) ||
    amount.gt('99999999999999.99') ||
    amount.decimalPlaces() > 2
  )
    throw new Error('Valor monetário inválido.');

  const text = (key: string, fallbackKey: string, fallback = '') => {
    const value = body[key] ?? body[fallbackKey] ?? fallback;
    if (typeof value !== 'string') throw new Error(`Campo ${key} inválido.`);
    return value.trim();
  };
  // Compra recebe o nome único do lugar (lib/merchant-names.ts); receita fica
  // como digitada.
  const typed = stripEmoji(text('descricao', 'description'));
  const description =
    entryType === 'expense' ? normalizeMerchant(typed) : typed;
  const rawAccount = text('conta', 'account', 'Não informada');
  const account = resolveAccountAlias(rawAccount);
  const foodOnly = FOOD_ONLY_CARDS.has(rawAccount.toLowerCase());
  // No Flash, a categoria é a carteira e vem da loja, não do Atalho. Só em
  // gastos: depósito não tem loja.
  const declaredCategory = text('categoria', 'category', 'Outros');
  const category =
    account === FLASH_ACCOUNT && entryType === 'expense'
      ? foodOnly
        ? 'Alimentação'
        : suggestFlashCategory(description)
      : declaredCategory;
  if (!description || description.length > 160)
    throw new Error('Descrição inválida.');
  if (!category || category.length > 80) throw new Error('Categoria inválida.');
  if (!account || account.length > 80) throw new Error('Conta inválida.');

  const rawDate = body.data ?? body.occurred_at;
  if (
    rawDate !== undefined &&
    rawDate !== null &&
    (typeof rawDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        rawDate,
      ))
  )
    throw new Error('Data deve incluir horário e fuso (ISO 8601).');
  const occurredAt = rawDate ? new Date(String(rawDate)) : new Date();
  if (!Number.isFinite(occurredAt.getTime())) throw new Error('Data inválida.');
  if (typeof rawDate === 'string') {
    const day = rawDate.slice(0, 10);
    if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
      throw new Error('Data inválida.');
  }
  const externalId = text('id_externo', 'external_id') || null;
  if (externalId && externalId.length > 160)
    throw new Error('Identificador externo inválido.');
  return {
    entryType,
    amount: amount.toFixed(2),
    description,
    category,
    account,
    occurredAt: rawDate ? occurredAt.toISOString() : null,
    externalId,
  };
}
