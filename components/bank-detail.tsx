'use client';

import { BANK_COLOUR } from '@/lib/bank-colors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CreditCard,
  PiggyBank,
} from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import Link from '@/components/navigation-link';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { createClient } from '@/lib/supabase/client';
import type {
  BankDetail,
  BankKey,
  BankTransaction,
} from '@/lib/pluggy/bank-detail';
import { BANK_FOLLOW_UPS, subscribeManualRefresh } from '@/lib/manual-refresh';
import { findPassThroughs, type PassThrough } from '@/lib/pluggy/bank-flows';
import { cn } from '@/lib/utils';

/* Página de um banco (/bancos/[banco]), aberta pelos saldos da home: saldo,
   evolução, entradas/saídas, categorias, cartão, cofrinhos e extrato por dia.
   Dados de /api/pluggy/banks/[banco] (lib/pluggy/bank-detail.ts). */

/* Cores de lib/bank-colors.ts. */
const BANKS: Record<BankKey, { name: string; logo: string; color: string }> = {
  nubank: {
    name: 'Nubank',
    logo: '/logos/nubank-ui.webp',
    color: BANK_COLOUR.nubank,
  },
  itau: { name: 'Itaú', logo: '/logos/itau-app.webp', color: BANK_COLOUR.itau },
  picpay: {
    name: 'PicPay',
    logo: '/logos/picpay-ui.webp',
    color: BANK_COLOUR.picpay,
  },
  'mercado-pago': {
    name: 'Mercado Pago',
    logo: '/logos/mercado-pago-ui.webp',
    color: BANK_COLOUR['mercado-pago'],
  },
};

const PERIODS = [30, 60, 90] as const;

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    value,
  );

const dayFormat = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const shortDay = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});
const timeFormat = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

const todayKey = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );

/** "Hoje", "Ontem" ou "quinta-feira, 25 de setembro". */
function dayLabel(day: string) {
  const today = todayKey();
  const yesterday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(Date.now() - 86_400_000));
  if (day === today) return 'Hoje';
  if (day === yesterday) return 'Ontem';
  const label = dayFormat.format(new Date(`${day}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function updatedLabel(iso: string | null) {
  if (!iso) return 'Sem data de atualização';
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
  const when =
    day === todayKey()
      ? 'hoje'
      : `em ${shortDay.format(new Date(`${day}T12:00:00Z`))}`;
  return `Atualizado ${when} às ${timeFormat.format(new Date(iso))}`;
}

/** Saldo no fim de cada dia, de trás para a frente a partir do atual. */
function balanceSeries(detail: BankDetail) {
  const byDay = new Map<string, number>();
  for (const transaction of detail.transactions)
    byDay.set(
      transaction.date,
      (byDay.get(transaction.date) ?? 0) + transaction.amount,
    );
  const points: { day: string; balance: number }[] = [];
  let balance = detail.balance;
  for (let i = 0; i <= detail.days; i++) {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(Date.now() - i * 86_400_000));
    points.push({ day, balance });
    balance -= byDay.get(day) ?? 0;
  }
  return points.reverse();
}

/* Última leitura por banco e período, só em memória: volta sem esperar e
   só redesenha se mudou. */
const memory = new Map<string, { detail: BankDetail; signature: string }>();

async function fetchDetail(bank: BankKey, days: number) {
  const response = await fetch(`/api/pluggy/banks/${bank}?days=${days}`, {
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as {
    detail?: BankDetail;
    error?: string;
  };
  if (!response.ok || !body.detail)
    throw new Error(body.error ?? 'Não foi possível abrir este banco.');
  return body.detail;
}

export function BankDetailScreen({ bank }: { bank: BankKey }) {
  const meta = BANKS[bank];
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const key = `${bank}:${days}`;
  const [detail, setDetail] = useState<BankDetail | null>(
    () => memory.get(key)?.detail ?? null,
  );
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'in' | 'out' | 'internal'>(
    'all',
  );

  const load = useCallback(async () => {
    try {
      const next = await fetchDetail(bank, days);
      const signature = JSON.stringify(next);
      setError('');
      if (memory.get(key)?.signature === signature) return;
      memory.set(key, { detail: next, signature });
      setDetail(next);
    } catch (reason) {
      if (!memory.get(key))
        setError(
          reason instanceof Error ? reason.message : 'Não foi possível abrir.',
        );
    }
  }, [bank, days, key]);

  // Movimentação aberta no detalhe.
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  const [income, setIncome] = useState<
    Map<string, { id: string; counted: boolean }>
  >(new Map());
  // Entradas deste extrato que viraram lançamento de renda
  // (lib/pluggy/income-entries.ts), por id da transação.
  useEffect(() => {
    let alive = true;
    void createClient()
      .from('financial_entries')
      .select('id, external_id, excluded_from_totals')
      .eq('account', 'Renda')
      .eq('source', 'pluggy')
      .then(({ data }) => {
        if (!alive || !data) return;
        setIncome(
          new Map(
            data.map((row) => [
              String(row.external_id),
              { id: String(row.id), counted: !row.excluded_from_totals },
            ]),
          ),
        );
      });
    return () => {
      alive = false;
    };
  }, [detail]);
  const toggleIncome = async (transactionId: string, counted: boolean) => {
    const record = income.get(transactionId);
    if (!record) return;
    const set = (value: boolean) =>
      setIncome((current) =>
        new Map(current).set(transactionId, { ...record, counted: value }),
      );
    set(counted);
    const { error: failure } = await createClient()
      .from('financial_entries')
      .update({ excluded_from_totals: !counted })
      .eq('id', record.id);
    if (failure) {
      set(!counted);
      setError('Não foi possível salvar. Tente de novo.');
    }
  };

  // Atualização da barra do topo: lê agora e reconfere por ~1 min.
  useEffect(
    () => subscribeManualRefresh(load, { followUps: BANK_FOLLOW_UPS }),
    [load],
  );

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      setDetail(memory.get(key)?.detail ?? null);
      return load();
    });
    return () => {
      alive = false;
    };
  }, [key, load]);

  // Repasses: entrada e saída de mesmo valor, próximas (lib/pluggy/bank-flows.ts).
  const passThroughs = useMemo(
    () =>
      detail
        ? findPassThroughs(detail.transactions)
        : { pairs: [], ids: new Set<string>() },
    [detail],
  );

  const summary = useMemo(() => {
    if (!detail) return null;
    // Entrada que só cobriu um pagamento vai para "movidos", exceto se a
    // saída foi para outra conta do próprio usuário.
    const covering = new Set(
      passThroughs.pairs
        .filter((pair) => pair.out.flow === 'external')
        .map((pair) => pair.in.id),
    );
    // Só movimento com terceiros; transferências internas e rendimento à parte.
    let income = 0;
    let spent = 0;
    let moved = 0;
    let earned = 0;
    const categories = new Map<string, number>();
    for (const transaction of detail.transactions) {
      if (transaction.flow === 'internal' || covering.has(transaction.id)) {
        moved += Math.abs(transaction.amount);
        continue;
      }
      if (transaction.flow === 'yield') {
        earned += transaction.amount;
        continue;
      }
      if (transaction.amount >= 0) income += transaction.amount;
      else {
        spent += -transaction.amount;
        const name = transaction.category ?? 'Outros';
        categories.set(name, (categories.get(name) ?? 0) - transaction.amount);
      }
    }
    return {
      income,
      spent,
      moved,
      earned,
      categories: [...categories.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    };
  }, [detail, passThroughs]);

  const series = useMemo(() => (detail ? balanceSeries(detail) : []), [detail]);

  const groups = useMemo(() => {
    if (!detail) return [];
    // Entradas/Saídas = terceiros; Internas = entre contas próprias; rendimento
    // em Tudo. Repasse aparece no dia da saída, nunca em Entradas.
    const shows = (transaction: BankTransaction) =>
      filter === 'all'
        ? true
        : filter === 'internal'
          ? transaction.flow === 'internal'
          : transaction.flow === 'external' &&
            (filter === 'in'
              ? transaction.amount >= 0
              : transaction.amount < 0);
    const showsPair = (pair: PassThrough) =>
      filter === 'all' ||
      filter === 'internal' ||
      (filter === 'out' && pair.out.flow === 'external');
    const map = new Map<string, StatementItem[]>();
    const add = (day: string, item: StatementItem) =>
      map.set(day, [...(map.get(day) ?? []), item]);
    const pairOf = new Map(
      passThroughs.pairs.map((pair) => [pair.out.id, pair] as const),
    );
    for (const transaction of detail.transactions) {
      const pair = pairOf.get(transaction.id);
      if (pair) {
        if (showsPair(pair)) add(transaction.date, { pair });
        continue;
      }
      if (passThroughs.ids.has(transaction.id)) continue;
      if (shows(transaction)) add(transaction.date, { transaction });
    }
    return [...map.entries()].sort((x, y) => y[0].localeCompare(x[0]));
  }, [detail, filter, passThroughs]);

  return (
    <main className="min-h-dvh bg-background pb-[max(2rem,env(safe-area-inset-bottom))] text-foreground">
      {/* A atualização chega pela inscrição abaixo. */}
      <AppHeader onRefresh={() => undefined} />
      <div className="app-container mx-auto max-w-2xl py-6 md:py-9">
        <NavigationBackButton fallback="/" className="mb-5" />

        {/* Cabeçalho: logo, nome, saldo e quando o banco atualizou. */}
        <section className="relative overflow-hidden rounded-[2rem] border bg-card p-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full opacity-20 blur-3xl"
            style={{ background: meta.color }}
          />
          <div className="relative flex items-center gap-3">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl border bg-background">
              <Image
                src={meta.logo}
                alt=""
                width={36}
                height={36}
                className="size-9 object-contain"
                unoptimized
              />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">
                {meta.name}
              </h1>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    detail?.status === 'error'
                      ? 'bg-destructive'
                      : detail?.status === 'updating'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500',
                  )}
                />
                {detail
                  ? detail.status === 'updating'
                    ? 'O banco está atualizando…'
                    : detail.status === 'error'
                      ? 'Conexão com problema · veja em Conexões'
                      : updatedLabel(detail.updatedAt)
                  : 'Carregando…'}
              </p>
            </div>
          </div>
          <p className="relative mt-6 text-xs text-muted-foreground">
            Saldo disponível
          </p>
          {detail ? (
            <p className="relative mt-1 text-4xl font-semibold tracking-tight tabular-nums">
              <Private>{money(detail.balance)}</Private>
            </p>
          ) : (
            <Skeleton className="relative mt-2 h-10 w-48" />
          )}
          {series.length > 1 && (
            <BalanceChart series={series} color={meta.color} />
          )}
        </section>

        {error && !detail && (
          <p role="alert" className="mt-6 text-sm text-muted-foreground">
            {error}
          </p>
        )}

        {/* Período do resumo e do extrato. */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Resumo</h2>
          <div className="flex gap-1.5">
            {PERIODS.map((period) => (
              <Button
                key={period}
                size="sm"
                variant={days === period ? 'glass' : 'glass-quiet'}
                aria-pressed={days === period}
                onClick={() => setDays(period)}
              >
                {period} dias
              </Button>
            ))}
          </div>
        </div>

        {summary ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="Entrou" value={summary.income} tone="in" />
              <Metric label="Saiu" value={summary.spent} tone="out" />
            </div>
            {(summary.moved > 0 || summary.earned > 0) && (
              <p className="mt-2 px-1 text-xs leading-relaxed text-muted-foreground">
                Fora da conta:{' '}
                {summary.moved > 0 && (
                  <>
                    <Private>{money(summary.moved)}</Private> movidos entre suas
                    contas e cofrinhos
                  </>
                )}
                {summary.moved > 0 && summary.earned > 0 && ' · '}
                {summary.earned > 0 && (
                  <>
                    <Private>+{money(summary.earned)}</Private> de rendimento
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-20 rounded-2xl" />
            ))}
          </div>
        )}

        {summary && summary.categories.length > 0 && (
          <section className="mt-4 rounded-3xl border bg-card p-5">
            <h2 className="text-sm font-semibold">Para onde foi</h2>
            <ul className="mt-3 space-y-3">
              {summary.categories.map(([name, value]) => (
                <li key={name}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{name}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      <Private>{money(value)}</Private>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(4, (value / summary.spent) * 100)}%`,
                        background: meta.color,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Cartão e cofrinhos da mesma conexão. */}
        {detail && (detail.card || detail.vaults.count > 0) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {detail.card && (
              <CardSummary card={detail.card} color={meta.color} />
            )}
            {detail.vaults.count > 0 && (
              <Link
                href="/cofrinhos"
                className="flex items-center gap-3 rounded-3xl border bg-card p-5 transition-colors hover:bg-muted/40"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
                  <PiggyBank className="size-5 text-muted-foreground" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {detail.vaults.count === 1
                      ? '1 cofrinho'
                      : `${detail.vaults.count} cofrinhos`}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <Private>{money(detail.vaults.total)}</Private> guardados
                  </span>
                </span>
              </Link>
            )}
          </div>
        )}

        {/* O extrato, por dia. */}
        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Extrato</h2>
            <div className="flex gap-1.5">
              {(
                [
                  ['all', 'Tudo'],
                  ['in', 'Entradas'],
                  ['out', 'Saídas'],
                  ['internal', 'Internas'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={filter === value ? 'glass' : 'glass-quiet'}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {!detail ? (
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-16 rounded-2xl" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="mt-6 rounded-3xl border bg-card p-6 text-center text-sm text-muted-foreground">
              Nada neste período.
            </p>
          ) : (
            <div className="mt-4 space-y-5">
              {groups.map(([day, items]) => (
                <div key={day}>
                  <p className="px-1 text-xs font-medium text-muted-foreground">
                    {dayLabel(day)}
                  </p>
                  <ul className="mt-2 divide-y overflow-hidden rounded-3xl border bg-card">
                    {items.map((item) =>
                      'pair' in item ? (
                        <PassThroughRow
                          key={`${item.pair.in.id}-${item.pair.out.id}`}
                          pair={item.pair}
                        />
                      ) : (
                        <TransactionRow
                          key={item.transaction.id}
                          transaction={item.transaction}
                          onOpen={() => setSelected(item.transaction)}
                        />
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {selected && (
        <BankTransactionDialog
          key={selected.id}
          transaction={selected}
          bankName={meta.name}
          counted={income.get(selected.id)?.counted}
          onCount={(value) => toggleIncome(selected.id, value)}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'in' | 'out';
}) {
  return (
    <div className="rounded-2xl border bg-card p-3.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-sm font-semibold tabular-nums',
          tone === 'in' && 'text-emerald-500',
        )}
      >
        <Private>
          {tone === 'in' ? '+' : '−'}
          {money(Math.abs(value))}
        </Private>
      </p>
    </div>
  );
}

/** Uma linha do extrato: uma transação sozinha ou um repasse. */
type StatementItem = { transaction: BankTransaction } | { pair: PassThrough };

/** Repasse: entrada e saída juntas, saldo zerado. */
function PassThroughRow({ pair }: { pair: PassThrough }) {
  const line = (transaction: BankTransaction, incoming: boolean) => {
    const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0',
            incoming ? 'text-emerald-500' : 'text-muted-foreground',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {transaction.description}
        </span>
        <span
          className={cn(
            'shrink-0 text-sm tabular-nums',
            incoming && 'text-emerald-500',
          )}
        >
          <Private>
            {incoming ? '+' : '−'}
            {money(Math.abs(transaction.amount))}
          </Private>
        </span>
      </span>
    );
  };
  return (
    <li className="px-4 py-3">
      <span className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <ArrowLeftRight className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Repasse</span>
          <span className="block text-xs text-muted-foreground">
            Entrou e saiu o mesmo valor
            {pair.out.category ? ` · ${pair.out.category}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          <Private>{money(0)}</Private>
        </span>
      </span>
      {/* `minmax(0,1fr)` deixa a coluna encolher; senão descrição longa empurra o valor. */}
      <span className="mt-2.5 ml-12 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 border-l pl-3">
        {line(pair.in, true)}
        {line(pair.out, false)}
      </span>
    </li>
  );
}

function TransactionRow({
  transaction,
  onOpen,
}: {
  transaction: BankTransaction;
  onOpen: () => void;
}) {
  const incoming = transaction.amount >= 0;
  const internal = transaction.flow === 'internal';
  const Icon = internal
    ? ArrowLeftRight
    : incoming
      ? ArrowDownLeft
      : ArrowUpRight;
  const detail = [transaction.kind, transaction.category]
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join(' · ');
  const content = (
    <>
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-xl',
          internal
            ? 'bg-muted text-muted-foreground'
            : incoming
              ? 'bg-emerald-500/12 text-emerald-500'
              : 'bg-muted',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {transaction.description}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {internal
            ? `Entre suas contas${transaction.kind === 'Reserva' ? ' · cofrinho' : ''}`
            : detail || (incoming ? 'Entrada' : 'Saída')}
          {transaction.pending && ' · pendente'}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          internal ? 'text-muted-foreground' : incoming && 'text-emerald-500',
        )}
      >
        <Private>
          {incoming ? '+' : '−'}
          {money(Math.abs(transaction.amount))}
        </Private>
      </span>
    </>
  );
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {content}
      </button>
    </li>
  );
}

const longDate = (day: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${day}T12:00:00Z`));

/**
 * Detalhe de uma movimentação. Em entradas que viraram renda, o
 * "Contar no Entrou" decide só se ela conta.
 */
function BankTransactionDialog({
  transaction,
  bankName,
  counted,
  onCount,
  onClose,
}: {
  transaction: BankTransaction;
  bankName: string;
  counted?: boolean;
  onCount: (value: boolean) => void;
  onClose: () => void;
}) {
  const incoming = transaction.amount >= 0;
  const internal = transaction.flow === 'internal';
  const rows: [string, string][] = [
    ['Data', longDate(transaction.date)],
    ['Banco', bankName],
    ['Tipo', transaction.kind ?? (incoming ? 'Entrada' : 'Saída')],
    ...(transaction.category
      ? [['Categoria', transaction.category] as [string, string]]
      : []),
    [
      'Movimento',
      internal
        ? 'Entre as suas contas'
        : transaction.flow === 'yield'
          ? 'Rendimento'
          : incoming
            ? 'Entrou na conta'
            : 'Saiu da conta',
    ],
    ['Situação', transaction.pending ? 'Pendente' : 'Lançada pelo banco'],
  ];
  const switchId = `contar-${transaction.id}`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words">
            {transaction.description}
          </DialogTitle>
          <DialogDescription>Movimentação no {bankName}</DialogDescription>
        </DialogHeader>
        <p
          className={cn(
            'text-3xl font-semibold tabular-nums',
            internal ? 'text-muted-foreground' : incoming && 'text-emerald-500',
          )}
        >
          <Private>
            {incoming ? '+' : '−'}
            {money(Math.abs(transaction.amount))}
          </Private>
        </p>
        <dl className="divide-y rounded-2xl border">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 px-3 py-2.5 text-sm"
            >
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 text-right first-letter:uppercase">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {counted !== undefined && (
          <div className="flex items-start justify-between gap-4 rounded-2xl border p-3">
            <label htmlFor={switchId} className="grid gap-1 text-sm">
              Contar no Entrou
              <span className="text-xs text-muted-foreground">
                {counted
                  ? 'Conta no “Entrou” do Resumo e da home.'
                  : 'Fica no extrato, mas não conta no “Entrou”.'}
              </span>
            </label>
            <Switch id={switchId} checked={counted} onCheckedChange={onCount} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardSummary({
  card,
  color,
}: {
  card: NonNullable<BankDetail['card']>;
  color: string;
}) {
  const used =
    card.limit && card.available !== null
      ? Math.min(1, Math.max(0, (card.limit - card.available) / card.limit))
      : null;
  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
          <CreditCard className="size-5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Cartão de crédito</p>
          {card.available !== null && (
            <p className="text-xs text-muted-foreground">
              <Private>{money(card.available)}</Private> disponíveis
            </p>
          )}
        </div>
      </div>
      {used !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(3, used * 100)}%`, background: color }}
          />
        </div>
      )}
      {card.limit !== null && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Limite de <Private>{money(card.limit)}</Private>
        </p>
      )}
      {card.bill && (
        <p className="mt-3 text-xs">
          Fatura de{' '}
          <span className="font-semibold">
            <Private>{money(card.bill.total)}</Private>
          </span>{' '}
          vence em {shortDay.format(new Date(`${card.bill.dueDate}T12:00:00Z`))}
        </p>
      )}
    </section>
  );
}

/**
 * Evolução do saldo: área na cor do banco com o ponto de hoje, sem eixos.
 * Desenhado na largura real (ResizeObserver), curva Catmull-Rom.
 */
function BalanceChart({
  series,
  color,
}: {
  series: { day: string; balance: number }[];
  color: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = 80;
  const pad = 6;
  const values = series.map((point) => point.balance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = series.map(
    (point, index) =>
      [
        pad + (index / (series.length - 1)) * Math.max(0, width - pad * 2),
        pad + (1 - (point.balance - min) / span) * (height - pad * 2 - 8),
      ] as const,
  );
  // Controles seguem a tendência dos vizinhos, presos ao trecho.
  const clamp = (value: number, a: number, b: number) =>
    Math.min(Math.max(value, Math.min(a, b)), Math.max(a, b));
  let line = '';
  points.forEach(([x, y], index) => {
    if (index === 0) {
      line = `M${x.toFixed(1)} ${y.toFixed(1)}`;
      return;
    }
    const [x0, y0] = points[index - 1];
    const [xp, yp] = points[index - 2] ?? points[index - 1];
    const [xn, yn] = points[index + 1] ?? points[index];
    const c1x = x0 + (x - xp) / 6;
    const c1y = clamp(y0 + (y - yp) / 6, y0, y);
    const c2x = x - (xn - x0) / 6;
    const c2y = clamp(y - (yn - y0) / 6, y0, y);
    line += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const [lastX, lastY] = points[points.length - 1];
  const id = `bank-chart-${color.slice(1)}`;
  return (
    <div ref={ref} className="relative mt-5 h-20 w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.28} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path
            d={`${line} L${lastX.toFixed(1)} ${height} L${pad} ${height} Z`}
            fill={`url(#${id})`}
          />
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={lastX} cy={lastY} r={6} fill={color} opacity={0.2} />
          <circle cx={lastX} cy={lastY} r={3.5} fill={color} />
        </svg>
      )}
    </div>
  );
}
