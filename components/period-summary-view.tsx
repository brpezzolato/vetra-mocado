'use client';

import { useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import {
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CreditCard,
  Repeat2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { EntryDetails } from '@/components/entry-details';
import { ExpenseDayList } from '@/components/expense-line';
import { BlueDaysBadge } from '@/components/streak-badge';
import { toTotalsView } from '@/lib/entry-share';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import type { CardInvoiceInputs } from '@/lib/card-invoices-query';
import { saoDate, type RecurringExpense } from '@/lib/expense-insights';
import { monthCalendar, type CalendarEventKind } from '@/lib/month-calendar';
import {
  daysInTheBlue,
  provisionalSince,
  settlesOn,
  spentByDayOf,
  type AllowanceDay,
} from '@/lib/daily-allowance';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import type { FinancialEntry } from '@/lib/financial-tracker';
import {
  cardBankName,
  suggestedCardBank,
  type PaymentCard,
} from '@/lib/payment-cards';
import {
  pendingEntries,
  type UnidentifiedSpend,
} from '@/lib/unidentified-spend';
import { calculatePortfolio } from '@/lib/portfolio';
import { useVaultData } from '@/lib/use-vault-data';
import { daySummary, monthLabel, monthSummary } from '@/lib/period-summary';

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value || 0).toDecimalPlaces(2).toNumber());

/** "Minha Reserva +R$ 0,46": dica do resumo do dia. O <Private> do Headline mascara. */
const vaultLabel = (item: { name: string; net: Decimal }) =>
  `${item.name} +${money(item.net)}`;

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date(`${day}T12:00:00Z`));

const shiftDay = (day: string, by: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
};

const shiftMonth = (month: string, by: number) => {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

type Tone = 'default' | 'positive' | 'negative';

const toneClass = (tone: Tone = 'default') =>
  tone === 'positive'
    ? 'text-emerald-500'
    : tone === 'negative'
      ? 'text-destructive'
      : '';

type Stat = {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
};

/** Número principal grande; secundários numa faixa embaixo. */
function Headline({
  caption,
  value,
  tone,
  stats,
}: {
  caption: string;
  value: string;
  tone?: Tone;
  stats: Stat[];
}) {
  return (
    <>
      <p className="mt-4 text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {caption}
      </p>
      <p
        className={`mt-1 text-4xl font-semibold tabular-nums md:text-5xl ${toneClass(tone)}`}
      >
        <Private>{value}</Private>
      </p>
      {stats.length > 0 && (
        <dl
          className={`mt-6 grid gap-4 border-t pt-5 sm:gap-6 ${
            stats.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
          }`}
        >
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd
                className={`mt-1 text-lg font-semibold tabular-nums ${toneClass(stat.tone)}`}
              >
                <Private>{stat.value}</Private>
              </dd>
              {/* Private: a dica carrega números. */}
              {stat.hint && (
                <dd className="mt-0.5 text-xs text-muted-foreground">
                  <Private>{stat.hint}</Private>
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

/**
 * Valor do dia no resumo diário: quanto dava para gastar, termômetro e
 * sequência no azul. Provisório nos 3 dias úteis em que compras ainda chegam.
 */
function DayAllowance({
  day,
  today,
  allowances,
  spentByDay,
  pending,
}: {
  day: string;
  today: string;
  allowances: AllowanceDay[];
  spentByDay: Record<string, Decimal>;
  pending: UnidentifiedSpend[];
}) {
  const stored = allowances.find((item) => item.day === day);
  if (!stored) {
    if (!allowances.length) return null;
    return (
      <p className="rounded-2xl border border-dashed p-4 text-xs text-muted-foreground">
        Sem valor do dia: o Vetra não foi aberto neste dia, então ele não entra
        na sequência no azul.
      </p>
    );
  }
  const allowance = new Decimal(stored.allowance);
  const spent = spentByDay[day] ?? new Decimal(0);
  const over = spent.gt(allowance);
  const percent = allowance.gt(0)
    ? Math.min(100, spent.div(allowance).times(100).toNumber())
    : spent.gt(0)
      ? 100
      : 0;
  const blueDays = daysInTheBlue({
    today: day,
    now: today,
    allowances,
    spentByDay,
  });
  const provisional = day >= provisionalSince(today);
  const settles = settlesOn(day);
  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {day === today ? 'Hoje você pode' : 'Neste dia dava para gastar'}
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
            <Private>{money(allowance)}</Private>
          </p>
        </div>
        <p className="shrink-0 text-right text-xs text-muted-foreground">
          {blueDays.total > 0 ? (
            <BlueDaysBadge
              total={blueDays.total}
              provisional={blueDays.provisional}
            />
          ) : (
            'Nenhum dia no azul ainda'
          )}
          <br />
          {day === today ? 'até agora' : 'até este dia'}
        </p>
      </div>
      <div
        aria-hidden="true"
        className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10"
      >
        <span
          className={cn(
            'block h-full rounded-full',
            over ? 'bg-destructive' : 'bg-emerald-500',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p
        className={cn(
          'mt-2 text-xs',
          over ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {over ? (
          <>
            Passou <Private>{money(spent.minus(allowance))}</Private> do valor
            do dia · este dia não soma no azul
          </>
        ) : (
          <>
            Gastou <Private>{money(spent)}</Private> · sobraram{' '}
            <Private>{money(allowance.minus(spent))}</Private>
          </>
        )}
      </p>
      {pending.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          * Inclui{' '}
          {pending.map((item, index) => (
            <span key={item.account}>
              {index > 0 && ' e '}
              <Private>{money(item.amount)}</Private> no{' '}
              {cardBankName(suggestedCardBank(item.account))}
            </span>
          ))}{' '}
          que o limite já mostra, mas a compra ainda não chegou.
        </p>
      )}
      {provisional && (
        <p className="mt-3 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          Provisório até {settles.slice(8, 10)}/{settles.slice(5, 7)}: compras
          no cartão levam até 3 dias úteis para chegar, e o gasto, o valor e a
          sequência deste dia ainda podem mudar.
        </p>
      )}
    </section>
  );
}

/** Nada aqui ainda — dito sem uma caixa vazia do tamanho de um cartão. */
function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/** Ranking com barra proporcional à maior fatia (não a 100%). */
function Breakdown({
  title,
  rows,
  empty,
  bare = false,
  counts = false,
}: {
  title: string;
  rows: { name: string; total: string; count: number; share: number }[];
  empty: string;
  /** Sem caixa própria, para ir dentro de outro cartão. */
  bare?: boolean;
  /** Mostra quantas compras somam o valor, junto da porcentagem. */
  counts?: boolean;
}) {
  const largest = Math.max(...rows.map((row) => Number(row.total)), 0);
  return (
    <section className={bare ? undefined : 'rounded-2xl border bg-card p-4'}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length ? (
        <ul className="mt-3 space-y-2.5">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{row.name}</span>
                <span className="shrink-0 tabular-nums">
                  <Private>{money(row.total)}</Private>
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  aria-hidden="true"
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{
                      width: `${largest ? (Number(row.total) / largest) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {counts &&
                    `${row.count} ${row.count === 1 ? 'compra' : 'compras'} · `}
                  <span className="inline-block w-9">
                    {row.share.toFixed(0)}%
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

// Semana começa no domingo.
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const monthName = (month: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long' }).format(
    new Date(`${month}-15T12:00:00Z`),
  );

/** "Quarta-feira, 7 de outubro"; ano só fora do ano atual. */
const dayTitle = (day: string, today: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(day.slice(0, 4) !== today.slice(0, 4) && { year: 'numeric' }),
  }).format(new Date(`${day}T12:00:00Z`));

const shortDay = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;

// Cor por tipo (ponto, legenda e ícone): roxo fatura, azul recorrente,
// verde depósito Flash, âmbar fatura paga.
const KIND: Record<
  CalendarEventKind,
  { icon: LucideIcon; label: string; dot: string; soft: string }
> = {
  invoice: {
    icon: CreditCard,
    label: 'Fatura',
    dot: 'bg-violet-500',
    soft: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  },
  // O dia em que a fatura foi paga de verdade (data do banco).
  payment: {
    icon: CircleCheck,
    label: 'Pagamento',
    dot: 'bg-amber-500',
    soft: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  subscription: {
    icon: Repeat2,
    label: 'Assinatura',
    dot: 'bg-sky-500',
    soft: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  },
  benefit: {
    icon: Wallet,
    label: 'Flash',
    dot: 'bg-emerald-500',
    soft: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
};

/** Dia aberto ao chegar num mês: hoje, o último (passado) ou o primeiro (futuro). */
const dayToOpen = (month: string, today: string) =>
  month === today.slice(0, 7)
    ? today
    : month < today.slice(0, 7)
      ? `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`
      : `${month}-01`;

/* Resumo e Calendário numa tela. Em cima, cartão com o gasto do dia ou do
   mês (setas e arrasto). Embaixo, o calendário com pontos de fatura,
   pagamento, assinatura e Flash; tocar num dia abre o detalhe. Listas do mês
   em chips. */
export function PeriodSummaryView({
  entries: initialEntries,
  cards,
  allowances = [],
  unidentified = [],
  invoices,
  subscriptions = [],
}: {
  entries: FinancialEntry[];
  cards: PaymentCard[];
  /** Os valores do dia (`daily_allowances`). */
  allowances?: AllowanceDay[];
  /** Gasto no cartão ainda sem compra (lib/unidentified-spend.ts). */
  unidentified?: UnidentifiedSpend[];
  /** O que as faturas precisam, do mesmo carregamento da tela de Faturas. */
  invoices?: CardInvoiceInputs;
  subscriptions?: RecurringExpense[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [selected, setSelected] = useState<FinancialEntry | null>(null);
  const [todayIso] = useState(() => saoDate(new Date()));
  const [day, setDay] = useState(todayIso);
  const month = day.slice(0, 7);
  const [ranking, setRanking] = useState<
    'categoria' | 'conta' | 'lojas' | 'dias'
  >('categoria');
  const [dayDetail, setDayDetail] = useState(false);
  // O cartão do topo: o dia aberto ou o mês dele.
  const [view, setView] = useState<'dia' | 'mes'>('dia');
  // De que lado veio o último passo, para o conteúdo entrar deslizando dele.
  const [direction, setDirection] = useState(1);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  // Inclui "Compra a chegar" (lib/unidentified-spend.ts) na lista e nos totais.
  const counted = useMemo(
    () => [...entries, ...pendingEntries(unidentified)],
    [entries, unidentified],
  );
  const dayView = useMemo(() => daySummary(counted, day), [counted, day]);
  // O gasto de cada dia como o valor do dia o mede (lib/daily-allowance.ts).
  const spentByDay = useMemo(() => spentByDayOf(counted), [counted]);
  const monthView = useMemo(
    () => monthSummary(counted, month),
    [counted, month],
  );
  const calendarOf = (target: string) =>
    monthCalendar({
      month: target,
      today: todayIso,
      entries: counted,
      cards: invoices?.cards ?? [],
      cycles: invoices?.cycles ?? [],
      payments: invoices?.payments ?? [],
      subscriptions,
      invoiceEntries: invoices?.entries ?? [],
      bills: invoices?.bills ?? [],
      limits: invoices?.limits ?? [],
    });
  const calendar = useMemo(
    () =>
      monthCalendar({
        month,
        today: todayIso,
        entries: counted,
        cards: invoices?.cards ?? [],
        cycles: invoices?.cycles ?? [],
        payments: invoices?.payments ?? [],
        subscriptions,
        invoiceEntries: invoices?.entries ?? [],
        bills: invoices?.bills ?? [],
        limits: invoices?.limits ?? [],
      }),
    [month, todayIso, counted, invoices, subscriptions],
  );
  const calendarDay = calendar.days.find((item) => item.day === day);
  const upcoming = calendar.days.filter(
    (item) => item.events.length && item.day >= todayIso,
  );

  const delta = monthView.previous ? Number(monthView.previous.delta) : 0;
  const past = day <= todayIso;

  // Rendimento líquido dos cofrinhos por dia corrido (domingo mostra o IOF
  // que caiu nele).
  const { banks, rates, loading: vaultsLoading } = useVaultData();
  const vaultYield = useMemo(() => {
    if (!banks.length || !rates.length) return null;
    const portfolio = calculatePortfolio(banks, rates);
    const perVault = portfolio.results.map(({ bank, result }) => ({
      name: bank.name,
      net: result.earnings
        .filter((entry) => entry.date === day)
        .reduce((sum, entry) => sum.plus(entry.netAmount), new Decimal(0)),
      estimated: result.estimatedDates.includes(day),
    }));
    return {
      total: perVault.reduce((sum, item) => sum.plus(item.net), new Decimal(0)),
      perVault,
      estimated: perVault.some((item) => item.estimated),
    };
  }, [banks, rates, day]);

  const openDay = (next: string) => {
    setDay(next);
    setDayDetail(false);
  };
  // Tocar num dia volta o cartão do topo para o dia.
  const showDay = (next: string) => {
    openDay(next);
    setView('dia');
  };
  const openMonth = (next: string) => openDay(dayToOpen(next, todayIso));
  /** Um dia (ou um mês) para frente ou para trás: setinhas e arrasto. */
  // Até hoje anda dia a dia (ou mês a mês); depois de hoje, só pelos dias
  // marcados, até três meses adiante.
  const thisMonth = todayIso.slice(0, 7);
  const eventDaysFrom = (start: string, months: number) =>
    Array.from({ length: months }, (_, index) =>
      shiftMonth(start, index),
    ).flatMap((target) =>
      (target === month ? calendar : calendarOf(target)).days
        .filter((item) => item.events.length)
        .map((item) => item.day),
    );
  const forward = (() => {
    if (view === 'dia') {
      if (day < todayIso) return shiftDay(day, 1);
      return eventDaysFrom(month, 3).find((item) => item > day) ?? null;
    }
    const next = shiftMonth(month, 1);
    if (next <= thisMonth) return next;
    return calendarOf(next).days.some((item) => item.events.length)
      ? next
      : null;
  })();
  const backward = (() => {
    if (view !== 'dia') return shiftMonth(month, -1);
    if (day <= todayIso) return shiftDay(day, -1);
    // De um dia futuro, volta pelo dia marcado anterior, até chegar em hoje.
    const earlier = eventDaysFrom(thisMonth, 4).filter(
      (item) => item > todayIso && item < day,
    );
    return earlier.at(-1) ?? todayIso;
  })();
  const step = (by: 1 | -1) => {
    const target = by > 0 ? forward : backward;
    if (!target) return;
    setDirection(by);
    if (view === 'dia') openDay(target);
    else openMonth(target);
  };
  const leading = new Date(`${month}-01T12:00:00Z`).getUTCDay();
  const monthRows =
    ranking === 'categoria'
      ? monthView.byCategory
      : ranking === 'conta'
        ? monthView.byAccount
        : monthView.topMerchants.slice(0, 10);

  return (
    // overflow-x-clip, nunca hidden: hidden quebra o sticky da barra do topo.
    <main className="min-h-screen overflow-x-clip bg-background text-foreground">
      <AppHeader onRefresh={() => window.location.reload()} />
      {/* Coluna mais estreita: tela de leitura. */}
      <div className="app-container mx-auto max-w-5xl py-6 md:py-9">
        <NavigationBackButton fallback="/financeiro" className="mb-5" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Resumo</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              O mês dia a dia: o que saiu, o que vence e o que entrou.
            </p>
          </div>
          <Button
            variant="glass-quiet"
            className="h-10 shrink-0"
            disabled={day === todayIso && view === 'dia'}
            onClick={() => showDay(todayIso)}
          >
            Hoje
          </Button>
        </div>

        {/* Gasto do dia ou do mês num cartão só, com setas e arrasto. */}
        <section
          className="mt-5 touch-pan-y rounded-3xl border bg-card p-5 select-none md:p-7"
          onPointerDown={(event) => {
            swipe.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = swipe.current;
            swipe.current = null;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            // Arrasto horizontal de verdade, para não confundir com rolagem.
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5)
              step(dx < 0 ? 1 : -1);
          }}
          onPointerCancel={() => {
            swipe.current = null;
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight first-letter:uppercase">
                {view === 'dia' ? dayTitle(day, todayIso) : monthLabel(month)}
              </h2>
              {/* Pílula fina, sem vidro. */}
              <button
                type="button"
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setView(view === 'dia' ? 'mes' : 'dia')}
              >
                {view === 'dia' ? (
                  <CalendarDays aria-hidden="true" className="size-3.5" />
                ) : (
                  <CalendarCheck aria-hidden="true" className="size-3.5" />
                )}
                {view === 'dia' ? 'Ver o mês' : 'Ver o dia'}
              </button>
            </div>
            <div className="flex shrink-0 items-center">
              <Button
                variant="ghost"
                size="icon"
                aria-label={view === 'dia' ? 'Dia anterior' : 'Mês anterior'}
                onClick={() => step(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={view === 'dia' ? 'Próximo dia' : 'Próximo mês'}
                disabled={!forward}
                onClick={() => step(1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>

          {/* A chave muda a cada passo; o conteúdo entra do lado de onde veio. */}
          <div
            key={`${view}-${view === 'dia' ? day : month}`}
            className={cn(
              'animate-in duration-200 fade-in',
              direction > 0 ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
            )}
          >
            {view === 'dia' ? (
              past ? (
                <Headline
                  caption="Gasto no dia"
                  value={money(dayView.spent)}
                  tone={Number(dayView.spent) > 0 ? 'negative' : 'default'}
                  stats={[
                    {
                      label: 'Cofrinhos renderam',
                      value: vaultYield
                        ? `+${money(vaultYield.total)}`
                        : vaultsLoading
                          ? '…'
                          : '—',
                      tone: vaultYield ? 'positive' : 'default',
                      hint: vaultYield
                        ? vaultYield.perVault.map(vaultLabel).join(' · ') +
                          (vaultYield.estimated ? ' · estimativa' : '')
                        : vaultsLoading
                          ? 'Calculando…'
                          : 'Sem cofrinhos ou sem CDI',
                    },
                    {
                      label: 'Lançamentos',
                      value: String(dayView.count),
                      hint: dayView.count
                        ? `${dayView.byAccount.length} conta(s)`
                        : 'Nada registrado',
                    },
                  ]}
                />
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">
                  Este dia ainda não chegou. O que vence nele está logo abaixo.
                </p>
              )
            ) : (
              <Headline
                caption="Gasto no mês"
                value={money(monthView.spent)}
                tone={Number(monthView.spent) > 0 ? 'negative' : 'default'}
                stats={[
                  {
                    label: 'Entrou',
                    value: money(monthView.received),
                    tone: 'positive',
                    hint: `${monthView.count} lançamento(s) no mês`,
                  },
                  {
                    label: 'Saldo do mês',
                    value: money(monthView.net),
                    tone: Number(monthView.net) >= 0 ? 'positive' : 'negative',
                  },
                  {
                    label: 'Contra o mês anterior',
                    value: monthView.previous
                      ? `${delta > 0 ? '+' : ''}${money(monthView.previous.delta)}`
                      : '—',
                    tone: !monthView.previous
                      ? 'default'
                      : delta > 0
                        ? 'negative'
                        : 'positive',
                    hint: monthView.previous
                      ? monthView.previous.deltaPercent === null
                        ? `contra ${monthLabel(monthView.previous.month)}`
                        : `${monthView.previous.deltaPercent > 0 ? '+' : ''}${monthView.previous.deltaPercent}% contra ${monthLabel(monthView.previous.month)}`
                      : 'Sem mês anterior para comparar',
                  },
                ]}
              />
            )}
          </div>
        </section>

        {/* Telefone: uma coluna. Computador: dia e próximos à direita do calendário. */}
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0 rounded-3xl border bg-card p-3 sm:p-4 lg:col-start-1 lg:row-start-1">
            {/* Cabeçalho do calendário: mês, ano e setas à direita. */}
            <div className="mb-3 flex items-center gap-2 px-1 pt-1">
              <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                <span className="capitalize">{monthName(month)}</span>{' '}
                <span className="font-normal text-muted-foreground">
                  {month.slice(0, 4)}
                </span>
              </h2>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Mês anterior"
                  onClick={() => openMonth(shiftMonth(month, -1))}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Próximo mês"
                  onClick={() => openMonth(shiftMonth(month, 1))}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
              {WEEKDAYS.map((name) => (
                <span key={name} className="py-1.5">
                  {name}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: leading }, (_, index) => (
                <span key={`gap-${index}`} aria-hidden="true" />
              ))}
              {calendar.days.map((item) => {
                const kinds = [
                  ...new Set(item.events.map((event) => event.kind)),
                ];
                const isToday = item.day === todayIso;
                const isSelected = item.day === day;
                return (
                  <button
                    key={item.day}
                    type="button"
                    onClick={() => showDay(item.day)}
                    aria-pressed={isSelected}
                    aria-label={`${dayLabel(item.day)}${
                      item.events.length
                        ? `, ${item.events.length} ${item.events.length === 1 ? 'item' : 'itens'}`
                        : ''
                    }`}
                    className={cn(
                      'flex aspect-square min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-foreground',
                      item.day < todayIso && 'text-muted-foreground',
                      isToday && 'font-semibold ring-1 ring-foreground/40',
                      isSelected && 'ring-2 ring-foreground',
                    )}
                  >
                    <span>{Number(item.day.slice(8))}</span>
                    <span className="flex h-2 gap-0.5" aria-hidden="true">
                      {kinds.map((kind) => (
                        <span
                          key={kind}
                          className={cn('size-2 rounded-full', KIND[kind].dot)}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <ul className="mt-4 flex flex-wrap gap-2 px-1 text-xs font-medium">
              {(Object.keys(KIND) as CalendarEventKind[]).map((kind) => {
                const Icon = KIND[kind].icon;
                return (
                  <li
                    key={kind}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1',
                      KIND[kind].soft,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-5 place-items-center rounded-full text-white',
                        KIND[kind].dot,
                      )}
                    >
                      <Icon className="size-3" />
                    </span>
                    {KIND[kind].label}
                  </li>
                );
              })}
            </ul>
            {/* Os números do mês que não precisam de cartão próprio. */}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t px-1 pt-4 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">
                  Média por dia com gasto
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                  <Private>{money(monthView.dailyAverage)}</Private>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Dia mais caro</dt>
                <dd className="mt-0.5 text-sm font-semibold">
                  {monthView.busiestDay ? (
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => showDay(monthView.busiestDay!.day)}
                    >
                      {shortDay(monthView.busiestDay.day)} ·{' '}
                      <Private>{money(monthView.busiestDay.total)}</Private>
                    </button>
                  ) : (
                    'Sem gastos'
                  )}
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-muted-foreground">
                  Sai do bolso (faturas e assinaturas fora do cartão)
                </dt>
                <dd className="mt-0.5 text-sm font-semibold">
                  <Private>{money(calendar.totalOutflow)}</Private>
                  {calendar.heaviest && (
                    <button
                      type="button"
                      className="ml-1.5 text-xs font-normal text-muted-foreground hover:underline"
                      onClick={() => showDay(calendar.heaviest!.day)}
                    >
                      mais pesado {shortDay(calendar.heaviest.day)}
                    </button>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            {(calendarDay?.events.length || !past) && (
              <section className="rounded-3xl border bg-card p-5">
                <h2 className="text-sm font-semibold first-letter:uppercase">
                  {dayLabel(day)}
                </h2>
                {calendarDay?.events.length ? (
                  <ul className="mt-3 space-y-3">
                    {calendarDay.events.map((event, index) => {
                      const Icon = KIND[event.kind].icon;
                      return (
                        <li
                          key={`${event.kind}-${event.title}-${index}`}
                          className="flex items-start gap-3"
                        >
                          <span
                            className={cn(
                              'grid size-8 shrink-0 place-items-center rounded-full',
                              KIND[event.kind].soft,
                            )}
                          >
                            <Icon className="size-4" aria-hidden="true" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {event.title}
                            </p>
                            {event.note && (
                              <p className="text-xs text-muted-foreground">
                                {event.note}
                              </p>
                            )}
                          </div>
                          <span
                            className={cn(
                              'shrink-0 text-sm tabular-nums',
                              event.settled && 'text-muted-foreground',
                            )}
                          >
                            {event.amount === null ? (
                              'Previsto'
                            ) : (
                              <Private>
                                {event.kind === 'benefit' ? '+' : ''}
                                {money(event.amount)}
                              </Private>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nada marcado para este dia.
                  </p>
                )}
              </section>
            )}

            {past && (
              <DayAllowance
                day={day}
                today={todayIso}
                allowances={allowances}
                spentByDay={spentByDay}
                pending={unidentified.filter((item) => item.day === day)}
              />
            )}

            {past &&
              (dayView.entries.length ? (
                <section className="rounded-3xl border bg-card px-3 py-1 md:px-4">
                  <ExpenseDayList
                    entries={dayView.entries}
                    cards={cards}
                    onOpen={setSelected}
                    days={false}
                  />
                  {/* Divisão do dia recolhida: com poucos lançamentos só repete a lista. */}
                  <div className="border-t py-3">
                    <Button
                      variant="glass-quiet"
                      size="sm"
                      aria-expanded={dayDetail}
                      onClick={() => setDayDetail((value) => !value)}
                    >
                      {dayDetail
                        ? 'Esconder categorias e contas'
                        : 'Por categoria e conta'}
                    </Button>
                    {dayDetail && (
                      <div className="mt-3 grid gap-3">
                        <Breakdown
                          title="Por categoria"
                          rows={dayView.byCategory}
                          empty="Sem gastos."
                        />
                        <Breakdown
                          title="Por conta"
                          rows={dayView.byAccount}
                          empty="Sem gastos."
                        />
                      </div>
                    )}
                  </div>
                </section>
              ) : (
                <Empty
                  title="Nenhum lançamento neste dia"
                  hint="O que você gastar aparece aqui assim que entrar pelo atalho do iPhone, pelo banco ou pela tela de lançar."
                />
              ))}

            <section className="rounded-3xl border bg-card p-5">
              <h2 className="text-sm font-semibold">Próximos neste mês</h2>
              {upcoming.length ? (
                <ul className="mt-3 space-y-2">
                  {upcoming.flatMap((item) =>
                    item.events.map((event, index) => (
                      <li key={`${item.day}-${event.title}-${index}`}>
                        <button
                          type="button"
                          onClick={() => showDay(item.day)}
                          className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left text-sm hover:bg-muted/60"
                        >
                          <span className="w-11 shrink-0 text-xs text-muted-foreground">
                            {shortDay(item.day)}
                          </span>
                          <span
                            aria-hidden="true"
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              KIND[event.kind].dot,
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {event.title}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {event.amount === null ? (
                              'Previsto'
                            ) : (
                              <Private>{money(event.amount)}</Private>
                            )}
                          </span>
                        </button>
                      </li>
                    )),
                  )}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  {month < todayIso.slice(0, 7)
                    ? 'Este mês já passou.'
                    : 'Nada a vencer daqui até o fim do mês.'}
                </p>
              )}
            </section>
          </div>

          {/* As três listas do mês num cartão só, trocadas por chips. */}
          <section className="min-w-0 rounded-3xl border bg-card p-4 lg:col-start-1 lg:row-start-2">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['categoria', 'Categorias'],
                  ['conta', 'Contas'],
                  ['lojas', 'Onde mais gastou'],
                  ['dias', 'Dia a dia'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={ranking === value ? 'glass' : 'glass-quiet'}
                  aria-pressed={ranking === value}
                  onClick={() => setRanking(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {ranking === 'dias' ? (
              // Gasto diário do mês em barras; o maior em cor cheia; tocar abre o dia.
              <div className="mt-4">
                <h3 className="text-sm font-semibold">Gasto dia a dia</h3>
                <div
                  className="mt-4 flex h-28 items-end gap-[3px]"
                  data-private-chart
                >
                  {monthView.daily.map((entry) => {
                    const peak = Math.max(
                      ...monthView.daily.map((value) => Number(value.total)),
                    );
                    const height = peak
                      ? (Number(entry.total) / peak) * 100
                      : 0;
                    const busiest = entry.day === monthView.busiestDay?.day;
                    return (
                      <button
                        key={entry.day}
                        type="button"
                        aria-label={`${dayLabel(entry.day)}: ${money(entry.total)}`}
                        title={`${entry.day.slice(-2)} · ${money(entry.total)}`}
                        onClick={() => showDay(entry.day)}
                        className={cn(
                          'flex-1 rounded-t-[3px]',
                          busiest ? 'bg-foreground' : 'bg-foreground/35',
                          entry.day === day && 'bg-foreground/70',
                        )}
                        style={{ height: `${Math.max(height, 2)}%` }}
                      />
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                  <span>dia 01</span>
                  <span>dia {monthView.daily.length}</span>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <Breakdown
                  bare
                  title={
                    ranking === 'categoria'
                      ? 'Por categoria no mês'
                      : ranking === 'conta'
                        ? 'Por conta no mês'
                        : 'Onde você mais gastou no mês'
                  }
                  rows={monthRows}
                  counts={ranking === 'lojas'}
                  empty="Nenhum gasto neste mês."
                />
              </div>
            )}
          </section>
        </div>
      </div>
      {selected && (
        <EntryDetails
          key={selected.id}
          entry={selected}
          cards={cards}
          onClose={() => setSelected(null)}
          onSaved={(updated) =>
            setEntries((previous) =>
              previous.map((entry) =>
                // O resumo lê "os gastos": a dividida vale a parte dele.
                entry.id === updated.id ? toTotalsView(updated) : entry,
              ),
            )
          }
          onDelete={async (id) => {
            const { error } = await createClient()
              .from('financial_entries')
              .delete()
              .eq('id', id)
              .eq('user_id', selected.user_id);
            if (error) throw new Error(error.message);
            setEntries((previous) =>
              previous.filter((entry) => entry.id !== id),
            );
            setSelected(null);
          }}
        />
      )}
    </main>
  );
}
