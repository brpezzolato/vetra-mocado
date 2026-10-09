/** `short` é o nome do banco sozinho, para chip e rótulo curto. */
export const CARD_BANKS = [
  { id: 'flash', name: 'Flash Benefícios', short: 'Flash', color: '#ff278d' },
  { id: 'itau', name: 'Itaú Platinum', short: 'Itaú', color: '#ff6900' },
  { id: 'nubank', name: 'Nubank Gold', short: 'Nubank', color: '#820ad1' },
  { id: 'picpay', name: 'PicPay', short: 'PicPay', color: '#080808' },
  {
    id: 'mercado-pago',
    name: 'Mercado Pago',
    short: 'Mercado Pago',
    color: '#ffe600',
  },
] as const;

/** O nome curto do banco de um cartão; "Cartão" quando não é um dos
 * conhecidos. */
export const cardBankName = (bankId: CardBankId) =>
  CARD_BANKS.find((bank) => bank.id === bankId)?.short ?? 'Cartão';
export type CardBankId = (typeof CARD_BANKS)[number]['id'] | 'other';
export type PaymentMethodId = CardBankId | 'pix';
export type PaymentCard = {
  user_id: string;
  account: string;
  bank_id: CardBankId;
  /** Aparece nas faturas (Faturas, calendário, página do banco, Vetra AI). */
  show_in_invoices?: boolean;
  /** A outra função do mesmo plástico (débito ↔ crédito). */
  same_card_as?: string | null;
  created_at: string;
  updated_at: string;
};

export function suggestedCardBank(account: string): CardBankId {
  const normalized = account
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const matches: [CardBankId, RegExp][] = [
    ['flash', /\bflash\b/],
    ['picpay', /\bpic\s?pay\b/],
    ['nubank', /\bnubank\b|\bnu\b/],
    ['itau', /\bitau\b|\bitaucard\b/],
    ['mercado-pago', /\bmercado\s?pago\b/],
  ];
  return (
    matches.find(([, pattern]) => pattern.test(normalized))?.[0] ?? 'other'
  );
}

export function resolveCardBank(
  account: string,
  cards: PaymentCard[],
): CardBankId {
  const saved = cards.find((card) => card.account === account.trim());
  if (saved)
    return CARD_BANKS.some((bank) => bank.id === saved.bank_id)
      ? saved.bank_id
      : 'other';
  return suggestedCardBank(account);
}

export function resolvePaymentMethod(
  account: string,
  cards: PaymentCard[],
): PaymentMethodId {
  return account.trim().toLocaleLowerCase('pt-BR') === 'pix'
    ? 'pix'
    : resolveCardBank(account, cards);
}

export function cardAccounts(accounts: string[], cards: PaymentCard[]) {
  const cleaned = accounts
    .map((value) => value.trim())
    .filter((value) => value && value !== 'Não informada');
  const usage = new Map<string, { count: number; recent: number }>();
  cleaned.forEach((account, index) => {
    const current = usage.get(account);
    usage.set(account, {
      count: (current?.count ?? 0) + 1,
      recent: current?.recent ?? index,
    });
  });
  const registeredOrder = new Map(
    cards.map((card, index) => [card.account.trim(), index]),
  );
  return [...new Set([...cleaned, ...registeredOrder.keys()])].sort((a, b) => {
    const aUsage = usage.get(a);
    const bUsage = usage.get(b);
    return (
      (bUsage?.count ?? 0) - (aUsage?.count ?? 0) ||
      (aUsage?.recent ?? Number.MAX_SAFE_INTEGER) -
        (bUsage?.recent ?? Number.MAX_SAFE_INTEGER) ||
      (registeredOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (registeredOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

export function sortPaymentCardsByUsage(
  cards: PaymentCard[],
  accounts: string[],
) {
  const orderedAccounts = cardAccounts(accounts, cards);
  const order = new Map(
    orderedAccounts.map((account, index) => [account, index]),
  );
  return cards
    .map((card, index) => ({ card, index }))
    .sort(
      (a, b) =>
        (order.get(a.card.account.trim()) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.card.account.trim()) ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map(({ card }) => card);
}

/**
 * Brand colour per payment method, shared so every screen paints a method
 * the same way. Includes `other` and Pix.
 */
export const PAYMENT_METHOD_COLOUR: Record<PaymentMethodId, string> = {
  nubank: '#820ad1',
  picpay: '#21c25e',
  itau: '#ff6600',
  'mercado-pago': '#ffe600',
  flash: '#ff2a91',
  pix: '#32bcad',
  other: 'var(--muted-foreground)',
};
