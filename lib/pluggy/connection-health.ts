// Saúde de cada conexão: selo em Conexões e aviso no sininho após 2 dias sem
// atualizar (consentimento vencido, senha trocada, conexão refeita).
// Só service role. Sai só a chave do banco, datas e estado.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PluggyClient } from './client';
import type { PluggyItem } from './types';
import { typicalDelayHours, type ArrivalRow } from './arrival-delay';

/** A partir de quanto tempo sem atualizar o banco fica "desatualizado". */
export const STALE_AFTER_MS = 2 * 86_400_000;

export type ConnectionHealth = {
  bank: string | null;
  updatedAt: string | null;
  state: 'ok' | 'updating' | 'stale' | 'error';
  /** Dias inteiros desde a última atualização. */
  days: number | null;
  /** O banco pede uma ação no Meu Pluggy (código, confirmação). */
  waitingInput?: boolean;
  consentExpiresAt?: string | null;
  autoSyncOff?: boolean;
  /** Quanto as compras dos cartões deste banco costumam levar (horas). */
  purchaseDelayHours?: number | null;
};

/** Aviso do sininho; `key` dá um por situação (o dia entra quando repete). */
export type ConnectionNotice = { key: string; title: string; body: string };

/** Resultado da última rodada do notebook (`pluggy_local_rounds.result`). */
export type LocalResult = string | null;

const DAY_MS = 86_400_000;

/** O programa do notebook visto pelo app. */
export type AgentState = {
  /** Último sinal de vida (`pluggy_local_agent`); `null` se nunca deu. */
  lastSeenAt?: string | null;
  /** Resultado das últimas rodadas terminadas, da mais nova à mais velha. */
  recentResults?: string[];
};

/**
 * Sem sinal do notebook por mais que isso: as rodadas automáticas pararam.
 * Folga para a noite entre a rodada das 23h e a das 7h.
 */
export const AGENT_SILENT_MS = 9 * 3_600_000;

/** Rodada que falhou por algo da automação (não da Pluggy nem do banco). */
const BROKEN_RESULTS = new Set([
  'no_button',
  'no_connections',
  'refused',
  'error',
  'busy',
  'late',
]);

const saoPauloTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * O que avisar sobre as conexões e a atualização pelo notebook. Pura.
 * Consentimento: aos 15, 7 e 1 dia do fim (uma vez em cada).
 */
export function connectionNotices(
  connections: ConnectionHealth[],
  local: LocalResult,
  day: string,
  now = Date.now(),
  agent: AgentState = {},
): ConnectionNotice[] {
  const notices: ConnectionNotice[] = [];
  for (const connection of connections) {
    const bank = connection.bank ?? 'banco';
    const name = connection.bank
      ? (BANK_NAME[connection.bank] ?? 'Um banco')
      : 'Um banco';
    if (connection.waitingInput)
      notices.push({
        key: `pluggy-input:${bank}:${day}`,
        title: `${name} pede uma confirmação`,
        body: 'O banco espera uma ação sua no Meu Pluggy (código ou confirmação) para voltar a atualizar.',
      });
    else if (connection.state === 'error' || connection.state === 'stale')
      notices.push({
        key: `pluggy-health:${bank}:${day}`,
        title:
          connection.state === 'error'
            ? `${name} com problema na conexão`
            : `${name} sem atualizar há ${connection.days ?? 2} dias`,
        body:
          connection.state === 'error'
            ? 'A conexão parou de trazer dados. Veja em Conexões; pode ser preciso reconectar no Meu Pluggy.'
            : 'Os números deste banco podem estar velhos. Veja em Conexões.',
      });
    if (connection.autoSyncOff)
      notices.push({
        key: `pluggy-autosync:${bank}:${day}`,
        title: `Atualização automática do ${name} desligada`,
        body: 'A Pluggy parou de atualizar este banco sozinha depois de falhas seguidas. Reconecte no Meu Pluggy.',
      });
    const expires = connection.consentExpiresAt
      ? Date.parse(connection.consentExpiresAt)
      : NaN;
    if (Number.isFinite(expires)) {
      const left = Math.ceil((expires - now) / DAY_MS);
      const step = [1, 7, 15].find((limit) => left <= limit);
      if (left < 1)
        notices.push({
          key: `pluggy-consent:${bank}:${connection.consentExpiresAt!.slice(0, 10)}:0`,
          title: `Consentimento do ${name} venceu`,
          body: 'Os dados deste banco pararam de chegar. Renove o consentimento no Meu Pluggy.',
        });
      else if (step)
        notices.push({
          key: `pluggy-consent:${bank}:${connection.consentExpiresAt!.slice(0, 10)}:${step}`,
          title: `Consentimento do ${name} vence ${left === 1 ? 'amanhã' : `em ${left} dias`}`,
          body: 'Renove no Meu Pluggy para os dados continuarem chegando.',
        });
    }
  }
  if (local === 'expired')
    notices.push({
      key: `pluggy-local:expired:${day}`,
      title: 'Sessão do Meu Pluggy no notebook expirou',
      body: 'O notebook não consegue pedir atualização aos bancos até você entrar de novo. Até lá, os dados chegam só quando a Pluggy atualiza sozinha.',
    });
  else if (local === 'challenged' || local === 'captcha')
    notices.push({
      key: `pluggy-local:check:${day}`,
      title: 'A Pluggy pediu verificação anti-robô',
      body: 'O notebook parou sem contornar nada. Atualize pelo Meu Pluggy enquanto isso.',
    });
  if (agent.lastSeenAt !== undefined) {
    const seen = agent.lastSeenAt ? Date.parse(agent.lastSeenAt) : NaN;
    if (!Number.isFinite(seen) || now - seen > AGENT_SILENT_MS)
      notices.push({
        key: `pluggy-local:offline:${day}`,
        title: Number.isFinite(seen)
          ? `Notebook sem sinal desde ${saoPauloTime(agent.lastSeenAt!)}`
          : 'Notebook sem sinal',
        body: 'As rodadas automáticas nos bancos estão paradas. Ligue o notebook (ou tire da suspensão) e confira a internet; o programa abre sozinho com o Windows.',
      });
  }
  const recent = agent.recentResults ?? [];
  if (
    recent.length >= 2 &&
    recent.slice(0, 2).every((result) => BROKEN_RESULTS.has(result))
  )
    notices.push({
      key: `pluggy-local:broken:${day}`,
      title: 'A atualização pelo notebook falhou duas vezes seguidas',
      body: 'Pode ser que o Meu Pluggy tenha mudado a tela. Os dados seguem chegando quando a Pluggy atualiza sozinha; veja os detalhes em Conexões.',
    });
  return notices;
}

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
        waitingInput: item?.status === 'WAITING_USER_INPUT',
        consentExpiresAt: item?.consentExpiresAt ?? null,
        autoSyncOff: !!item?.autoSyncDisabledAt,
      };
    }),
  );
  const delays = await loadPurchaseDelays(admin, userId).catch(
    () => new Map<string, number | null>(),
  );
  for (const connection of health)
    if (connection.bank && delays.has(connection.bank))
      (connection as ConnectionHealth).purchaseDelayHours = delays.get(
        connection.bank,
      );
  const order = ['nubank', 'itau', 'picpay', 'mercado-pago', 'santander'];
  return health.sort(
    (a, b) => order.indexOf(a.bank ?? '') - order.indexOf(b.bank ?? ''),
  );
}

/**
 * Atraso típico das compras de cartão por banco (`payment_cards.bank_id`),
 * nos últimos 60 dias. Só datas: nenhum valor nem descrição sai daqui.
 */
async function loadPurchaseDelays(admin: SupabaseClient, userId: string) {
  const { data: links } = await admin
    .from('pluggy_card_links')
    .select('account')
    .eq('user_id', userId)
    .eq('kind', 'credit');
  const accounts = (links ?? []).map((row) => row.account as string);
  const delays = new Map<string, number | null>();
  if (!accounts.length) return delays;
  const [{ data: cards }, { data: rows }] = await Promise.all([
    admin
      .from('payment_cards')
      .select('account, bank_id')
      .eq('user_id', userId)
      .in('account', accounts),
    admin
      .from('financial_entries')
      .select('account, occurred_at, created_at')
      .eq('user_id', userId)
      .eq('source', 'pluggy')
      .eq('entry_type', 'expense')
      .in('account', accounts)
      .gte('occurred_at', new Date(Date.now() - 60 * DAY_MS).toISOString())
      .limit(2000),
  ]);
  const bankOf = new Map(
    (cards ?? []).map((card) => [
      card.account as string,
      card.bank_id as string,
    ]),
  );
  const byBank = new Map<string, ArrivalRow[]>();
  for (const row of (rows ?? []) as (ArrivalRow & { account: string })[]) {
    const bank = bankOf.get(row.account);
    if (!bank) continue;
    byBank.set(bank, [...(byBank.get(bank) ?? []), row]);
  }
  for (const [bank, bankRows] of byBank)
    delays.set(bank, typicalDelayHours(bankRows));
  return delays;
}

export const BANK_NAME: Record<string, string> = {
  nubank: 'Nubank',
  itau: 'Itaú',
  picpay: 'PicPay',
  'mercado-pago': 'Mercado Pago',
  santander: 'Santander',
};

/** Avisa das conexões e do notebook; roda com as atualizações automáticas. */
export async function notifyUnhealthyConnections(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  userId: string,
  day: string,
) {
  const [connections, { data: rounds }, { data: agent }] = await Promise.all([
    loadConnectionHealth(admin, pluggy, userId),
    // As últimas rodadas do notebook que terminaram.
    admin
      .from('pluggy_local_rounds')
      .select('result')
      .eq('user_id', userId)
      .in('status', ['ok', 'failed'])
      .order('requested_at', { ascending: false })
      .limit(2),
    admin
      .from('pluggy_local_agent')
      .select('last_seen_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  const results = (rounds ?? []).map((row) => String(row.result ?? ''));
  const notices = connectionNotices(
    connections,
    results[0] || null,
    day,
    Date.now(),
    // Sem linha do notebook: ele nunca foi instalado, não há o que avisar.
    agent
      ? {
          lastSeenAt: (agent.last_seen_at as string | null) ?? null,
          recentResults: results,
        }
      : {},
  );
  if (!notices.length) return;
  await admin.from('app_notifications').upsert(
    notices.map((notice) => ({
      user_id: userId,
      event_key: notice.key,
      kind: 'integration',
      title: notice.title,
      body: notice.body,
      href: '/conexoes',
    })),
    { onConflict: 'user_id,event_key', ignoreDuplicates: true },
  );
}
