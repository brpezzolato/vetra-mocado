'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  describeSummary,
  groupRounds,
  type SyncRun,
  type SyncTrigger,
} from '@/lib/pluggy/run-summary';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import type { ConnectionHealth } from '@/lib/pluggy/connection-health';

/* Conexões com os bancos: situação do robô, histórico de sincronizações
   (origem, resultado, duração, o que trouxe) e o login do robô, escondido
   enquanto conectado. Login sem senha: cola-se o link do e-mail sem abri-lo. */

type Robot = {
  status: 'awaiting_link' | 'active' | 'expired' | 'error';
  last_error: string | null;
  last_refresh_at: string | null;
} | null;

const STATUS: Record<NonNullable<Robot>['status'], string> = {
  awaiting_link: 'Esperando o link do e-mail',
  active: 'Conectado',
  expired: 'Sessão expirada',
  error: 'Com erro',
};

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

const ROBOT: Record<string, string> = {
  done: 'Robô pediu atualização aos bancos',
  'failed:expired': 'Robô: sessão expirada',
  'failed:captcha': 'Robô: o Meu Pluggy pediu verificação',
  'failed:error': 'Robô: não conseguiu entrar',
  'failed:no_connections': 'Robô: o Meu Pluggy não mostrou conexões',
  'failed:no_button': 'Robô: não achou o botão de atualizar',
  'skipped:too_soon': 'Robô: pedido recente, pulou',
  'skipped:daily_cap': 'Robô: limite do dia atingido, só leu o que já havia',
  'skipped:manual_cap':
    'Robô: suas 2 atualizações de hoje já foram (as outras 3 são do automático), só leu o que já havia',
};

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

async function call(body: Record<string, string>) {
  const response = await fetch('/api/pluggy/robot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : 'Não foi possível concluir.',
    );
  return data;
}

type State = { robot: Robot; runs: SyncRun[]; banks: ConnectionHealth[] };

async function fetchState(): Promise<State> {
  const response = await fetch('/api/pluggy/robot', { cache: 'no-store' });
  if (!response.ok) return { robot: null, runs: [], banks: [] };
  const body = (await response.json()) as Partial<State> & { robot: Robot };
  return { robot: body.robot, runs: body.runs ?? [], banks: body.banks ?? [] };
}

const BANK_INFO: Record<string, { name: string; logo: string }> = {
  nubank: { name: 'Nubank', logo: '/logos/nubank-ui.webp' },
  itau: { name: 'Itaú', logo: '/logos/itau-app.webp' },
  picpay: { name: 'PicPay', logo: '/logos/picpay-ui.webp' },
  'mercado-pago': { name: 'Mercado Pago', logo: '/logos/mercado-pago-ui.webp' },
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

export function PluggyRobotPanel() {
  const [robot, setRobot] = useState<Robot>(null);
  const [runs, setRuns] = useState<SyncRun[] | null>(null);
  const [banks, setBanks] = useState<ConnectionHealth[] | null>(null);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'' | 'login' | 'sync'>('');
  const [message, setMessage] = useState('');
  const [showLogin, setShowLogin] = useState(false);

  const apply = useCallback((state: State) => {
    setRobot(state.robot);
    setRuns(state.runs);
    setBanks(state.banks);
  }, []);
  const load = useCallback(async () => apply(await fetchState()), [apply]);
  useEffect(() => {
    let alive = true;
    void fetchState().then((state) => alive && apply(state));
    return () => {
      alive = false;
    };
  }, [apply]);

  const connected = robot?.status === 'active';
  // Conectado: o login some e só volta quando pedido.
  const loginVisible = !connected || showLogin;

  const run = async (body: Record<string, string>, done: string) => {
    setBusy('login');
    setMessage('');
    try {
      const result = await call(body);
      if (result.ok === false)
        setMessage(
          result.reason === 'captcha'
            ? 'O Meu Pluggy pediu verificação de robô. Paramos aqui.'
            : result.reason === 'expired'
              ? 'A sessão expirou. Conecte o robô de novo.'
              : result.reason === 'not_sent'
                ? 'O Meu Pluggy não aceitou o pedido do link. Tente de novo em alguns minutos.'
                : 'Não deu certo. Tente de novo.',
        );
      else if (body.action === 'start' && typeof result.screen === 'string')
        setMessage(`${done} O Meu Pluggy respondeu: “${result.screen}”`);
      else setMessage(done);
      if (body.action === 'finish') {
        setLink('');
        if (result.ok !== false) setShowLogin(false);
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro.');
    } finally {
      setBusy('');
    }
  };

  /** Robô pede aos bancos e o app busca a Pluggy; vira "Você pediu" no histórico. */
  const syncNow = async () => {
    setBusy('sync');
    setMessage('');
    try {
      if (connected) await call({ action: 'refresh' }).catch(() => null);
      const response = await fetch('/api/pluggy/sync', { method: 'POST' });
      if (!response.ok) setMessage('A sincronização falhou. Veja abaixo.');
      await load();
    } catch {
      setMessage('Sem conexão agora. Tente de novo daqui a pouco.');
    } finally {
      setBusy('');
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
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={cn(
                'mt-1.5 size-2.5 shrink-0 rounded-full',
                connected
                  ? 'bg-emerald-500'
                  : robot
                    ? 'bg-amber-500'
                    : 'bg-muted-foreground/40',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                Robô do Meu Pluggy
              </p>
              <p className="font-semibold">
                {robot ? STATUS[robot.status] : 'Desconectado'}
              </p>
              {robot?.last_refresh_at && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Último pedido aos bancos:{' '}
                  {dayLabel(robot.last_refresh_at).toLowerCase()} às{' '}
                  {timeFormat.format(new Date(robot.last_refresh_at))}
                </p>
              )}
              {robot?.last_error && (
                <p className="mt-1 text-xs text-destructive">
                  {robot.last_error}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              variant="glass"
              disabled={busy !== ''}
              onClick={() => void syncNow()}
            >
              <RefreshCw
                className={cn('size-4', busy === 'sync' && 'animate-spin')}
              />
              Atualizar agora
            </Button>
            {connected ? (
              <Button
                variant="glass-quiet"
                aria-expanded={showLogin}
                aria-controls="robot-login"
                onClick={() => setShowLogin((value) => !value)}
              >
                {showLogin ? 'Esconder login' : 'Conectar de novo'}
                <ChevronDown
                  className={cn(
                    'size-4 transition-transform',
                    showLogin && 'rotate-180',
                  )}
                />
              </Button>
            ) : (
              <Button
                variant="glass-quiet"
                disabled={busy !== '' || !robot}
                onClick={() =>
                  void run(
                    { action: 'disconnect' },
                    'Robô desconectado e sessão apagada.',
                  )
                }
              >
                Apagar sessão
              </Button>
            )}
          </div>
          {(busy || message) && (
            <output className="mt-3 block text-sm text-muted-foreground">
              {busy === 'sync'
                ? 'Atualizando… pode levar até 1 minuto.'
                : busy === 'login'
                  ? 'Trabalhando… pode levar até 1 minuto.'
                  : message}
            </output>
          )}
        </section>

        {loginVisible && (
          <div id="robot-login" className="mt-4 space-y-4">
            <p className="px-1 text-sm text-muted-foreground">
              Sem senha: o robô entra no Meu Pluggy pelo link que chega no seu
              e-mail.
            </p>
            <section className="space-y-3 rounded-3xl border bg-card p-5">
              <h2 className="font-semibold">1. Pedir o link</h2>
              <div className="space-y-1.5">
                <Label htmlFor="robot-email">E-mail do Meu Pluggy</Label>
                <Input
                  id="robot-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="voce@exemplo.com"
                />
              </div>
              <Button
                variant="glass"
                disabled={busy !== '' || !email}
                onClick={() =>
                  void run(
                    { action: 'start', email },
                    'Pronto. Chegou um e-mail do Meu Pluggy: copie o link dele (não abra) e cole abaixo.',
                  )
                }
              >
                Enviar link para o meu e-mail
              </Button>
            </section>

            <section className="space-y-3 rounded-3xl border bg-card p-5">
              <h2 className="font-semibold">2. Colar o link do e-mail</h2>
              <p className="text-xs text-muted-foreground">
                No e-mail, segure o botão de entrar e escolha “Copiar link”. Se
                você abrir o link, quem entra é o seu navegador, não o robô.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="robot-link">Link do e-mail</Label>
                <Textarea
                  id="robot-link"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  rows={3}
                />
              </div>
              <Button
                variant="glass"
                disabled={busy !== '' || !link}
                onClick={() =>
                  void run({ action: 'finish', link }, 'Robô conectado.')
                }
              >
                Concluir login do robô
              </Button>
            </section>

            {connected && (
              <Button
                variant="glass-quiet"
                disabled={busy !== ''}
                onClick={() =>
                  void run(
                    { action: 'disconnect' },
                    'Robô desconectado e sessão apagada.',
                  )
                }
              >
                Desconectar e apagar sessão
              </Button>
            )}
          </div>
        )}

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
              14h e 22h.
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
                      const robotNote = item.robot ? ROBOT[item.robot] : null;
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
                            {robotNote && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {robotNote}
                              </p>
                            )}
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
