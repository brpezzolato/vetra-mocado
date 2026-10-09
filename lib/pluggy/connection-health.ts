// Saúde de cada conexão: selo em Conexões e aviso no sininho após 2 dias sem
// atualizar (consentimento vencido, senha trocada, conexão refeita).
// Só service role. Sai só a chave do banco, datas e estado.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PluggyClient } from './client';
import type { PluggyItem } from './types';

/** A partir de quanto tempo sem atualizar o banco fica "desatualizado". */
export const STALE_AFTER_MS = 2 * 86_400_000;

export type ConnectionHealth = {
  bank: string | null;
  updatedAt: string | null;
  state: 'ok' | 'updating' | 'stale' | 'error';
  /** Dias inteiros desde a última atualização. */
  days: number | null;
};

/** O estado de uma conexão, pelo item da Pluggy. Pura, para os testes. */
export function connectionState(
  item: Pick<PluggyItem, 'status' | 'lastUpdatedAt'> | null,
  hasAccounts: boolean,
  now = Date.now(),
): Pick<ConnectionHealth, 'state' | 'days'> {
  const updated = item?.lastUpdatedAt ? Date.parse(item.lastUpdatedAt) : NaN;
  const days = Number.isFinite(updated)
    ? Math.floor((now - updated) / 86_400_000)
    : null;
  if (!item || !hasAccounts || /ERROR|OUTDATED|LOGIN/.test(item.status))
    return { state: 'error', days };
  if (/UPDATING|WAITING/.test(item.status)) return { state: 'updating', days };
  if (!Number.isFinite(updated) || now - updated > STALE_AFTER_MS)
    return { state: 'stale', days };
  return { state: 'ok', days };
}

/** As conexões que o app conhece, uma por banco, com o estado de cada. */
export async function loadConnectionHealth(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  userId: string,
): Promise<ConnectionHealth[]> {
  const [{ data: links }, { data: piggies }] = await Promise.all([
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
  const items = [
    ...new Set(
      [...(links ?? []), ...(piggies ?? [])].map(
        (row) => row.pluggy_item_id as string,
      ),
    ),
  ];
  const health = await Promise.all(
    items.map(async (itemId) => {
      const [item, accounts] = await Promise.all([
        pluggy.getItem(itemId).catch(() => null),
        pluggy.listAccounts(itemId).catch(() => []),
      ]);
      const bank =
        accounts.find((account) => account.type === 'BANK' && account.bank)
          ?.bank ??
        accounts.find((account) => account.bank)?.bank ??
        null;
      return {
        bank,
        updatedAt: item?.lastUpdatedAt ?? null,
        ...connectionState(item, accounts.length > 0),
      };
    }),
  );
  const order = ['nubank', 'itau', 'picpay', 'mercado-pago'];
  return health.sort(
    (a, b) => order.indexOf(a.bank ?? '') - order.indexOf(b.bank ?? ''),
  );
}

const BANK_NAME: Record<string, string> = {
  nubank: 'Nubank',
  itau: 'Itaú',
  picpay: 'PicPay',
  'mercado-pago': 'Mercado Pago',
};

/** Avisa uma vez por dia por banco; roda com as atualizações automáticas. */
export async function notifyUnhealthyConnections(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  userId: string,
  day: string,
) {
  for (const connection of await loadConnectionHealth(admin, pluggy, userId)) {
    if (connection.state !== 'stale' && connection.state !== 'error') continue;
    const name = connection.bank
      ? (BANK_NAME[connection.bank] ?? 'Um banco')
      : 'Um banco';
    await admin.from('app_notifications').upsert(
      {
        user_id: userId,
        event_key: `pluggy-health:${connection.bank ?? 'banco'}:${day}`,
        kind: 'integration',
        title:
          connection.state === 'error'
            ? `${name} com problema na conexão`
            : `${name} sem atualizar há ${connection.days ?? 2} dias`,
        body:
          connection.state === 'error'
            ? 'A conexão parou de trazer dados. Veja em Conexões; pode ser preciso reconectar no Meu Pluggy.'
            : 'Os números deste banco podem estar velhos. Veja em Conexões.',
        href: '/conexoes',
      },
      { onConflict: 'user_id,event_key', ignoreDuplicates: true },
    );
  }
}
