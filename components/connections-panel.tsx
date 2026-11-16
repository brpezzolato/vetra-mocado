'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  describeFailures,
  describeSummary,
  groupRounds,
  type SyncRun,
  type SyncTrigger,
} from '@/lib/pluggy/run-summary';
import { CARD_BANKS, cardBankName, type CardBankId } from '@/lib/payment-cards';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import type { ConnectionHealth } from '@/lib/pluggy/connection-health';
import { LOCAL_PER_DAY, type LocalRound } from '@/lib/pluggy/local-rounds';

/* Conexões com os bancos: atualização pelo notebook (o Chrome do PC clica em
   "Atualizar" no Meu Pluggy; scripts/pluggy-local-agent.ts), a saúde de cada
   banco e o histórico de sincronizações. */

const TRIGGER: Record<SyncTrigger, string> = {
  cron: 'Automática',
  manual: 'Você pediu',
  webhook: 'Aviso do banco',
};

const RUN_STATUS = {
  ok: { label: 'Concluída', icon: CheckCircle2, tone: 'text-emerald-500' },
  partial: {
    label: 'Com avisos',
    icon: AlertTriangle,
    tone: 'text-amber-500',
  },
  error: { label: 'Falhou', icon: XCircle, tone: 'text-destructive' },
} as const;

/** Nome de quem falhou na rodada (`SyncFailure.where`). */
const FAILURE_WHERE: Record<string, string> = {
  pix: 'Pix',
  corrente: 'Conta corrente',
  cartao: 'Cartão',
};
const failureWhere = (where: string) =>
  FAILURE_WHERE[where] ??
  (CARD_BANKS.some((bank) => bank.id === where)
    ? cardBankName(where as CardBankId)
    : where);

/** A lista de conexões do Meu Pluggy, onde cada banco tem o seu Atualizar. */
const MEU_PLUGGY_CONNECTIONS = 'https://meu.pluggy.ai/connections';

function duration(ms: number) {
  if (ms < 1000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

const dayFormat = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});
const timeFormat = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
});

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return dayFormat.format(date);
}

type State = { runs: SyncRun[]; banks: ConnectionHealth[] };

async function fetchState(): Promise<State> {
  const response = await fetch('/api/pluggy/connections', {
    cache: 'no-store',
  });
  if (!response.ok) return { runs: [], banks: [] };
  const body = (await response.json()) as Partial<State>;
  return { runs: body.runs ?? [], banks: body.banks ?? [] };
}

/** Atualização pelo notebook (app/api/pluggy/local). */
type LocalState = {
  agentOnline: boolean;
  lastSeenAt: string | null;
  buttonLeft: number;
  verdict: 'ok' | 'busy' | 'daily_cap' | 'too_soon';
  latest: LocalRound | null;
};

async function fetchLocal(): Promise<LocalState | null> {
  const response = await fetch('/api/pluggy/local', { cache: 'no-store' });
  return response.ok ? ((await response.json()) as LocalState) : null;
}

const LOCAL_FAILED: Record<string, string> = {
  expired:
    'A sessão do Meu Pluggy no notebook expirou. Peça ao Claude um novo login.',
  challenged:
    'A Pluggy pediu verificação anti-robô. Nada foi contornado; atualize pelo Meu Pluggy.',
  captcha:
    'O Meu Pluggy pediu verificação. Nada foi contornado; atualize pelo Meu Pluggy.',
  late: 'O notebook não pegou o pedido a tempo: estava desligado ou dormindo.',
  busy: 'Há uma janela do Meu Pluggy aberta no notebook. Feche-a e peça de novo.',
  refused: 'O Meu Pluggy não aceitou o pedido em nenhum banco.',
};

const LOCAL_SKIPPED: Record<string, string> = {
  daily_cap: 'O limite do dia já tinha sido usado.',
  too_soon: 'A última atualização tinha sido há menos de 10 minutos.',
  busy: 'Já havia outra atualização rodando.',
};

const LOCAL_BLOCKED: Record<LocalState['verdict'], string | null> = {
  ok: null,
  busy: null,
  daily_cap: `Seus ${LOCAL_PER_DAY.button} pedidos de hoje já foram usados. As automáticas seguem.`,
  too_soon: 'A última atualização foi há menos de 10 minutos.',
};

const BANK_INFO: Record<string, { name: string; logo: string }> = {
  nubank: { name: 'Nubank', logo: '/logos/nubank-ui.webp' },
  itau: { name: 'Itaú', logo: '/logos/itau-app.webp' },
  picpay: { name: 'PicPay', logo: '/logos/picpay-ui.webp' },
  'mercado-pago': { name: 'Mercado Pago', logo: '/logos/mercado-pago-ui.webp' },
  santander: { name: 'Santander', logo: '/logos/santander-ui.webp' },
};

const HEALTH_BADGE: Record<
  ConnectionHealth['state'],
  { label: string; tone: string }
> = {
  ok: {
    label: 'Em dia',
    tone: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  },
  updating: {
    label: 'Atualizando',
    tone: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  },
  stale: {
    label: 'Parado',
    tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  },
  error: {
    label: 'Com problema',
    tone: 'bg-destructive/12 text-destructive',
  },
};

/** "hoje às 08:35", "ontem às 20:34" ou "em 03/10". */
function updatedLabel(iso: string) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
  const time = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
  const diff = Math.round(
    (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) /
      86_400_000,
  );
  if (diff === 0) return `hoje às ${time}`;
  if (diff === 1) return `ontem às ${time}`;
  return `em ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** O que dizer da última rodada pelo notebook. */
function localMessage(state: LocalState) {
  const round = state.latest;
  if (!round) return null;
  if (round.status === 'pending')
    return state.agentOnline
      ? 'Na fila: o notebook começa em instantes.'
      : 'Esperando o notebook ligar. O pedido vale por 30 minutos.';
  if (round.status === 'running') return 'Atualizando os bancos pelo notebook…';
  const when = updatedLabel(round.finished_at ?? round.requested_at);
  const origin = round.trigger === 'schedule' ? 'Rodada automática' : 'Pedido';
  if (round.status === 'ok')
    return `${origin} ${when}: a Pluggy aceitou ${round.detail ?? 'os'} bancos.`;
  if (round.status === 'skipped')
    return `${origin} ${when} não rodou. ${LOCAL_SKIPPED[round.result ?? ''] ?? ''}`.trim();
  return `${origin} ${when} falhou. ${LOCAL_FAILED[round.result ?? ''] ?? 'Tente de novo mais tarde.'}`;
}

export function ConnectionsPanel() {
  const [runs, setRuns] = useState<SyncRun[] | null>(null);
  const [banks, setBanks] = useState<ConnectionHealth[] | null>(null);
  const [local, setLocal] = useState<LocalState | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');

  const apply = useCallback((state: State) => {
    setRuns(state.runs);
    setBanks(state.banks);
  }, []);
  const load = useCallback(async () => apply(await fetchState()), [apply]);
  useEffect(() => {
    let alive = true;
    void fetchState().then((state) => alive && apply(state));
    void fetchLocal().then((state) => alive && setLocal(state));
    return () => {
      alive = false;
    };
  }, [apply]);

  const active =
    local?.latest?.status === 'pending' || local?.latest?.status === 'running';
  // Na fila ou rodando: acompanha até terminar e recarrega o histórico.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void fetchLocal().then((state) => {
        setLocal(state);
        const status = state?.latest?.status;
        if (status !== 'pending' && status !== 'running') void load();
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [active, load]);

  const ask = async () => {
    setAsking(true);
    setError('');
    try {
      const response = await fetch('/api/pluggy/local', { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as LocalState & {
        error?: string;
      };
      if (!response.ok) setError(body.error ?? 'Não foi possível pedir agora.');
      else setLocal(body);
    } catch {
      setError('Sem conexão agora. Tente de novo daqui a pouco.');
    } finally {
      setAsking(false);
    }
  };

  // Uma linha por rodada: sincronizações coladas viram uma (lib/pluggy/run-summary).
  const days = groupRounds(runs ?? []).reduce<
    { day: string; runs: SyncRun[] }[]
  >((groups, item) => {
    const day = dayLabel(item.started_at);
    const last = groups.at(-1);
    if (last?.day === day) last.runs.push(item);
    else groups.push({ day, runs: [item] });
    return groups;
  }, []);

  const blocked = local ? LOCAL_BLOCKED[local.verdict] : null;
  const status = local ? localMessage(local) : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader onRefresh={() => window.location.reload()} />
      <div className="app-container mx-auto max-w-xl py-6 md:py-9">
        <NavigationBackButton fallback="/" className="mb-5" />
        <h1 className="text-2xl font-semibold tracking-tight">Conexões</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Como o Vetra busca os dados dos seus bancos e o que cada atualização
          trouxe.
        </p>

        <section className="mt-6 rounded-3xl border bg-card p-5">
          <h2 className="font-semibold">Atualizar os bancos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O notebook abre o Meu Pluggy e toca em Atualizar em cada banco; os
            dados chegam aqui em poucos minutos. Sozinho às 7h, 14h, 18h e 23h,
            com alguns minutos de variação.
          </p>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                'size-2 shrink-0 rounded-full',
                local?.agentOnline
                  ? 'bg-emerald-500'
                  : 'bg-muted-foreground/40',
              )}
            />
            {local === null
              ? 'Verificando o notebook…'
              : `${local.agentOnline ? 'Notebook ligado' : 'Notebook desligado ou dormindo'} · ${local.buttonLeft} de ${LOCAL_PER_DAY.button} pedidos seus hoje`}
          </p>
          <Button
            variant="glass"
            className="mt-4 w-full"
            disabled={asking || active || !local || local.verdict !== 'ok'}
            onClick={() => void ask()}
          >
            <RefreshCw
              className={cn('size-4', (asking || active) && 'animate-spin')}
            />
            Atualizar pelo notebook
          </Button>
          {(error || status || blocked) && (
            <output
              aria-live="polite"
              className={cn(
                'mt-3 block text-sm',
                error ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {error || status}
              {!error && !active && blocked && (
                <span className="mt-1 block">{blocked}</span>
              )}
            </output>
          )}
          <a
            href={MEU_PLUGGY_CONNECTIONS}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: 'glass-quiet', size: 'sm' }),
              'mt-3 w-full',
            )}
          >
            <ExternalLink className="size-4" />
            Notebook desligado? Abrir o Meu Pluggy
          </a>
        </section>

        {/* Selo quando o banco passa de 2 dias sem atualizar ou dá erro
            (lib/pluggy/connection-health.ts). */}
        {banks && banks.length > 0 && (
          <section className="mt-6 rounded-3xl border bg-card p-5">
            <h2 className="font-semibold">Bancos</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Quando cada um trouxe dados pela última vez.
            </p>
            <ul className="mt-3 divide-y divide-border/60">
              {banks.map((bank, index) => {
                const info = bank.bank ? BANK_INFO[bank.bank] : undefined;
                const badge = HEALTH_BADGE[bank.state];
                return (
                  <li
                    key={`${bank.bank ?? 'banco'}-${index}`}
                    className="flex items-center gap-3 py-3"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-background">
                      {info ? (
                        <Image
                          src={info.logo}
                          alt=""
                          width={18}
                          height={18}
                          unoptimized
                          className="size-[18px] object-contain"
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {info?.name ?? 'Banco'}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {bank.updatedAt
                          ? `Atualizado ${updatedLabel(bank.updatedAt)}`
                          : 'Sem data de atualização'}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium',
                        badge.tone,
                      )}
                    >
                      {bank.state === 'stale' && bank.days !== null
                        ? `Parado há ${bank.days} dias`
                        : badge.label}
                    </span>
                  </li>
                );
              })}
            </ul>
            {banks.some((bank) => bank.state === 'error') && (
              <p className="mt-2 text-xs text-muted-foreground">
                Conexão com problema: abra o Meu Pluggy e reconecte o banco. Se
                refizer a conexão, ela precisa ser autorizada de novo para o
                Vetra.
              </p>
            )}
          </section>
        )}

        <section className="mt-8">
          <h2 className="px-1 font-semibold">Histórico</h2>
          <p className="mt-0.5 px-1 text-xs text-muted-foreground">
            Cada vez que o Vetra buscou os dados dos bancos.
          </p>
          {runs === null ? (
            <p className="mt-4 px-1 text-sm text-muted-foreground">
              Carregando…
            </p>
          ) : runs.length === 0 ? (
            <p className="mt-4 rounded-3xl border bg-card p-5 text-sm text-muted-foreground">
              Nenhuma sincronização registrada ainda. As automáticas são às 7h,
              14h, 18h e 23h.
            </p>
          ) : (
            <div className="mt-4 space-y-5">
              {days.map((group) => (
                <div key={group.day}>
                  <p className="px-1 text-xs font-medium text-muted-foreground capitalize">
                    {group.day}
                  </p>
                  <ol className="mt-2 divide-y overflow-hidden rounded-3xl border bg-card">
                    {group.runs.map((item) => {
                      const status = RUN_STATUS[item.status];
                      const Icon = status.icon;
                      return (
                        <li key={item.id} className="flex gap-3 p-4">
                          <Icon
                            aria-hidden
                            className={cn(
                              'mt-0.5 size-4 shrink-0',
                              status.tone,
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="text-sm font-medium">
                                {TRIGGER[item.trigger]}
                              </p>
                              <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {timeFormat.format(new Date(item.started_at))} ·{' '}
                                {duration(item.duration_ms)}
                              </p>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              <span className={status.tone}>
                                {status.label}
                              </span>
                              {' · '}
                              {item.error ?? describeSummary(item.summary)}
                            </p>
                            {describeFailures(
                              item.summary.failures,
                              failureWhere,
                            ).map((line) => (
                              <p
                                key={line}
                                className="mt-0.5 text-xs text-amber-600 dark:text-amber-400"
                              >
                                {line}
                              </p>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
