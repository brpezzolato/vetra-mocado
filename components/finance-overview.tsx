'use client';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import {
  subscribeManualRefresh,
  BANK_FOLLOW_UPS,
  refreshWidgetsOnce,
} from '@/lib/manual-refresh';
import { ExpenseEntryDialog } from '@/components/expense-entry-dialog';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/components/navigation-link';
import Decimal from 'decimal.js';
import { ArrowDownLeft, ArrowUpRight, Sparkles } from 'lucide-react';
import type { DailyRate, PiggyBank } from '@/lib/domain';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { calculatePortfolio, portfolioEarnings } from '@/lib/portfolio';
import { weeklySummary } from '@/lib/expense-insights';
import { recapDefaultMonth, recapIsFresh } from '@/lib/monthly-recap';
import { monthLabel } from '@/lib/period-summary';
import { VaultCards } from '@/components/vault-cards';
import { summarizeFinances } from '@/lib/finance-overview';
import { createClient } from '@/lib/supabase/client';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import { isPendingSpend, pendingEntries } from '@/lib/unidentified-spend';
import { loadUnidentifiedSpend } from '@/lib/unidentified-spend-query';
import { Button } from '@/components/ui/button';
import { sortPaymentCardsByUsage, type PaymentCard } from '@/lib/payment-cards';
import { RecentExpenses } from '@/components/recent-expenses';
import { WishlistCard } from '@/components/wishlist-card';
import { ReviewTeaser } from '@/components/review-teaser';
import { toTotalsView } from '@/lib/entry-share';
import { AccountBalances } from '@/components/account-balances';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SwipePager, type PagerControl } from '@/components/swipe-pager';
import { RobotFreshness } from '@/components/robot-freshness';
import { EntryDetails } from '@/components/entry-details';
import { WeeklyExpenseSummary } from '@/components/expense-assistant';
import { FinanceOverviewDataSkeleton } from '@/components/data-skeletons';
import { Skeleton } from '@/components/ui/skeleton';
import { useMediaQuery } from '@/lib/use-media-query';
import { ArrowRightSymbol } from '@/components/ui/glass-button';

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value).toNumber(),
  );

/* Dados da home só em memória: volta sem esqueleto e só redesenha quando
   a `signature` muda. */
let overviewMemory: {
  entries: FinancialEntry[];
  cards: PaymentCard[];
  signature: string;
} | null = null;

const HOME_TABS = ['gastos', 'semana', 'cofrinhos'] as const;

const TAB_LABELS: Record<(typeof HOME_TABS)[number], string> = {
  gastos: 'Gastos',
  semana: 'Semana',
  cofrinhos: 'Cofrinhos',
};
type HomeTab = (typeof HOME_TABS)[number];

export function FinanceOverview({
  banks,
  rates,
  banksLoading = false,
  entryOpen: entryOpenProp,
  onEntryOpenChange,
}: {
  banks: PiggyBank[];
  rates: DailyRate[];
  banksLoading?: boolean;
  /** "Novo lançamento" controlado de fora (o "+" da barra). */
  entryOpen?: boolean;
  onEntryOpenChange?: (open: boolean) => void;
}) {
  const client = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState<FinancialEntry[]>(
    () => overviewMemory?.entries ?? [],
  );
  const [selectedEntry, setSelectedEntry] = useState<FinancialEntry | null>(
    null,
  );
  const [cards, setCards] = useState<PaymentCard[]>(
    () => overviewMemory?.cards ?? [],
  );
  // Com memória, nasce pronta.
  const [ready, setReady] = useState(() => overviewMemory !== null);
  const [ownEntryOpen, setOwnEntryOpen] = useState(false);
  const entryOpen = entryOpenProp ?? ownEntryOpen;
  const setEntryOpen = onEntryOpenChange ?? setOwnEntryOpen;
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<HomeTab>('gastos');
  // A pílula da aba ativa, movida pelo SwipePager.
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const boldLabelsRef = useRef<HTMLSpanElement>(null);
  const pager = useRef<PagerControl | null>(null);
  const tabPosition = useRef(0);
  // Arrasto da pílula: a posição segue o dedo (um terço do trilho por aba);
  // só transform, uma vez por quadro, e o React só sabe no fim (onChange).
  const pillDrag = useRef<{
    id: number;
    x: number;
    y: number;
    from: number;
    slot: number;
    position: number;
    lastX: number;
    lastAt: number;
    velocity: number;
    active: boolean;
  } | null>(null);
  const pillFrame = useRef(0);
  const pillLiftRef = useRef<HTMLSpanElement>(null);
  // Segurar a pílula: ela cresce um pouco (mola curta) e volta ao soltar.
  const liftPill = (up: boolean) => {
    const pill = pillLiftRef.current;
    if (!pill) return;
    pill.style.transition = up
      ? 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 200ms ease-out'
      : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 280ms ease-out';
    pill.style.transform = up ? 'scale(1.1)' : 'scale(1)';
    pill.style.boxShadow = up ? '0 8px 24px rgb(0 0 0 / 0.35)' : '';
  };
  const pillDragged = useRef(false);
  const pillDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pillDragged.current = false;
    const box = pillLiftRef.current?.getBoundingClientRect();
    if (
      box &&
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    )
      liftPill(true);
    pillDrag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      from: tabPosition.current,
      slot: (event.currentTarget.clientWidth - 8) / HOME_TABS.length,
      position: tabPosition.current,
      lastX: event.clientX,
      lastAt: performance.now(),
      velocity: 0,
      active: false,
    };
  };
  const pillMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = pillDrag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    if (!state.active) {
      if (Math.abs(dx) < 6 && Math.abs(event.clientY - state.y) < 6) return;
      if (Math.abs(event.clientY - state.y) > Math.abs(dx)) {
        pillDrag.current = null;
        liftPill(false);
        return;
      }
      state.active = true;
      pillDragged.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Sem captura, o arrasto segue enquanto o dedo está no trilho.
      }
    }
    const now = performance.now();
    const step = (event.clientX - state.lastX) / state.slot;
    const elapsed = Math.max(1, now - state.lastAt);
    state.velocity = state.velocity * 0.6 + (step / elapsed) * 0.4;
    state.lastX = event.clientX;
    state.lastAt = now;
    const last = HOME_TABS.length - 1;
    const raw = state.from + dx / state.slot;
    // Nas pontas, pesa.
    state.position =
      raw < 0 ? raw * 0.3 : raw > last ? last + (raw - last) * 0.3 : raw;
    window.cancelAnimationFrame(pillFrame.current);
    pillFrame.current = window.requestAnimationFrame(() =>
      pager.current?.scrub(state.position),
    );
  };
  const pillUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = pillDrag.current;
    pillDrag.current = null;
    liftPill(false);
    if (!state || state.id !== event.pointerId || !state.active) return;
    window.cancelAnimationFrame(pillFrame.current);
    pager.current?.release(state.position, state.velocity);
  };

  /** A pílula e o negrito acompanham as páginas (`position` fracionária). */
  const placeTabs = useCallback((position: number, timing: string) => {
    tabPosition.current = position;
    const move = timing ? `transform ${timing}` : 'none';
    const indicator = indicatorRef.current;
    const labels = boldLabelsRef.current;
    if (indicator) {
      indicator.style.transition = move;
      indicator.style.transform = `translate3d(${position * 100}%, 0, 0)`;
    }
    if (labels) {
      labels.style.transition = move;
      labels.style.transform = `translate3d(${(-position * 100) / 3}%, 0, 0)`;
    }
  }, []);
  const fetchOverview = useCallback(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const [entryResult, cardResult, pending] = await Promise.all([
        loadFinancialEntries(client),
        client.from('payment_cards').select('*').order('account'),
        loadUnidentifiedSpend(client).catch(() => []),
      ]);
      // "Compra a chegar" (lib/unidentified-spend.ts) entra nos últimos gastos e
      // nos totais, nunca na revisão nem na lista de desejos.
      const results = [
        entryResult.data && !entryResult.error
          ? {
              ...entryResult,
              data: [
                ...(entryResult.data as FinancialEntry[]),
                ...pendingEntries(pending),
              ],
            }
          : entryResult,
        cardResult,
      ] as const;
      if (!results[0].error && !results[1].error) return results;
      if (attempt === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        await client.auth.refreshSession();
      } else {
        return results;
      }
    }
    throw new Error('Não foi possível carregar os dados financeiros.');
  }, [client]);
  /** Só redesenha se mudou. */
  const apply = useCallback(
    (nextEntries: FinancialEntry[], nextCards: PaymentCard[]) => {
      const signature = JSON.stringify([nextEntries, nextCards]);
      setReady(true);
      setError(false);
      if (overviewMemory?.signature === signature) return;
      overviewMemory = { entries: nextEntries, cards: nextCards, signature };
      setEntries(nextEntries);
      setCards(nextCards);
    },
    [],
  );
  const reload = useCallback(async () => {
    try {
      const [result, cardResult] = await fetchOverview();
      if (result.error || cardResult.error)
        throw result.error ?? cardResult.error;
      apply(result.data ?? [], (cardResult.data ?? []) as PaymentCard[]);
    } catch {
      setError(true);
    }
  }, [fetchOverview, apply]);
  useEffect(() => {
    let mounted = true;
    void fetchOverview()
      .then(([result, cardResult]) => {
        if (!mounted) return;
        if (result.error || cardResult.error) {
          setError(true);
          return;
        }
        apply(result.data ?? [], (cardResult.data ?? []) as PaymentCard[]);
      })
      .catch(() => {
        if (mounted) setError(true);
      });
    return () => {
      mounted = false;
    };
  }, [fetchOverview, apply]);
  useResumeRefresh(reload);
  // Reconfere por ~1 min: os bancos mandam gastos depois da primeira leitura.
  useEffect(
    () => subscribeManualRefresh(reload, { followUps: BANK_FOLLOW_UPS }),
    [reload],
  );
  // Só o que está no banco, sem as compras "a chegar".
  const recorded = useMemo(
    () => entries.filter((entry) => !isPendingSpend(entry)),
    [entries],
  );
  // Memorizados: recalcular a cada troca de aba travava o deslize.
  const summary = useMemo(() => summarizeFinances(entries), [entries]);
  const reserves = useMemo(
    () => calculatePortfolio(banks, rates),
    [banks, rates],
  );
  const week = useMemo(() => weeklySummary(entries), [entries]);
  const available = ready && !error;
  const expenseEntries = useMemo(
    () =>
      entries
        .filter(
          (entry) =>
            entry.entry_type === 'expense' &&
            new Date(entry.occurred_at) <= new Date(),
        )
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    [entries],
  );
  const sortedCards = useMemo(
    () =>
      sortPaymentCardsByUsage(
        cards,
        expenseEntries.map((entry) => entry.account),
      ),
    [cards, expenseEntries],
  );

  /* Conteúdo das abas montado uma vez enquanto os dados não mudam. */
  const tabPages = useMemo(() => {
    const shown = (amount: Decimal) => (available ? money(amount) : '—');
    return [
      <RecentExpenses
        key="gastos"
        entries={expenseEntries}
        cards={sortedCards}
        available={available}
        onOpen={setSelectedEntry}
        framed={false}
      />,
      <div key="semana">
        {available && (
          <WeeklyExpenseSummary
            entries={entries}
            reserveGain={portfolioEarnings(
              reserves,
              week.start,
              week.end,
            ).toFixed(2)}
            framed={false}
          />
        )}
        <section
          aria-label="Resumo do mês"
          className="grid min-w-0 grid-cols-2 gap-3 border-t p-4 md:p-5"
        >
          {[
            {
              label: 'Gastos do mês',
              amount: shown(summary.expenses),
              icon: ArrowUpRight,
              href: '/financeiro',
              note: 'Lançamentos registrados',
            },
            {
              label: 'Entrou no mês',
              amount: shown(summary.income),
              icon: ArrowDownLeft,
              href: '/resumo',
              note: 'Salário, Flash e entradas escolhidas',
            },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="min-w-0 rounded-2xl border bg-background/40 p-4 transition-colors hover:bg-muted/50"
            >
              <item.icon className="mb-5 size-4" />
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-2 break-words text-xl font-semibold tracking-tight tabular-nums">
                {item.amount}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {item.note}
              </p>
            </Link>
          ))}
        </section>
      </div>,
      <div key="cofrinhos" className="p-5 md:p-6">
        {/* Cofrinhos e lista de desejos: total em destaque, um cofrinho por linha e
            os desejos embaixo. Cofrinhos vêm da Pluggy. */}
        {banksLoading ? (
          <div className="grid gap-3" aria-hidden="true">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-8 w-44" />
            <Skeleton className="mt-2 h-14 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
          </div>
        ) : (
          <VaultCards banks={banks} rates={rates} list />
        )}
        <div className="mt-6 border-t pt-5">
          <WishlistCard entries={recorded} flat />
        </div>
      </div>,
    ];
  }, [
    expenseEntries,
    sortedCards,
    available,
    entries,
    reserves,
    week,
    summary,
    banksLoading,
    banks,
    rates,
    recorded,
  ]);

  // Cartão do mês fora das abas: não re-renderiza ao trocar.
  const balancesBlock = useMemo(
    () => (
      <div className="min-w-0">
        <AccountBalances />
        <RobotFreshness />
      </div>
    ),
    [],
  );
  const dialogs = (
    <>
      {entryOpen && (
        <ExpenseEntryDialog
          cards={sortedCards}
          onClose={() => setEntryOpen(false)}
          onSaved={(entry) => {
            setEntries((previous) => [entry, ...previous]);
            setReady(true);
            // Atualiza o cartão do mês também.
            void refreshWidgetsOnce();
          }}
        />
      )}
      {selectedEntry && (
        <EntryDetails
          key={selectedEntry.id}
          entry={selectedEntry}
          cards={sortedCards}
          onClose={() => setSelectedEntry(null)}
          onRuleApplied={reload}
          onSaved={(updated) => {
            setEntries((previous) =>
              previous.map((entry) =>
                entry.id === updated.id ? toTotalsView(updated) : entry,
              ),
            );
            void refreshWidgetsOnce();
          }}
          onDelete={async (id) => {
            const { error } = await client
              .from('financial_entries')
              .delete()
              .eq('id', id)
              .eq('user_id', selectedEntry.user_id);
            if (error) throw new Error(error.message);
            setEntries((previous) =>
              previous.filter((entry) => entry.id !== id),
            );
            setSelectedEntry(null);
            void refreshWidgetsOnce();
          }}
        />
      )}
    </>
  );
  const desktop = useMediaQuery('(min-width: 1024px)');
  /* Convite para a retrospectiva nos 3 primeiros dias do mês. */
  const recapInvite = available && recapIsFresh() && (
    <section className="flex items-center gap-3 rounded-3xl border bg-card px-5 py-4 shadow-sm md:px-6">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
        <Sparkles aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold first-letter:uppercase">
          Retrospectiva de {monthLabel(recapDefaultMonth()).split(' ')[0]}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Maior compra, dias sem gastar e quanto os cofrinhos renderam.
        </p>
      </div>
      <Link
        href="/retrospectiva"
        className="vetra-glass inline-flex min-h-9 shrink-0 items-center gap-1.5 px-3 text-xs font-medium"
      >
        <span className="hidden min-[430px]:inline">Ver</span>
        <ArrowRightSymbol className="size-3.5" />
      </Link>
    </section>
  );
  /* Abas da home: tocar ou arrastar troca, com as páginas seguindo o dedo. */
  return (
    <div className="space-y-7 md:space-y-9">
      {dialogs}
      {/* Registrar gasto é o "+" da barra do topo (`onEntryOpenChange`). */}
      <section>
        <p className="mb-2 text-xs uppercase tracking-[.18em] text-muted-foreground">
          Seu dinheiro, por inteiro
        </p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Visão geral
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Seus gastos sob controle. Seus cofrinhos acompanhados.
        </p>
      </section>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-sm"
        >
          <span>Não foi possível atualizar seus gastos.</span>
          <Button variant="outline" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {desktop ? (
        // Desktop: as três abas viram cartões lado a lado, sem deslizar.
        <div className="grid grid-cols-2 items-start gap-6">
          <div className="grid min-w-0 gap-6">
            {balancesBlock}
            {ready ? (
              <section className="overflow-hidden rounded-3xl border bg-card">
                {tabPages[0]}
              </section>
            ) : (
              !error && <Skeleton className="h-[34rem] rounded-3xl" />
            )}
          </div>
          <div className="grid min-w-0 gap-6">
            {ready ? (
              <>
                {recapInvite}
                <ReviewTeaser entries={recorded} />
                <section className="overflow-hidden rounded-3xl border bg-card">
                  {tabPages[1]}
                </section>
                <section className="overflow-hidden rounded-3xl border bg-card">
                  {tabPages[2]}
                </section>
              </>
            ) : (
              !error && (
                <>
                  <Skeleton className="h-72 rounded-3xl" />
                  <Skeleton className="h-80 rounded-3xl" />
                </>
              )
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Mês, bancos e dia (account-balances.tsx), fora do esqueleto: tem memória própria. */}
          {balancesBlock}
          {!ready && !error ? (
            <FinanceOverviewDataSkeleton />
          ) : (
            <>
              {recapInvite}
              <ReviewTeaser entries={recorded} />
              {/* Abas em pílula: a pílula clara desliza com o dedo, junto com as
                  páginas (swipe-pager.tsx). Sem vidro. */}
              <div className="min-w-0">
                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as HomeTab)}
                >
                  {/* Prefixo do grupo: o TabsList do shadcn força 32px na horizontal.
                      As abas por baixo ficam sempre cinza e sem transição: o destaque
                      é só a pílula (senão o branco da aba antiga some com atraso). */}
                  <TabsList
                    className="relative h-12 w-full touch-pan-y gap-0 rounded-full bg-muted/70 p-1 select-none group-data-horizontal/tabs:h-12"
                    onPointerDown={pillDown}
                    onPointerMove={pillMove}
                    onPointerUp={pillUp}
                    onPointerCancel={pillUp}
                    onClickCapture={(event) => {
                      // O arrasto termina num "clique": não troca de aba de novo.
                      if (!pillDragged.current) return;
                      pillDragged.current = false;
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    {HOME_TABS.map((value) => (
                      <TabsTrigger
                        key={value}
                        value={value}
                        className="relative h-full min-w-0 basis-0 rounded-full border-0 text-base font-normal text-muted-foreground shadow-none transition-none after:hidden hover:text-muted-foreground data-active:bg-transparent data-active:text-muted-foreground data-active:shadow-none dark:text-muted-foreground dark:hover:text-muted-foreground dark:data-active:border-transparent dark:data-active:bg-transparent dark:data-active:text-muted-foreground"
                      >
                        {TAB_LABELS[value]}
                      </TabsTrigger>
                    ))}
                    {/* A pílula: um terço do trilho. Dentro, os rótulos em negrito
                        andando ao contrário, então só o trecho sob ela fica destacado.
                        Tudo por transform (`placeTabs`). */}
                    <span className="pointer-events-none absolute inset-1">
                      <span
                        ref={indicatorRef}
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 z-10 w-1/3 will-change-transform"
                      >
                        {/* Só o fundo branco cresce ao segurar; o texto fica numa camada à
                            parte, do tamanho normal. */}
                        <span
                          ref={pillLiftRef}
                          className="absolute inset-0 rounded-full bg-foreground shadow-sm will-change-transform"
                        />
                        <span className="absolute inset-0 overflow-hidden rounded-full">
                          <span
                            ref={boldLabelsRef}
                            className="absolute inset-y-0 left-0 grid w-[300%] grid-cols-3 will-change-transform"
                          >
                            {HOME_TABS.map((value) => (
                              <span
                                key={value}
                                className="grid place-items-center text-base font-semibold text-background"
                              >
                                {TAB_LABELS[value]}
                              </span>
                            ))}
                          </span>
                        </span>
                      </span>
                    </span>
                  </TabsList>
                </Tabs>
                <div className="mt-3 rounded-3xl border bg-card">
                  <SwipePager
                    index={HOME_TABS.indexOf(tab)}
                    onChange={(index) => setTab(HOME_TABS[index])}
                    onPlace={placeTabs}
                    ref={pager}
                    pages={tabPages}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
