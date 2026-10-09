// Descobre cartão de crédito novo: a cada sincronização liga ao app todo
// cartão das conexões conhecidas que ainda não está ligado, com nome, banco,
// faturas, limite e compras; o ciclo vem das faturas (`saveCycle`).
// Só service role. Nunca loga id nem nome vindo do banco.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PluggyClient } from './client';
import type { PluggyAccount } from './types';
import { saoPauloDay } from './vault-movements';

const BANK_NAME: Record<string, string> = {
  nubank: 'Nubank',
  itau: 'Itaú',
  picpay: 'PicPay',
  'mercado-pago': 'Mercado Pago',
};

/** "PIC PAY MASTERCARD GOLD" → "Pic Pay Mastercard Gold". */
const titleCase = (value: string) =>
  value
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase('pt-BR'));

/**
 * Nome no app: banco + produto, sem números e sem repetir o banco. Se já
 * existir (o débito do mesmo cartão), ganha "Crédito".
 */
export function creditCardName(
  bank: string | null,
  productName: string,
  taken: Set<string>,
) {
  const bankName = bank ? BANK_NAME[bank] : null;
  // Sem acento só para comparar: o banco manda "ITAU", o app escreve "Itaú".
  const plain = (value: string) =>
    value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const product = titleCase(plain(productName).replace(/\d+/g, ' '));
  let base = product || 'Cartão de crédito';
  if (bankName) {
    // Banco dentro do produto (com ou sem espaços) vira o nome certo; senão vai
    // na frente.
    const letters = plain(bankName).replace(/\s+/g, '').split('');
    const pattern = new RegExp(
      letters
        .map((letter) => letter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s*'),
      'i',
    );
    base = pattern.test(product)
      ? product.replace(pattern, bankName).replace(/\s+/g, ' ').trim()
      : `${bankName} ${product}`.trim();
  }
  // Nomes que só diferem em acento ou maiúscula são o mesmo nome.
  const key = (value: string) => plain(value).toLocaleLowerCase('pt-BR');
  const used = new Set([...taken].map(key));
  let name = base.slice(0, 70);
  if (used.has(key(name))) name = `${name} Crédito`.slice(0, 80);
  for (let n = 2; used.has(key(name)); n++) name = `${base.slice(0, 70)} ${n}`;
  return name;
}

/** O primeiro dia do mês passado: entram as faturas a partir dele. */
function importFrom() {
  const [year, month] = saoPauloDay(new Date().toISOString())
    .split('-')
    .map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return previous.toISOString().slice(0, 10);
}

/** Liga os cartões de crédito novos; devolve quantos. */
export async function discoverCreditCards(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  userId?: string,
) {
  type Filterable = { eq(column: string, value: string): Filterable };
  const scoped = <Query>(query: Query): Query =>
    userId
      ? ((query as unknown as Filterable).eq(
          'user_id',
          userId,
        ) as unknown as Query)
      : query;
  const [{ data: links }, { data: piggies }, { data: cards }] =
    await Promise.all([
      scoped(
        admin
          .from('pluggy_card_links')
          .select('user_id, account, pluggy_item_id, pluggy_account_id'),
      ),
      scoped(
        admin
          .from('piggy_banks')
          .select('user_id, pluggy_item_id')
          .not('pluggy_item_id', 'is', null),
      ),
      scoped(admin.from('payment_cards').select('user_id, account')),
    ]);

  // As conexões de cada usuário e o que já está ligado.
  const items = new Map<string, Set<string>>();
  for (const row of [...(links ?? []), ...(piggies ?? [])]) {
    const set = items.get(row.user_id as string) ?? new Set<string>();
    set.add(row.pluggy_item_id as string);
    items.set(row.user_id as string, set);
  }
  const linked = new Set(
    (links ?? []).map((row) => row.pluggy_account_id as string),
  );

  let found = 0;
  for (const [user, itemIds] of items) {
    const taken = new Set(
      [...(links ?? []), ...(cards ?? [])]
        .filter((row) => row.user_id === user)
        .map((row) => row.account as string),
    );
    for (const itemId of itemIds) {
      const accounts: PluggyAccount[] = await pluggy
        .listAccounts(itemId)
        .catch(() => []);
      // Banco da conexão pela conta corrente (o nome do cartão nem sempre diz).
      const bank =
        accounts.find((account) => account.type === 'BANK' && account.bank)
          ?.bank ??
        accounts.find((account) => account.bank)?.bank ??
        null;
      for (const account of accounts) {
        if (account.type !== 'CREDIT' || linked.has(account.id)) continue;
        const name = creditCardName(bank, account.productName ?? '', taken);
        const { error } = await admin.from('pluggy_card_links').insert({
          user_id: user,
          account: name,
          pluggy_item_id: itemId,
          pluggy_account_id: account.id,
          kind: 'credit',
          import_from: importFrom(),
        });
        if (error) continue;
        linked.add(account.id);
        taken.add(name);
        found++;
        await admin
          .from('payment_cards')
          .upsert(
            { user_id: user, account: name, bank_id: bank ?? 'other' },
            { onConflict: 'user_id,account', ignoreDuplicates: true },
          );
        await admin.from('app_notifications').upsert(
          {
            user_id: user,
            event_key: `pluggy-new-card:${account.id}`,
            kind: 'integration',
            title: 'Novo cartão de crédito',
            body: `${name} chegou pelo Open Finance: faturas, limite e compras já estão no app.`,
            href: '/faturas',
          },
          { onConflict: 'user_id,event_key', ignoreDuplicates: true },
        );
      }
    }
  }
  return found;
}
