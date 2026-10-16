// Saldos das contas correntes e limites dos cartões, direto da Pluggy (home e
// Vetra AI). Só a chave do banco e valores, nunca id, nome ou número.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PluggyClient } from './client';

export type AccountBalance = {
  bank: 'nubank' | 'itau' | 'picpay' | 'mercado-pago';
  balance: number;
};

// Empate (dois zerados, por exemplo) fica sempre na mesma ordem.
const ORDER = ['nubank', 'itau', 'picpay', 'mercado-pago'];

/** Limite que vale (`effectiveCreditLimit`) e quanto está livre. */
export type CardLimitBalance = {
  /** Nome do cartão no Vetra (`pluggy_card_links.account`). */
  key: string;
  limit: number;
  available: number;
};

/**
 * Negativo sem cheque especial em uso é dinheiro na aplicação automática que
 * o banco resgata depois (Itaú "Aplic Aut Mais", 16/10/2026): a Pluggy não
 * traz a aplicação, então o saldo conta como zero. Com cheque especial em
 * uso (ou sem a informação), o negativo fica.
 */
export function coveredBalance(balance: number, overdraftUsed: number | null) {
  return balance < 0 && overdraftUsed === 0 ? 0 : balance;
}

export async function loadAccountBalances(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  userId: string,
): Promise<AccountBalance[]> {
  return (await loadAccountsAndLimits(admin, pluggy, userId)).accounts;
}

export async function loadAccountsAndLimits(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  userId: string,
): Promise<{ accounts: AccountBalance[]; cards: CardLimitBalance[] }> {
  const [links, piggies] = await Promise.all([
    admin
      .from('pluggy_card_links')
      .select('pluggy_item_id, pluggy_account_id, account, kind')
      .eq('user_id', userId),
    admin
      .from('piggy_banks')
      .select('pluggy_item_id')
      .eq('user_id', userId)
      .not('pluggy_item_id', 'is', null),
  ]);
  const items = [
    ...new Set(
      [...(links.data ?? []), ...(piggies.data ?? [])].map(
        (row) => row.pluggy_item_id as string,
      ),
    ),
  ];
  const lists = await Promise.all(
    items.map((id) => pluggy.listAccounts(id).catch(() => [])),
  );
  const all = lists.flat();
  const cardName = new Map(
    (links.data ?? [])
      .filter((row) => row.kind === 'credit')
      .map((row) => [row.pluggy_account_id as string, row.account as string]),
  );
  const cards = all
    .filter(
      (account) =>
        account.type === 'CREDIT' &&
        account.creditLimit !== null &&
        account.creditLimit > 0 &&
        account.availableCreditLimit !== null,
    )
    .map((account, index) => ({
      key: cardName.get(account.id) ?? `Cartão ${index + 1}`,
      limit: account.creditLimit!,
      // Entre zero e o limite: o banco às vezes manda centavos a mais ou negativo.
      available: Math.min(
        Math.max(account.availableCreditLimit!, 0),
        account.creditLimit!,
      ),
    }));
  const accounts = all
    .filter(
      (account) =>
        account.type === 'BANK' &&
        account.bank !== null &&
        account.balance !== null,
    )
    .map((account) => ({
      bank: account.bank!,
      balance: coveredBalance(account.balance!, account.overdraftUsed),
    }))
    // Do maior saldo para o menor.
    .sort(
      (a, b) =>
        b.balance - a.balance || ORDER.indexOf(a.bank) - ORDER.indexOf(b.bank),
    );
  return { accounts, cards };
}
