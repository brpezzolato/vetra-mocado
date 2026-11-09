'use client';

import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import Decimal from 'decimal.js';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Calculator,
  CreditCard,
  Home,
  ListChecks,
  PiggyBank as PiggyIcon,
  Plus,
  ReceiptText,
  Sparkles,
} from 'lucide-react';
import Link from '@/components/navigation-link';
import { Private } from '@/components/private-value';
import { RecentExpenses } from '@/components/recent-expenses';
import { ReviewTeaser } from '@/components/review-teaser';
import { RobotFreshness } from '@/components/robot-freshness';
import { VaultCards } from '@/components/vault-cards';
import { WishlistCard } from '@/components/wishlist-card';
import { WeeklyExpenseSummary } from '@/components/weekly-expense-summary';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRightSymbol } from '@/components/ui/glass-button';
import type { BalanceParts } from '@/components/account-balances';
import type { DailyRate, PiggyBank } from '@/lib/domain';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';
import { cardBankName, suggestedCardBank } from '@/lib/payment-cards';
import { calculatePortfolio, portfolioEarnings } from '@/lib/portfolio';
import { saoDate, weeklySummary } from '@/lib/expense-insights';
import type { summarizeFinances } from '@/lib/finance-overview';
import { money } from '@/lib/money';
import { cn } from '@/lib/utils';

/* Os 10 arranjos de teste da home (lib/home-layout.ts). Mesmas peças e
   mesmo visual da home atual; muda a ordem, o agrupamento e a disposição. */

const CARD = 'min-w-0 rounded-3xl border bg-card shadow-xs';

type Balance = BalanceParts | 'loading' | 'empty';

export type ArrangementProps = {
  layout: number;
  desktop: boolean;
  balance: Balance;
  entries: FinancialEntry[];
  /** Últimos gastos já filtrados (sem parcelas antigas), do mais novo. */
  recentEntries: FinancialEntry[];
  recorded: FinancialEntry[];
  cards: PaymentCard[];
  available: boolean;
  onOpen: (entry: FinancialEntry) => void;
  onAdd: () => void;
  banks: PiggyBank[];
  rates: DailyRate[];
  banksLoading: boolean;
  reserves: ReturnType<typeof calculatePortfolio>;
  week: ReturnType<typeof weeklySummary>;
  summary: ReturnType<typeof summarizeFinances>;
  /** As abas em pílula da home atual (Gastos, Semana, Cofrinhos). */
  tabs: ReactNode;
  recap: ReactNode;
};

/** "Gastos do mês" e "Entrou no mês", os dois quadros da aba Semana. */
export function MonthTotals({
  summary,
  available,
  className,
}: {
  summary: ReturnType<typeof summarizeFinances>;
  available: boolean;
  className?: string;
}) {
  return (
    <section
      aria-label="Resumo do mês"
      className={cn('grid min-w-0 grid-cols-2 gap-3', className)}
    >
      {[
        {
          label: 'Gastos do mês',
          amount: summary.expenses,
          icon: ArrowUpRight,
          href: '/financeiro',
          note: 'Lançamentos registrados',
        },
        {
          label: 'Entrou no mês',
          amount: summary.income,
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
            {available ? <Private>{money(item.amount)}</Private> : '—'}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">{item.note}</p>
        </Link>
      ))}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[.14em] text-muted-foreground">
      {children}
    </p>
  );
}

/** Barra fina de quanto do dia já foi. */
function DayBar({ percent, over }: { percent: number; over: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
    >
      <span
        className={cn(
          'block h-full rounded-full',
          over ? 'bg-destructive' : 'bg-emerald-500',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Barras da semana, domingo a sábado; hoje em destaque. */
function WeekBars({ week }: { week: ReturnType<typeof weeklySummary> }) {
  const today = saoDate(new Date());
  const max = Math.max(1, ...week.days.map((day) => Number(day.total ?? 0)));
  return (
    <div>
      <div aria-hidden="true" className="flex h-16 items-end gap-1.5">
        {week.days.map((day) => (
          <span
            key={day.day}
            className={cn(
              'block flex-1 rounded-t-md rounded-b-sm',
              day.day === today ? 'bg-foreground' : 'bg-muted',
            )}
            style={{
              height: `${Math.max(6, (Number(day.total ?? 0) / max) * 100)}%`,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex text-[10px] text-muted-foreground">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((letter, index) => (
          <span key={index} className="flex-1 text-center">
            {letter}
          </span>
        ))}
      </div>
    </div>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

export function HomeArrangement(props: ArrangementProps) {
  const {
    layout,
    desktop,
    balance,
    entries,
    recentEntries,
    recorded,
    cards,
    available,
    onOpen,
    onAdd,
    banks,
    rates,
    banksLoading,
    reserves,
    week,
    summary,
    tabs,
    recap,
  } = props;
  const parts = typeof balance === 'string' ? null : balance;
  const todayKey = saoDate(new Date());
  const [bankFilter, setBankFilter] = useState('all');

  /* ---------- peças ---------- */
  const skeleton = (height = 'h-56') =>
    balance === 'loading' ? (
      <Skeleton className={cn(height, 'rounded-3xl')} />
    ) : null;
  const withParts = (render: (b: BalanceParts) => ReactNode, height?: string) =>
    parts ? render(parts) : skeleton(height);

  const monthLabel = (b: BalanceParts) => (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        Ainda dá para gastar no mês
      </p>
      {b.configButton}
    </div>
  );
  const monthCompact = (o: { pills?: boolean; size?: string } = {}) =>
    withParts((b) => (
      <section className={cn(CARD, 'px-5 py-4')}>
        {monthLabel(b)}
        <p
          className={cn(
            'font-semibold tracking-tight tabular-nums',
            o.size ?? 'text-3xl',
          )}
        >
          {b.room}
        </p>
        <div className="mt-3">{b.roomBar}</div>
        {b.summary}
        {o.pills !== false && <div className="mt-4">{b.pills}</div>}
      </section>
    ));
  const fullCard = () => withParts((b) => b.card, 'h-80');
  const todayCard = (big = false) =>
    withParts(
      (b) =>
        b.today(big) && (
          <section className={cn(CARD, big ? 'p-6' : 'px-5 py-4')}>
            {b.today(big)}
          </section>
        ),
      'h-32',
    );
  const recent = (pageSize = 5, list = recentEntries) => (
    <RecentExpenses
      entries={list}
      cards={cards}
      available={available}
      onOpen={onOpen}
      pageSize={pageSize}
    />
  );
  const reserveGain = portfolioEarnings(reserves, week.start, week.end).toFixed(
    2,
  );
  const weekCard = () =>
    available ? (
      <WeeklyExpenseSummary entries={entries} reserveGain={reserveGain} />
    ) : null;
  const totals = () => <MonthTotals summary={summary} available={available} />;
  const vaults = (wish = true) => (
    <section className={cn(CARD, 'p-5 md:p-6')}>
      {banksLoading ? (
        <div className="grid gap-3" aria-hidden="true">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="mt-2 h-14 rounded-2xl" />
        </div>
      ) : (
        <VaultCards banks={banks} rates={rates} list />
      )}
      {wish && (
        <div className="mt-6 border-t pt-5">
          <WishlistCard entries={recorded} flat />
        </div>
      )}
    </section>
  );
  const review = <ReviewTeaser entries={recorded} />;
  const robot = <RobotFreshness />;
  const vaultToday = portfolioEarnings(reserves, todayKey, todayKey);
  const registerButton = (
    <button
      type="button"
      onClick={onAdd}
      className="vetra-glass vetra-glass-primary inline-flex h-12 w-full items-center justify-center gap-2 text-sm font-semibold"
    >
      <Plus className="size-4" /> Registrar gasto
    </button>
  );

  /** Gastos de hoje com quanto sobrou do dia depois de cada um (L7). */
  const todayTimeline = (() => {
    const list = recentEntries
      .filter(
        (entry) =>
          saoDate(entry.occurred_at) === todayKey &&
          !entry.excluded_from_totals &&
          !entry.excluded_from_daily,
      )
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    return list;
  })();

  /** Bancos dos últimos gastos, do mais usado, para o filtro (L5). */
  const filterBanks = (() => {
    const count = new Map<string, number>();
    for (const entry of recentEntries) {
      const id = suggestedCardBank(entry.account);
      count.set(id, (count.get(id) ?? 0) + 1);
    }
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
  })();
  const filtered =
    bankFilter === 'all'
      ? recentEntries
      : recentEntries.filter(
          (entry) => suggestedCardBank(entry.account) === bankFilter,
        );

  const kpi = (
    label: string,
    value: ReactNode,
    note: ReactNode,
    extra?: ReactNode,
  ) => (
    <div className={cn(CARD, 'rounded-2xl p-4')}>
      <Label>{label}</Label>
      <p className="mt-2 truncate text-xl font-semibold tracking-tight tabular-nums md:text-2xl">
        {value}
      </p>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
      {extra && <div className="mt-2.5">{extra}</div>}
    </div>
  );
  const kpis = (b: BalanceParts | null) => (
    <div className={cn('grid gap-3', desktop ? 'grid-cols-4' : 'grid-cols-2')}>
      {kpi('Mês', b ? b.room : '—', 'ainda dá para gastar')}
      {kpi(
        'Hoje',
        b?.todayNumbers ? <Private>{money(b.todayNumbers.left)}</Private> : '—',
        b?.todayNumbers ? (
          <>
            de <Private>{money(b.todayNumbers.allowance)}</Private>
          </>
        ) : (
          'sem valor do dia'
        ),
        b?.todayNumbers && (
          <DayBar percent={b.todayNumbers.percent} over={b.todayNumbers.over} />
        ),
      )}
      <div className={cn(CARD, 'rounded-2xl p-4')}>
        <Label>No azul</Label>
        <div className="mt-2">{b?.blueDays || '—'}</div>
      </div>
      {kpi(
        'Cofrinhos',
        <Private>{money(reserves.netBalance)}</Private>,
        <span className="text-emerald-600 dark:text-emerald-400">
          +<Private>{money(vaultToday)}</Private> hoje
        </span>,
      )}
    </div>
  );

  /* ---------- arranjos ---------- */
  const root = (children: ReactNode) => (
    <div className="space-y-6 pb-24 md:space-y-8">{children}</div>
  );
  const twoCols = (left: ReactNode, right: ReactNode, cols: string) => (
    <div className={cn('grid items-start gap-6', cols)}>
      <div className="grid min-w-0 gap-6">{left}</div>
      <div className="grid min-w-0 gap-6">{right}</div>
    </div>
  );

  switch (layout) {
    // 1. Hoje no topo
    case 1: {
      const hero = withParts(
        (b) => (
          <section className={cn('grid gap-4', desktop && cn(CARD, 'p-6'))}>
            {b.today(true)}
            {registerButton}
          </section>
        ),
        'h-40',
      );
      return root(
        desktop ? (
          twoCols(
            <>
              {hero}
              {monthCompact({ size: 'text-2xl' })}
              {robot}
            </>,
            <>
              {recap}
              {review}
              {recent(6)}
              {weekCard()}
              {vaults()}
            </>,
            'grid-cols-[5fr_7fr]',
          )
        ) : (
          <>
            {hero}
            {monthCompact({ size: 'text-2xl' })}
            {robot}
            {recap}
            {review}
            {tabs}
          </>
        ),
      );
    }

    // 2. Um cartão, três visões
    case 2: {
      const hero = withParts(
        (b) => (
          <section className={cn(CARD, 'p-5 md:p-6')}>
            <Tabs defaultValue="hoje">
              <TabsList className="w-full">
                <TabsTrigger value="hoje">Hoje</TabsTrigger>
                <TabsTrigger value="mes">Mês</TabsTrigger>
                <TabsTrigger value="semana">Semana</TabsTrigger>
              </TabsList>
              <TabsContent value="hoje" className="pt-4">
                {b.today(true) ?? (
                  <p className="text-sm text-muted-foreground">
                    Sem valor do dia.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="mes" className="pt-4">
                {monthLabel(b)}
                <p className="text-5xl font-semibold tracking-tight tabular-nums">
                  {b.room}
                </p>
                <div className="mt-3">{b.roomBar}</div>
                {b.summary}
              </TabsContent>
              <TabsContent value="semana" className="grid gap-4 pt-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Gasto na semana
                  </p>
                  <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
                    <Private>{money(new Decimal(week.total))}</Private>
                  </p>
                </div>
                <WeekBars week={week} />
              </TabsContent>
            </Tabs>
            <div className="mt-5 border-t pt-4">{b.pills}</div>
          </section>
        ),
        'h-72',
      );
      return root(
        desktop ? (
          twoCols(
            <>
              {hero}
              {vaults()}
              {robot}
            </>,
            <>
              {recap}
              {review}
              {recent(8)}
            </>,
            'grid-cols-[7fr_5fr]',
          )
        ) : (
          <>
            {hero}
            {robot}
            {recap}
            {review}
            {recent(5)}
            {vaults()}
          </>
        ),
      );
    }

    // 3. Faixa de números
    case 3:
      return root(
        <>
          {balance === 'loading' ? (
            <Skeleton className="h-28 rounded-3xl" />
          ) : (
            kpis(parts)
          )}
          {desktop ? (
            twoCols(
              <>{recent(12)}</>,
              <>
                {recap}
                {review}
                {weekCard()}
                {robot}
              </>,
              'grid-cols-[8fr_4fr]',
            )
          ) : (
            <>
              {robot}
              {recap}
              {review}
              {recent(10)}
              {weekCard()}
            </>
          )}
        </>,
      );

    // 4. Rolagem única
    case 4: {
      const title = (
        <section>
          <p className="mb-2 text-xs uppercase tracking-[.18em] text-muted-foreground">
            Seu dinheiro, por inteiro
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Visão geral
          </h1>
        </section>
      );
      return root(
        desktop ? (
          <>
            {title}
            <div className="grid grid-cols-3 items-start gap-6">
              <div className="grid min-w-0 gap-6">
                {fullCard()}
                {robot}
              </div>
              <div className="grid min-w-0 gap-6">
                {recap}
                {review}
                {recent(6)}
              </div>
              <div className="grid min-w-0 gap-6">
                {weekCard()}
                {totals()}
                {vaults()}
              </div>
            </div>
          </>
        ) : (
          <>
            {title}
            {fullCard()}
            {robot}
            {recap}
            {review}
            {recent(3)}
            {weekCard()}
            {totals()}
            {vaults()}
          </>
        ),
      );
    }

    // 5. Bancos primeiro
    case 5: {
      const lead = withParts(
        (b) => (
          <section>
            {monthLabel(b)}
            <p className="text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
              {b.room}
            </p>
            {b.summary}
          </section>
        ),
        'h-24',
      );
      const bankCards = withParts((b) => (
        <div
          className={cn('grid gap-3', desktop ? 'grid-cols-1' : 'grid-cols-2')}
        >
          {b.banks.map((item) => (
            <Link
              key={item.bank}
              href={`/bancos/${item.bank}`}
              className={cn(
                CARD,
                'rounded-2xl p-4 transition-colors hover:bg-muted/50',
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border bg-background">
                  <Image
                    src={item.logo}
                    alt=""
                    width={18}
                    height={18}
                    unoptimized
                    className="size-[18px] object-contain"
                  />
                </span>
                <span className="truncate text-sm font-medium">
                  {item.name}
                </span>
              </span>
              <p className="mt-3 text-lg font-semibold tracking-tight tabular-nums">
                <Private>{money(item.balance)}</Private>
              </p>
              {item.limit > 0 && (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    limite livre <Private>{money(item.free)}</Private>
                  </p>
                  <div
                    aria-hidden="true"
                    className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/10"
                  >
                    <span
                      className="block h-full rounded-full bg-foreground/60"
                      style={{
                        width: `${Math.min(100, (item.free / item.limit) * 100)}%`,
                      }}
                    />
                  </div>
                </>
              )}
            </Link>
          ))}
        </div>
      ));
      const filterRow = (
        <ScrollArea orientation="horizontal" className="scroll-bleed">
          <div className="flex gap-2 py-0.5">
            {['all', ...filterBanks].map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={bankFilter === id}
                onClick={() => setBankFilter(id)}
                className={cn(
                  'vetra-glass inline-flex h-9 shrink-0 items-center px-4 text-xs font-medium',
                  bankFilter === id && 'vetra-glass-primary',
                )}
              >
                {id === 'all'
                  ? 'Todos'
                  : cardBankName(id as ReturnType<typeof suggestedCardBank>)}
              </button>
            ))}
          </div>
        </ScrollArea>
      );
      const spends = (
        <div className="grid min-w-0 gap-3">
          {filterRow}
          {recent(6, filtered)}
        </div>
      );
      return root(
        desktop ? (
          <div className="grid grid-cols-[320px_minmax(0,1fr)] items-start gap-8">
            <div className="grid min-w-0 gap-5">
              {lead}
              {bankCards}
              {robot}
            </div>
            <div className="grid min-w-0 gap-6">
              {todayCard()}
              {twoCols(
                spends,
                <>
                  {recap}
                  {review}
                  {weekCard()}
                </>,
                'grid-cols-[3fr_2fr]',
              )}
            </div>
          </div>
        ) : (
          <>
            {lead}
            {bankCards}
            {robot}
            {todayCard()}
            {recap}
            {review}
            {spends}
          </>
        ),
      );
    }

    // 6. Navegação embaixo
    case 6: {
      const nav = [
        { href: '/', label: 'Início', icon: Home },
        { href: '/financeiro', label: 'Gastos', icon: ReceiptText },
        { href: '/faturas', label: 'Faturas', icon: CreditCard },
        { href: '/cofrinhos', label: 'Cofrinhos', icon: PiggyIcon },
        { href: '/assistente', label: 'Vetra AI', icon: Sparkles },
      ];
      if (desktop)
        return root(
          <div className="grid grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-6">
            <nav
              aria-label="Seções"
              className={cn(CARD, 'sticky top-24 grid gap-1 p-3')}
            >
              <button
                type="button"
                onClick={onAdd}
                className="vetra-glass vetra-glass-primary mb-2 inline-flex h-11 items-center justify-center gap-2 text-sm font-semibold"
              >
                <Plus className="size-4" /> Novo lançamento
              </button>
              {[
                ...nav,
                { href: '/resumo', label: 'Resumo', icon: BarChart3 },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60',
                    item.href === '/' && 'bg-muted font-medium text-foreground',
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="grid min-w-0 gap-6">
              {fullCard()}
              {recent(6)}
            </div>
            <div className="grid min-w-0 gap-6">
              {recap}
              {review}
              {weekCard()}
              {vaults()}
            </div>
          </div>,
        );
      return (
        <div className="space-y-6 pb-40">
          {fullCard()}
          {robot}
          {recap}
          {review}
          {tabs}
          <button
            type="button"
            aria-label="Novo lançamento"
            onClick={onAdd}
            className="vetra-glass vetra-glass-primary vetra-home-fab fixed right-5 z-30 grid size-14 place-items-center"
          >
            <Plus className="size-6" />
          </button>
          <nav
            aria-label="Seções"
            className="vetra-home-tabbar fixed inset-x-3 z-30 flex items-center justify-around rounded-[2rem] border bg-card/85 px-2 py-2 shadow-lg backdrop-blur-xl"
          >
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex min-w-14 flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-[10.5px] text-muted-foreground',
                  item.href === '/' && 'font-semibold text-foreground',
                )}
              >
                <item.icon className="size-5" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      );
    }

    // 7. Diário do dia
    case 7: {
      const timeline = withParts((b) => {
        const left = b.todayNumbers?.left ?? new Decimal(0);
        // Do fim para o começo: depois da última compra sobra o "hoje ainda dá".
        let after = left;
        const rows = [...todayTimeline]
          .reverse()
          .map((entry) => {
            const row = { entry, after };
            after = after.plus(entry.amount);
            return row;
          })
          .reverse();
        return (
          <section className={cn(CARD, 'p-5 md:p-6')}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">Seu dia</h2>
              <span className="text-xs text-muted-foreground">
                {rows.length === 1 ? '1 gasto' : `${rows.length} gastos`}
              </span>
            </div>
            <ol className="relative mt-3 grid before:absolute before:top-4 before:bottom-4 before:left-[7px] before:w-0.5 before:bg-border">
              <li className="relative flex items-center justify-between gap-3 py-3 pl-7">
                <span className="absolute left-0 size-4 rounded-full border-2 border-foreground bg-background" />
                <span className="text-sm">Começou o dia com</span>
                <span className="text-sm font-semibold tabular-nums">
                  {b.todayNumbers ? (
                    <Private>{money(b.todayNumbers.allowance)}</Private>
                  ) : (
                    '—'
                  )}
                </span>
              </li>
              {rows.map(({ entry, after: rest }, index) => (
                <li key={entry.id} className="relative border-t pl-7">
                  <span
                    className={cn(
                      'absolute top-1/2 left-0 size-4 -translate-y-1/2 rounded-full border-2',
                      index === rows.length - 1
                        ? 'border-emerald-500 bg-emerald-500'
                        : 'border-foreground bg-background',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => onOpen(entry)}
                    aria-label={`Abrir ${entry.description}`}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {entry.description}
                      </span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {time(entry.occurred_at)} · −
                        <Private>{money(entry.amount)}</Private>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[11px] text-muted-foreground">
                        sobrou
                      </span>
                      <span className="block text-sm font-semibold tabular-nums">
                        <Private>{money(rest)}</Private>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {!rows.length && (
              <p className="pb-2 text-sm text-muted-foreground">
                Nenhum gasto hoje ainda.
              </p>
            )}
            <button
              type="button"
              onClick={onAdd}
              className="vetra-glass mt-3 inline-flex h-11 w-full items-center justify-center gap-2 text-sm font-medium"
            >
              <Plus className="size-4" /> Registrar o próximo
            </button>
          </section>
        );
      }, 'h-64');
      const hero = withParts((b) => b.today(true), 'h-32');
      return root(
        desktop ? (
          <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-8">
            <div className="grid min-w-0 gap-6">
              {hero}
              {timeline}
              {recent(5)}
            </div>
            <div className="sticky top-24 grid min-w-0 gap-6">
              {monthCompact({ size: 'text-2xl' })}
              {recap}
              {review}
              {robot}
            </div>
          </div>
        ) : (
          <>
            {hero}
            {timeline}
            {recap}
            {review}
            {recent(5)}
            {monthCompact({ size: 'text-2xl' })}
            {robot}
          </>
        ),
      );
    }

    // 8. Abas no comando
    case 8: {
      const items = [
        {
          value: 'hoje',
          label: 'Hoje',
          note: parts?.todayNumbers ? (
            <Private>{money(parts.todayNumbers.left)}</Private>
          ) : null,
          body: (
            <>
              {todayCard(true)}
              {review}
              {recent(5)}
            </>
          ),
        },
        {
          value: 'semana',
          label: 'Semana',
          note: <Private>{money(new Decimal(week.total))}</Private>,
          body: (
            <>
              {weekCard()}
              {totals()}
            </>
          ),
        },
        {
          value: 'mes',
          label: 'Mês',
          note: parts ? parts.room : null,
          body: (
            <>
              {monthCompact({ size: 'text-4xl' })}
              {totals()}
              {recap}
            </>
          ),
        },
        {
          value: 'cofrinhos',
          label: 'Cofrinhos',
          note: <Private>{money(reserves.netBalance)}</Private>,
          body: vaults(),
        },
      ];
      return root(
        <>
          <Tabs
            defaultValue="hoje"
            orientation={desktop ? 'vertical' : 'horizontal'}
            className={
              desktop
                ? 'grid grid-cols-[240px_minmax(0,1fr)] items-start gap-8'
                : undefined
            }
          >
            <TabsList
              className={
                desktop
                  ? 'sticky top-24 w-full gap-1 bg-transparent p-0'
                  : 'h-11 w-full rounded-full p-1 group-data-horizontal/tabs:h-11'
              }
            >
              {items.map((item) => (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className={
                    desktop
                      ? 'h-auto flex-col items-start gap-0.5 rounded-2xl px-4 py-3 data-active:bg-card data-active:shadow-xs'
                      : 'rounded-full'
                  }
                >
                  <span className="text-sm font-semibold">{item.label}</span>
                  {desktop && item.note && (
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                      {item.note}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {items.map((item) => (
              <TabsContent
                key={item.value}
                value={item.value}
                className={cn('grid min-w-0 gap-6', !desktop && 'pt-4')}
              >
                {item.body}
              </TabsContent>
            ))}
          </Tabs>
          {robot}
        </>,
      );
    }

    // 9. Atalhos e avisos
    case 9: {
      const hero = withParts(
        (b) => (
          <section className={cn(CARD, 'px-5 py-4')}>
            {monthLabel(b)}
            <p className="text-3xl font-semibold tracking-tight tabular-nums md:text-4xl">
              {b.room}
            </p>
            <div className="mt-3">{b.roomBar}</div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                Hoje:{' '}
                {b.todayNumbers ? (
                  <b className="font-semibold text-foreground tabular-nums">
                    <Private>{money(b.todayNumbers.left)}</Private>
                  </b>
                ) : (
                  '—'
                )}
              </span>
              {b.blueDays}
            </div>
          </section>
        ),
        'h-40',
      );
      const shortcut =
        'vetra-glass flex h-20 flex-col items-center justify-center gap-2 rounded-3xl text-xs font-medium md:h-24';
      const actions = (
        <div className="grid grid-cols-4 gap-2 md:gap-4">
          <button type="button" onClick={onAdd} className={shortcut}>
            <Plus className="size-5" />
            Registrar
          </button>
          <Link href="/revisao" className={shortcut}>
            <ListChecks className="size-5" />
            Revisar
          </Link>
          <Link href="/faturas" className={shortcut}>
            <CreditCard className="size-5" />
            Faturas
          </Link>
          <Link href="/simulador" className={shortcut}>
            <Calculator className="size-5" />
            Simular
          </Link>
        </div>
      );
      const needs = (
        <section className="grid gap-3">
          <h2 className="font-semibold">Precisa de você</h2>
          {recap}
          {review}
          <div className={cn(CARD, 'px-5 py-4')}>{robot}</div>
        </section>
      );
      return root(
        desktop ? (
          twoCols(
            <>
              {hero}
              {actions}
              {recent(6)}
            </>,
            <>
              {needs}
              {vaults(false)}
              {weekCard()}
            </>,
            'grid-cols-[8fr_4fr]',
          )
        ) : (
          <>
            {hero}
            {actions}
            {needs}
            {recent(5)}
          </>
        ),
      );
    }

    // 10. Widgets
    case 10: {
      const tile = (area: string, body: ReactNode, href?: string) => {
        const className = cn(CARD, 'flex flex-col gap-2 p-4 md:p-5', area);
        return href ? (
          <Link
            href={href}
            className={cn(className, 'transition-colors hover:bg-muted/40')}
          >
            {body}
          </Link>
        ) : (
          <section className={className}>{body}</section>
        );
      };
      const b = parts;
      const grid = (
        <div
          className={cn(
            'grid gap-3 md:gap-5',
            desktop ? 'grid-cols-4' : 'grid-cols-2',
          )}
        >
          {tile(
            desktop ? 'col-span-2 row-span-2' : 'col-span-2',
            b ? (
              <>
                {monthLabel(b)}
                <p className="text-3xl font-semibold tracking-tight tabular-nums md:text-4xl">
                  {b.room}
                </p>
                <div className="mt-1">{b.roomBar}</div>
                {b.summary}
                {desktop && <div className="mt-3">{b.pills}</div>}
              </>
            ) : (
              <Skeleton className="h-24" />
            ),
          )}
          {tile(
            '',
            <>
              <Label>Hoje</Label>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {b?.todayNumbers ? (
                  <Private>{money(b.todayNumbers.left)}</Private>
                ) : (
                  '—'
                )}
              </p>
              {b?.todayNumbers && (
                <DayBar
                  percent={b.todayNumbers.percent}
                  over={b.todayNumbers.over}
                />
              )}
            </>,
          )}
          {tile(
            '',
            <>
              <Label>No azul</Label>
              <div className="mt-1">{b?.blueDays || '—'}</div>
            </>,
          )}
          {tile(
            '',
            <>
              <Label>Semana</Label>
              <p className="text-lg font-semibold tracking-tight tabular-nums">
                <Private>{money(new Decimal(week.total))}</Private>
              </p>
              <WeekBars week={week} />
            </>,
            '/resumo',
          )}
          {tile(
            '',
            <>
              <Label>Cofrinhos</Label>
              <p className="text-lg font-semibold tracking-tight tabular-nums">
                <Private>{money(reserves.netBalance)}</Private>
              </p>
              <p className="text-xs text-emerald-600 tabular-nums dark:text-emerald-400">
                +<Private>{money(vaultToday)}</Private> hoje
              </p>
              <span className="mt-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                Ver cofrinhos <ArrowRightSymbol className="size-3" />
              </span>
            </>,
            '/cofrinhos',
          )}
          <div className={cn('min-w-0', desktop ? 'col-span-2' : 'col-span-2')}>
            {recent(5)}
          </div>
          <div className="col-span-2 grid min-w-0 content-start gap-3 md:gap-5">
            {review}
            {recap}
            {b && (
              <section className={cn(CARD, 'grid gap-3 p-4 md:p-5')}>
                <Label>Contas</Label>
                {b.banks.map((item) => (
                  <Link
                    key={item.bank}
                    href={`/bancos/${item.bank}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex items-center gap-2.5">
                      <Image
                        src={item.logo}
                        alt=""
                        width={20}
                        height={20}
                        unoptimized
                        className="size-5 object-contain"
                      />
                      {item.name}
                    </span>
                    <span className="font-semibold tabular-nums">
                      <Private>{money(item.balance)}</Private>
                    </span>
                  </Link>
                ))}
              </section>
            )}
            {robot}
          </div>
        </div>
      );
      return root(grid);
    }

    default:
      return null;
  }
}
