'use client';

import { BANK_COLOUR } from '@/lib/bank-colors';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { PiggyBank } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import Link from '@/components/navigation-link';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import type {
  BankDetail,
  BankKey,
  BankTransaction,
} from '@/lib/pluggy/bank-detail';
import { BANK_FOLLOW_UPS, subscribeManualRefresh } from '@/lib/manual-refresh';
import { findPassThroughs, type PassThrough } from '@/lib/pluggy/bank-flows';
import { cn } from '@/lib/utils';
import { money } from '@/lib/money';
import {
  shortDay,
  Metric,
  type StatementItem,
  PassThroughRow,
  TransactionRow,
  BankTransactionDialog,
  CardSummary,
  BalanceChart,
} from '@/components/bank-detail-parts';

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

const dayFormat = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
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
