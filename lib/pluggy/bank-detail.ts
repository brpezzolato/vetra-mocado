// Página de um banco (/bancos/[banco]): saldo, extrato e atualização da conta
// corrente, mais cartão e cofrinhos da mesma conexão.
// Lido na hora da Pluggy, sem guardar. Só campos escolhidos: nada de
// /identity, número de conta, titular ou dados de pagamento; dígitos longos
// nas descrições viram "[número oculto]".
import type { SupabaseClient } from '@supabase/supabase-js';
import { scrubIdentifiers } from '@/lib/ai-privacy';
import { buildCreditCardInvoices } from '@/lib/card-invoices';
import { loadCardInvoiceInputs } from '@/lib/card-invoices-query';
import type { PluggyClient } from './client';
import type { AccountBalance } from './account-balances';

export type BankKey = AccountBalance['bank'];

export const BANK_KEYS: readonly BankKey[] = [
  'nubank',
  'itau',
  'picpay',
  'mercado-pago',
];

export type BankTransaction = {
  id: string;
  /** yyyy-mm-dd, no fuso de São Paulo. */
  date: string;
  /** Instante como o banco mandou (às vezes só a data), para achar repasses. */
  at: string | null;
  /** Positivo entra, negativo sai. */
  amount: number;
  description: string;
  /** Pix, TED, boleto, cartão… (rótulo pronto) ou null. */
  kind: string | null;
  /** A categoria da Pluggy, em português. */
  category: string | null;
  pending: boolean;
  /**
   * Para o resumo contar só o que é de verdade:
   *   external — de ou para terceiros;
   *   internal — entre contas próprias, cofrinho, aplicação e resgate;
   *   yield    — rendimento e juros do banco.
   */
  flow: 'external' | 'internal' | 'yield';
};

export type BankDetail = {
  bank: BankKey;
  balance: number;
  /** Quando o banco atualizou os dados por último (Pluggy). */
  updatedAt: string | null;
  /** A conexão está ok, atualizando ou com erro. */
  status: 'ok' | 'updating' | 'error';
  days: number;
  transactions: BankTransaction[];
  card: {
    limit: number | null;
    available: number | null;
    /** Fatura da vez: o valor que falta pagar. */
    bill: { dueDate: string; total: number; closingDate: string | null } | null;
  } | null;
  vaults: { count: number; total: number };
};

/** Categorias da Pluggy mais comuns em português; as outras saem como vieram. */
const CATEGORIES: Record<string, string> = {
  Income: 'Receitas',
  Salary: 'Salário',
  Retirement: 'Aposentadoria',
  'Entrepreneurial activities': 'Renda própria',
  'Government aid': 'Benefícios',
  'Non-recurring income': 'Receita avulsa',
  Loans: 'Empréstimos',
  Investments: 'Investimentos',
  'Automatic investment': 'Investimentos',
  'Fixed income': 'Renda fixa',
  'Proceeds interests and dividends': 'Rendimentos',
  'Interests and dividends': 'Rendimentos',
  'Transfer - Internal': 'Entre suas contas',
  'Same person transfer': 'Entre suas contas',
  'Same person transfer - PIX': 'Entre suas contas',
  Transfers: 'Transferências',
  'Transfer - PIX': 'Pix',
  'Transfer - TED': 'TED',
  'Transfer - Bank slip': 'Boleto',
  'Credit card payment': 'Fatura do cartão',
  Shopping: 'Compras',
  'Online shopping': 'Compras online',
  Groceries: 'Mercado',
  'Food and drinks': 'Alimentação',
  'Eating out': 'Restaurantes',
  'Food delivery': 'Delivery',
  Transportation: 'Transporte',
  'Taxi and ride-hailing': 'Táxi e apps',
  'Gas stations': 'Combustível',
  'Public transportation': 'Transporte público',
  Parking: 'Estacionamento',
  Housing: 'Moradia',
  Rent: 'Aluguel',
  Utilities: 'Contas da casa',
  Electricity: 'Luz',
  Water: 'Água',
  Internet: 'Internet',
  Telecommunications: 'Telefone e internet',
  Health: 'Saúde',
  Pharmacy: 'Farmácia',
  Education: 'Educação',
  Entertainment: 'Lazer',
  Leisure: 'Lazer',
  'Video streaming': 'Streaming',
  'Music streaming': 'Streaming',
  'Digital services': 'Serviços digitais',
  Services: 'Serviços',
  Travel: 'Viagem',
  Taxes: 'Impostos',
  'Bank fees': 'Tarifas',
  Insurance: 'Seguros',
  Donations: 'Doações',
  Gambling: 'Apostas',
  Pets: 'Pets',
};

/** O tipo de operação, pela descrição ou pelo `operationType`. */
function kindOf(description: string, operationType: string | null) {
  const text = `${operationType ?? ''} ${description}`.toLowerCase();
  if (/\bpix\b/.test(text)) return 'Pix';
  if (/\bted\b|\bdoc\b/.test(text)) return 'TED';
  if (/boleto|bank slip/.test(text)) return 'Boleto';
  if (/d[eé]bito|debit card|compra no/.test(text)) return 'Débito';
  if (/saldo_reservado|reserva|cofrinho|caixinha/.test(text)) return 'Reserva';
  if (/fatura|credit card payment/.test(text)) return 'Fatura';
  if (/rendimento|juros|remunera/.test(text)) return 'Rendimento';
  if (/tarifa|anuidade/.test(text)) return 'Tarifa';
  return null;
}

/** Categorias da Pluggy que são dinheiro próprio mudando de lugar. */
const INTERNAL_CATEGORIES = new Set([
  'Same person transfer',
  'Same person transfer - PIX',
  'Transfer - Internal',
  'Investments',
  'Automatic investment',
  'Fixed income',
  'Variable income',
  'Investment redemption',
]);
const YIELD_CATEGORIES = new Set([
  'Proceeds interests and dividends',
  'Interests and dividends',
]);

function flowOf(
  category: string | null,
  kind: string | null,
): BankTransaction['flow'] {
  if (kind === 'Rendimento' || (category && YIELD_CATEGORIES.has(category)))
    return 'yield';
  if (kind === 'Reserva' || (category && INTERNAL_CATEGORIES.has(category)))
    return 'internal';
  return 'external';
}

const dayInSaoPaulo = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));

/** Os itens (conexões da Pluggy) do usuário, como em account-balances. */
async function userItems(admin: SupabaseClient, userId: string) {
  const [links, piggies] = await Promise.all([
    admin
      .from('pluggy_card_links')
      .select('pluggy_item_id')
      .eq('user_id', userId),
    admin
      .from('piggy_banks')
      .select('pluggy_item_id')
      .eq('user_id', userId)
      .not('pluggy_item_id', 'is', null),
  ]);
  return [
    ...new Set(
      [...(links.data ?? []), ...(piggies.data ?? [])].map(
        (row) => row.pluggy_item_id as string,
      ),
    ),
  ];
}

/** Cofrinhos ativos da conexão e o último saldo líquido somado. */
async function vaultTotal(
  admin: SupabaseClient,
  userId: string,
  itemId: string,
) {
  const { data: piggies } = await admin
    .from('piggy_banks')
    .select('id')
    .eq('user_id', userId)
    .eq('pluggy_item_id', itemId)
    .is('archived_at', null);
  const ids = (piggies ?? []).map((row) => row.id as string);
  if (!ids.length) return { count: 0, total: 0 };
  const { data: snapshots } = await admin
    .from('balance_snapshots')
    .select('piggy_bank_id, net_balance, snapshot_date')
    .in('piggy_bank_id', ids)
    .order('snapshot_date', { ascending: false });
  const latest = new Map<string, number>();
  for (const row of snapshots ?? [])
    if (!latest.has(row.piggy_bank_id as string))
      latest.set(row.piggy_bank_id as string, Number(row.net_balance));
  return {
    count: ids.length,
    total: [...latest.values()].reduce((sum, value) => sum + value, 0),
  };
}

/** Fatura da vez pela mesma conta da tela de Faturas (`buildCreditCardInvoices`). */
async function currentBill(
  admin: SupabaseClient,
  userId: string,
  pluggyAccountId: string,
) {
  const { data: link } = await admin
    .from('pluggy_card_links')
    .select('account')
    .eq('user_id', userId)
    .eq('pluggy_account_id', pluggyAccountId)
    .eq('kind', 'credit')
    .maybeSingle();
  if (!link) return null;
  const { data } = await loadCardInvoiceInputs(admin, {
    userId,
    accounts: [link.account as string],
  });
  if (!data) return null;
  const [card] = buildCreditCardInvoices(
    data.entries,
    data.cards,
    data.cycles,
    undefined,
    data.payments,
    data.bills,
    data.limits,
  );
  if (!card) return null;
  return {
    dueDate: card.current.due,
    total: Number(card.current.balance),
    closingDate: card.current.closing,
  };
}

export async function loadBankDetail(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  userId: string,
  bank: BankKey,
  days: number,
): Promise<BankDetail | null> {
  const items = await userItems(admin, userId);
  const lists = await Promise.all(
    items.map((itemId) =>
      pluggy
        .listAccounts(itemId)
        .then((accounts) => ({ itemId, accounts }))
        .catch(() => ({ itemId, accounts: [] })),
    ),
  );
  const found = lists.find(({ accounts }) =>
    accounts.some(
      (account) => account.type === 'BANK' && account.bank === bank,
    ),
  );
  if (!found) return null;
  const account = found.accounts.find(
    (entry) => entry.type === 'BANK' && entry.bank === bank,
  )!;
  const credit = found.accounts.find((entry) => entry.type === 'CREDIT');

  const to = dayInSaoPaulo(new Date().toISOString());
  const from = dayInSaoPaulo(
    new Date(Date.now() - days * 86_400_000).toISOString(),
  );
  const [item, transactions, bill, vaults] = await Promise.all([
    pluggy.getItem(found.itemId).catch(() => null),
    pluggy.listTransactions(account.id, from, to).catch(() => []),
    credit ? currentBill(admin, userId, credit.id) : Promise.resolve(null),
    vaultTotal(admin, userId, found.itemId),
  ]);

  const status = item
    ? /UPDATING|WAITING/.test(item.status)
      ? 'updating'
      : /ERROR|OUTDATED|LOGIN/.test(item.status)
        ? 'error'
        : 'ok'
    : 'ok';

  return {
    bank,
    balance: account.balance ?? 0,
    updatedAt: item?.lastUpdatedAt ?? null,
    status,
    days,
    transactions: transactions
      .map((transaction) => {
        const description = scrubIdentifiers(
          transaction.merchantName || transaction.description || 'Movimentação',
        )
          .trim()
          .slice(0, 120);
        const sign = transaction.type === 'DEBIT' ? -1 : 1;
        const kind = kindOf(transaction.description, transaction.operationType);
        return {
          id: transaction.id,
          date: dayInSaoPaulo(transaction.date),
          at: transaction.date || null,
          amount: sign * Math.abs(transaction.amount),
          description,
          kind,
          flow: flowOf(transaction.category, kind),
          category: transaction.category
            ? (CATEGORIES[transaction.category] ?? transaction.category)
            : null,
          pending: transaction.status === 'PENDING',
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date)),
    card: credit
      ? {
          limit: credit.creditLimit,
          available: credit.availableCreditLimit,
          bill,
        }
      : null,
    vaults,
  };
}
