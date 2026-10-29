'use client';

/* Home de teste no padrão Apple (skill apple-hig), terceira tentativa
   (29/10/2026): grade de widgets como a tela de início do iPhone — pequenos,
   médios e grandes, com cor e profundidade — e tudo o que a home oficial
   mostra (o Bruno sentiu falta de informação nas duas primeiras). As
   pílulas dos saldos dos bancos são as mesmas da home, a pedido dele.
   Grava o mesmo que a home: o valor do dia, a janela de 3 dias úteis e o
   que entra na conta (`spending_room_exclusions`). */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Decimal from 'decimal.js';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  CreditCard,
  Flame,
  Minus,
  PiggyBank,
  ReceiptText,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from '@/components/navigation-link';
import { AppHeader } from '@/components/app-header';
import { EntryDetails } from '@/components/entry-details';
import { ExpenseEntryDialog } from '@/components/expense-entry-dialog';
import { ExpenseLine, dayLabel } from '@/components/expense-line';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Private } from '@/components/private-value';
import { ReviewTeaser } from '@/components/review-teaser';
import { RobotFreshness } from '@/components/robot-freshness';
import { WishlistCard } from '@/components/wishlist-card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { barColour } from '@/lib/bank-colors';
import {
  adjustAllowances,
  allowanceForToday,
  daysInTheBlue,
  type AllowanceDay,
} from '@/lib/daily-allowance';
import { bankLogo } from '@/lib/domain';
import { myShare, toTotalsView } from '@/lib/entry-share';
import {
  saoDate,
  weeklySummary,
  type RecurringExpense,
} from '@/lib/expense-insights';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { summarizeFinances } from '@/lib/finance-overview';
import { BANK_FOLLOW_UPS, subscribeManualRefresh } from '@/lib/manual-refresh';
import { recapDefaultMonth, recapIsFresh } from '@/lib/monthly-recap';
import {
  cardBankName,
  resolvePaymentMethod,
  sortPaymentCardsByUsage,
  suggestedCardBank,
  type PaymentCard,
} from '@/lib/payment-cards';
import { monthLabel } from '@/lib/period-summary';
import {
  calculatePortfolio,
  portfolioEarnings,
  yieldOnly,
} from '@/lib/portfolio';
import { createClient } from '@/lib/supabase/client';
import { isPendingSpend, pendingEntries } from '@/lib/unidentified-spend';
import { loadUnidentifiedSpend } from '@/lib/unidentified-spend-query';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import { useVaultData } from '@/lib/use-vault-data';
import { cn } from '@/lib/utils';

type BankKey = 'nubank' | 'itau' | 'picpay' | 'mercado-pago';
type Exclusion = { kind: 'account' | 'card'; key: string };
type Balances = {
  accounts: { bank: BankKey; balance: number }[];
  cards: { key: string; limit: number; available: number }[];
  benefits: { key: string; label: string; balance: number }[];
  excluded: Exclusion[];
  plan: {
    subscriptions: RecurringExpense[];
    spentByDay: Record<string, string>;
    allowances: AllowanceDay[];
    unidentified?: { day: string; account: string; amount: string }[];
  } | null;
};

const BANKS: Record<BankKey, { name: string; logo: string }> = {
  nubank: { name: 'Nubank', logo: '/logos/nubank-ui.webp' },
  itau: { name: 'Itaú', logo: '/logos/itau-app.webp' },
  picpay: { name: 'PicPay', logo: '/logos/picpay-ui.webp' },
  'mercado-pago': { name: 'Mercado Pago', logo: '/logos/mercado-pago-ui.webp' },
};

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value).toNumber(),
  );
/** Sem centavos, para os widgets pequenos. */
const round = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(new Decimal(value).toNumber());
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const time = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));

/* Fundo de cada assunto: gradiente escuro o bastante para texto branco
   (contraste ≥ 4,5:1 no tom de baixo). Mesma cor = mesmo assunto em toda a
   tela, e o título sempre diz o assunto. */
const PAINT = {
  today: 'from-emerald-500 to-teal-700 shadow-emerald-900/25',
  over: 'from-rose-500 to-red-700 shadow-red-900/25',
  streak: 'from-amber-400 to-orange-600 shadow-orange-900/25',
  week: 'from-orange-500 to-rose-600 shadow-rose-900/25',
  vault: 'from-sky-500 to-indigo-700 shadow-indigo-900/25',
  flash: 'from-pink-500 to-fuchsia-700 shadow-fuchsia-900/25',
  month: 'from-violet-500 to-purple-800 shadow-purple-900/25',
  recap: 'from-indigo-500 to-violet-700 shadow-violet-900/25',
} as const;
type Paint = keyof typeof PAINT;

/* --- Dados (os mesmos da home, com as mesmas gravações) ----------------- */

async function fetchBalances(): Promise<Balances> {
  const response = await fetch('/api/pluggy/balances', { cache: 'no-store' });
  if (!response.ok) throw new Error('saldos indisponíveis');
  const body = (await response.json()) as Partial<Balances>;
  return {
    accounts: body.accounts ?? [],
    cards: body.cards ?? [],
    benefits: body.benefits ?? [],
    excluded: body.excluded ?? [],
    plan: body.plan ?? null,
  };
}

function useHomeData() {
  const client = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState<FinancialEntry[] | null>(null);
  const [cards, setCards] = useState<PaymentCard[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [entryResult, cardResult, pending, nextBalances] = await Promise.all([
      loadFinancialEntries(client),
      client.from('payment_cards').select('*').order('account'),
      loadUnidentifiedSpend(client).catch(() => []),
      fetchBalances().catch(() => null),
    ]);
    if (nextBalances) setBalances(nextBalances);
    if (entryResult.error || cardResult.error) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setEntries([
      ...((entryResult.data ?? []) as FinancialEntry[]),
      ...pendingEntries(pending),
    ]);
    setCards((cardResult.data ?? []) as PaymentCard[]);
  }, [client]);

  useEffect(() => {
    queueMicrotask(() => void load());
    // Os bancos mandam gastos depois da primeira leitura (como na home).
    return subscribeManualRefresh(load, { followUps: BANK_FOLLOW_UPS });
  }, [load]);
  useResumeRefresh(load);

  const userId = useCallback(async () => {
    const {
      data: { user },
    } = await client.auth.getUser();
    return user?.id ?? null;
  }, [client]);

  /** Valor do dia congelado no primeiro cálculo (igual à home). */
  const freeze = useCallback(
    async (day: string, allowance: string) => {
      setBalances((current) =>
        current?.plan &&
        !current.plan.allowances.some((item) => item.day === day)
          ? {
              ...current,
              plan: {
                ...current.plan,
                allowances: [...current.plan.allowances, { day, allowance }],
              },
            }
          : current,
      );
      const id = await userId();
      if (!id) return;
      await client
        .from('daily_allowances')
        .upsert(
          { user_id: id, day, allowance },
          { onConflict: 'user_id,day', ignoreDuplicates: true },
        );
    },
    [client, userId],
  );

  /** Valores que a janela de 3 dias úteis baixou. */
  const saveAdjusted = useCallback(
    async (changed: AllowanceDay[]) => {
      if (!changed.length) return;
      const lowered = new Map(changed.map((item) => [item.day, item]));
      setBalances((current) =>
        current?.plan
          ? {
              ...current,
              plan: {
                ...current.plan,
                allowances: current.plan.allowances.map(
                  (item) => lowered.get(item.day) ?? item,
                ),
              },
            }
          : current,
      );
      const id = await userId();
      if (!id) return;
      for (const item of changed)
        await client
          .from('daily_allowances')
          .update({ allowance: item.allowance })
          .eq('user_id', id)
          .eq('day', item.day);
    },
    [client, userId],
  );

  /** Liga/desliga um saldo ou limite na conta; desfaz se falhar. */
  const toggle = useCallback(
    async (item: Exclusion, include: boolean) => {
      let previous: Balances | null = null;
      setBalances((current) => {
        previous = current;
        if (!current) return current;
        return {
          ...current,
          excluded: include
            ? current.excluded.filter(
                (other) =>
                  !(other.kind === item.kind && other.key === item.key),
              )
            : [...current.excluded, item],
        };
      });
      const id = await userId();
      const { error } = !id
        ? { error: new Error('sem sessão') }
        : include
          ? await client
              .from('spending_room_exclusions')
              .delete()
              .eq('kind', item.kind)
              .eq('key', item.key)
          : await client
              .from('spending_room_exclusions')
              .upsert(
                { user_id: id, kind: item.kind, key: item.key },
                { onConflict: 'user_id,kind,key' },
              );
      if (error) setBalances(previous);
    },
    [client, userId],
  );

  return {
    client,
    entries,
    setEntries,
    cards,
    balances,
    failed,
    reload: load,
    freeze,
    saveAdjusted,
    toggle,
  };
}

/* --- Widgets ------------------------------------------------------------ */

/**
 * Widget colorido (pequeno ou médio): gradiente do assunto, título no
 * topo, número grande embaixo. Tocar abre a tela do assunto.
 */
function Widget({
  paint,
  icon: Icon,
  title,
  href,
  className,
  children,
  index = 0,
}: {
  paint: Paint;
  icon: LucideIcon;
  title: string;
  href: string;
  className?: string;
  children: React.ReactNode;
  /** Ordem na entrada escalonada. */
  index?: number;
}) {
  return (
    <Link
      href={href}
      style={{ animationDelay: `${index * 40}ms` }}
      className={cn(
        'relative isolate flex min-h-[9.5rem] min-w-0 flex-col overflow-clip rounded-[26px] bg-linear-to-br p-4 text-white shadow-lg ring-1 ring-white/10 ring-inset transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-300 motion-reduce:active:scale-100',
        PAINT[paint],
        className,
      )}
    >
      {/* Brilho de cima, para dar volume. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-1/2 bg-linear-to-b from-white/15 to-transparent"
      />
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white/90">
        <Icon aria-hidden="true" className="size-4" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </span>
      <span className="mt-auto block pt-3">{children}</span>
    </Link>
  );
}

/**
 * Widget grande (fundo do app): cabeçalho com ícone colorido e "Ver" no
 * fim, conteúdo livre. Para listas e detalhes, onde texto pequeno precisa
 * de fundo sólido.
 */
function Panel({
  paint,
  icon: Icon,
  title,
  subtitle,
  href,
  action = 'Ver',
  trailing,
  className,
  children,
  index = 0,
}: {
  paint: Paint;
  icon: LucideIcon;
  title: string;
  subtitle?: React.ReactNode;
  href?: string;
  action?: string;
  trailing?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  index?: number;
}) {
  return (
    <section
      style={{ animationDelay: `${index * 40}ms` }}
      className={cn(
        'min-w-0 rounded-[26px] bg-card p-4 shadow-sm ring-1 ring-border/60 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-300',
        className,
      )}
    >
      <header className="mb-3 flex items-center gap-3">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-[11px] bg-linear-to-br text-white shadow-sm',
            PAINT[paint],
          )}
        >
          <Icon aria-hidden="true" className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold tracking-tight">
            {title}
          </h2>
          {subtitle && (
            <span className="block truncate text-[13px] text-muted-foreground">
              {subtitle}
            </span>
          )}
        </span>
        {trailing}
        {href && (
          <Link
            href={href}
            className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-full px-2 text-[15px] text-primary hover:bg-muted/50"
          >
            {action}
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** Barras de 7 dias; hoje destacado, futuros apagados. */
function WeekBars({
  days,
  today,
  onColour = false,
}: {
  days: { day: string; total: string | null }[];
  today: string;
  /** Em cima de gradiente (barras brancas). */
  onColour?: boolean;
}) {
  const max = Math.max(1, ...days.map((day) => Number(day.total ?? 0)));
  const letters = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  return (
    <span aria-hidden="true" className="grid grid-cols-7 items-end gap-1.5">
      {days.map((day, index) => (
        <span key={day.day} className="flex flex-col items-center gap-1">
          <span className="flex h-12 w-full items-end">
            <span
              className={cn(
                'w-full rounded-[4px]',
                day.total === null
                  ? onColour
                    ? 'bg-white/15'
                    : 'bg-foreground/5'
                  : day.day === today
                    ? onColour
                      ? 'bg-white'
                      : 'bg-orange-500'
                    : onColour
                      ? 'bg-white/45'
                      : 'bg-foreground/20',
              )}
              style={{
                height:
                  day.total === null
                    ? '3px'
                    : `${Math.max(8, (Number(day.total) / max) * 100)}%`,
              }}
            />
          </span>
          <span
            className={cn(
              'text-[11px]',
              onColour ? 'text-white/80' : 'text-muted-foreground',
              day.day === today && 'font-bold',
            )}
          >
            {letters[index]}
          </span>
        </span>
      ))}
    </span>
  );
}

/* --- Tela --------------------------------------------------------------- */

export function HomeApple() {
  const {
    client,
    entries,
    setEntries,
    cards,
    balances,
    failed,
    reload,
    freeze,
    saveAdjusted,
    toggle,
  } = useHomeData();
  const { banks, rates, loading: vaultsLoading } = useVaultData();
  const [entryOpen, setEntryOpen] = useState(false);
  const [selected, setSelected] = useState<FinancialEntry | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [shown, setShown] = useState(8);
  const todayKey = saoDate(new Date());

  const list = useMemo(() => entries ?? [], [entries]);
  const recorded = useMemo(
    () => list.filter((entry) => !isPendingSpend(entry)),
    [list],
  );
  const expenses = useMemo(
    () =>
      list
        .filter(
          (entry) =>
            entry.entry_type === 'expense' &&
            new Date(entry.occurred_at) <= new Date() &&
            (!(entry.installment_group_id || entry.installment_total) ||
              (entry.installment_number ?? 1) <= 1),
        )
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    [list],
  );
  const sortedCards = useMemo(
    () =>
      sortPaymentCardsByUsage(
        cards,
        expenses.map((entry) => entry.account),
      ),
    [cards, expenses],
  );
  const month = useMemo(() => summarizeFinances(list), [list]);
  const week = useMemo(() => weeklySummary(list), [list]);
  const portfolio = useMemo(
    () => calculatePortfolio(banks, rates),
    [banks, rates],
  );

  const out = useCallback(
    (kind: Exclusion['kind'], key: string) =>
      (balances?.excluded ?? []).some(
        (item) => item.kind === kind && item.key === key,
      ),
    [balances],
  );
  const room = useMemo(() => {
    if (!balances) return null;
    const accounts = balances.accounts.filter(
      (account) => !out('account', account.bank),
    );
    const limits = balances.cards.filter((card) => !out('card', card.key));
    const benefits = balances.benefits.filter(
      (benefit) => !out('account', `flash-${benefit.key}`),
    );
    const sum = (values: number[]) =>
      values.reduce((total, value) => total.plus(value), new Decimal(0));
    const balance = sum(accounts.map((item) => item.balance));
    const free = sum(limits.map((item) => item.available));
    const flash = sum(benefits.map((item) => item.balance));
    const parts = [
      ...accounts.map((item) => ({
        id: `a-${item.bank}`,
        label: `Conta ${BANKS[item.bank].name}`,
        colour: barColour(item.bank, 'balance'),
        value: item.balance,
      })),
      ...benefits.map((item) => ({
        id: `b-${item.key}`,
        label: `Flash · ${item.label}`,
        colour: barColour('flash', 'balance'),
        value: item.balance,
      })),
      ...limits.map((item) => ({
        id: `c-${item.key}`,
        label: item.key,
        colour: barColour(suggestedCardBank(item.key), 'limit'),
        value: item.available,
      })),
    ].filter((part) => part.value > 0);
    return {
      total: balance.plus(free).plus(flash),
      balance,
      free,
      flash,
      parts,
      positive: parts.reduce((total, part) => total + part.value, 0),
      nothing: !accounts.length && !limits.length && !benefits.length,
      hasAccounts: accounts.length > 0,
      hasBenefits: benefits.length > 0,
      hasCards: limits.length > 0,
    };
  }, [balances, out]);

  const plan = balances?.plan ?? null;
  const day = useMemo(() => {
    if (!plan || !room) return null;
    const spent = new Decimal(plan.spentByDay[todayKey] ?? 0);
    const computed = allowanceForToday({
      today: todayKey,
      room: room.total,
      spentToday: spent,
      subscriptions: plan.subscriptions,
    });
    const { adjusted, changed } = adjustAllowances({
      today: todayKey,
      room: room.total,
      allowances: plan.allowances,
      spentByDay: plan.spentByDay,
      subscriptions: plan.subscriptions,
    });
    const stored = adjusted.find((item) => item.day === todayKey);
    const allowance = new Decimal(stored?.allowance ?? computed.perDay);
    const blue = daysInTheBlue({
      today: todayKey,
      allowances: stored
        ? adjusted
        : [...adjusted, { day: todayKey, allowance: allowance.toFixed(2) }],
      spentByDay: plan.spentByDay,
    });
    return {
      allowance,
      spent,
      left: Decimal.max(allowance.minus(spent), 0),
      over: spent.gt(allowance),
      percent: allowance.gt(0)
        ? Math.min(100, spent.div(allowance).times(100).toNumber())
        : spent.gt(0)
          ? 100
          : 0,
      until: computed.until,
      days: computed.days,
      short: Decimal.max(new Decimal(computed.free).negated(), 0),
      blue,
      changed,
      freezeValue: stored ? null : computed.perDay,
      pending: (plan.unidentified ?? []).filter(
        (item) => item.day === todayKey,
      ),
    };
  }, [plan, room, todayKey]);

  // As mesmas gravações da home: congelar hoje e baixar a janela.
  const freezeValue = room?.nothing ? null : (day?.freezeValue ?? null);
  useEffect(() => {
    if (freezeValue) void freeze(todayKey, freezeValue);
  }, [freezeValue, freeze, todayKey]);
  const changedKey = (day?.changed ?? [])
    .map((item) => `${item.day}:${item.allowance}`)
    .join('|');
  useEffect(() => {
    if (!changedKey || room?.nothing) return;
    void saveAdjusted(
      changedKey.split('|').map((item) => {
        const [when, allowance] = item.split(':');
        return { day: when, allowance };
      }),
    );
  }, [changedKey, room?.nothing, saveAdjusted]);

  const dateLine = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
  const weekDiff = new Decimal(week.total).minus(week.previous);
  const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const weekPeriod =
    week.start === week.end
      ? dayMonth(week.start)
      : `${dayMonth(week.start)} – ${dayMonth(week.end)}`;
  const weekGain = portfolioEarnings(portfolio, week.start, week.end);
  const loadingData = entries === null;

  /* Pílulas dos saldos: exatamente as da home (account-balances.tsx). */
  const pills = balances?.accounts.length ? (
    <ScrollArea orientation="horizontal" className="scroll-bleed">
      <ul className="flex gap-2 py-0.5 lg:w-auto lg:flex-wrap lg:px-0">
        {balances.accounts.map((account, index) => {
          const bank = BANKS[account.bank];
          return (
            <li key={`${account.bank}-${index}`} className="shrink-0">
              <Link
                href={`/bancos/${account.bank}`}
                aria-label={`${bank.name}: abrir extrato`}
                className="flex h-12 items-center gap-2.5 rounded-full border bg-card py-1.5 pr-4 pl-1.5 shadow-xs transition-[background-color,transform] hover:bg-muted/50 active:scale-[0.97]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-background">
                  <Image
                    src={bank.logo}
                    alt=""
                    width={20}
                    height={20}
                    unoptimized
                    className="size-5 object-contain"
                  />
                </span>
                <span className="text-base font-semibold tracking-tight tabular-nums">
                  <Private>{money(account.balance)}</Private>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  ) : null;

  /* Topo: "Hoje" grande à esquerda; dias no azul e semana à direita. */
  const top = (
    <div className="grid grid-cols-2 gap-3">
      {day ? (
        <Widget
          paint={day.over ? 'over' : 'today'}
          icon={Wallet}
          title="Hoje"
          href="/resumo"
          className="row-span-2 min-h-[20rem]"
        >
          <span className="block text-[15px] font-medium text-white/90">
            {day.over ? 'Você passou' : 'Ainda dá'}
          </span>
          <span className="block text-[34px] leading-[38px] font-bold tracking-tight tabular-nums">
            <Private>
              {money(day.over ? day.spent.minus(day.allowance) : day.left)}
            </Private>
          </span>
          <span
            aria-hidden="true"
            className="mt-3 block h-2 overflow-hidden rounded-full bg-white/25"
          >
            <span
              className="block h-full rounded-full bg-white transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${day.percent}%` }}
            />
          </span>
          <span className="mt-2 block text-[13px] font-medium text-white/90">
            Gastou <Private>{money(day.spent)}</Private> de{' '}
            <Private>{money(day.allowance)}</Private>
          </span>
          <span className="block text-[13px] text-white/85">
            até {shortDay(day.until)} ·{' '}
            {day.days === 1 ? 'último dia' : `faltam ${day.days} dias`}
          </span>
        </Widget>
      ) : (
        <Skeleton className="row-span-2 min-h-[20rem] rounded-[26px]" />
      )}
      {day ? (
        <Widget
          paint="streak"
          icon={Flame}
          title="No azul"
          href="/resumo"
          index={1}
        >
          <span className="flex items-baseline gap-1">
            <span className="text-[34px] leading-[38px] font-bold tabular-nums">
              {day.blue.total}
            </span>
            <Flame
              aria-hidden="true"
              className={cn(
                'size-6 fill-current',
                day.blue.total ? 'text-white' : 'text-white/50',
              )}
            />
          </span>
          <span className="block text-[13px] font-medium text-white/90">
            {day.blue.total === 1 ? 'dia' : 'dias'} dentro do valor
            {day.blue.provisional && ' · provisório'}
          </span>
        </Widget>
      ) : (
        <Skeleton className="min-h-[9.5rem] rounded-[26px]" />
      )}
      {loadingData ? (
        <Skeleton className="min-h-[9.5rem] rounded-[26px]" />
      ) : (
        <Widget
          paint="week"
          icon={ReceiptText}
          title="Semana"
          href="/resumo"
          index={2}
        >
          <span className="block text-[22px] leading-7 font-bold tracking-tight tabular-nums">
            <Private>{round(week.total)}</Private>
          </span>
          <span className="mt-2 block">
            <WeekBars days={week.days} today={todayKey} onColour />
          </span>
        </Widget>
      )}
    </div>
  );

  /* Avisos do dia, logo abaixo (fundo sólido: texto pequeno). */
  const notes = day && (day.pending.length > 0 || day.short.gt(0)) && (
    <div className="grid gap-1 rounded-[22px] bg-card px-4 py-3 text-[13px] ring-1 ring-border/60">
      {day.pending.length > 0 && (
        <p className="text-muted-foreground">
          Hoje inclui{' '}
          {day.pending.map((item, index) => (
            <span key={item.account}>
              {index > 0 && ' e '}
              <Private>{money(item.amount)}</Private> no{' '}
              {cardBankName(suggestedCardBank(item.account))}
            </span>
          ))}{' '}
          que o limite já mostra e a compra ainda não chegou.
        </p>
      )}
      {day.short.gt(0) && (
        <p className="text-destructive">
          Faltam <Private>{money(day.short)}</Private> para cobrir as
          assinaturas do mês.
        </p>
      )}
    </div>
  );

  /* Três pequenos: cofrinhos, Flash e mês. */
  const smalls = (
    <div className="grid grid-cols-3 gap-3">
      {vaultsLoading ? (
        <Skeleton className="min-h-[8.5rem] rounded-[26px]" />
      ) : (
        <Widget
          paint="vault"
          icon={PiggyBank}
          title="Cofrinhos"
          href="/cobertura"
          className="min-h-[8.5rem] p-3.5"
          index={3}
        >
          <span className="block text-[17px] leading-6 font-bold tabular-nums">
            <Private>{round(portfolio.netBalance)}</Private>
          </span>
          <span className="block truncate text-[11px] font-medium text-white/90">
            +
            <Private>
              {round(Decimal.max(portfolio.lifetimeNetGain, 0))}
            </Private>{' '}
            rendidos
          </span>
        </Widget>
      )}
      {room ? (
        <Widget
          paint="flash"
          icon={CreditCard}
          title="Flash"
          href="/beneficios"
          className="min-h-[8.5rem] p-3.5"
          index={4}
        >
          <span className="block text-[17px] leading-6 font-bold tabular-nums">
            <Private>
              {round(
                (balances?.benefits ?? []).reduce(
                  (sum, item) => sum.plus(item.balance),
                  new Decimal(0),
                ),
              )}
            </Private>
          </span>
          <span className="block truncate text-[11px] font-medium text-white/90">
            nos benefícios
          </span>
        </Widget>
      ) : (
        <Skeleton className="min-h-[8.5rem] rounded-[26px]" />
      )}
      {loadingData ? (
        <Skeleton className="min-h-[8.5rem] rounded-[26px]" />
      ) : (
        <Widget
          paint="month"
          icon={ReceiptText}
          title="Mês"
          href="/financeiro"
          className="min-h-[8.5rem] p-3.5"
          index={5}
        >
          <span className="block text-[17px] leading-6 font-bold tabular-nums">
            <Private>{round(month.expenses)}</Private>
          </span>
          <span className="block truncate text-[11px] font-medium text-white/90">
            gastos no mês
          </span>
        </Widget>
      )}
    </div>
  );

  /* Médio: o disponível do mês, de onde vem e o que entra na conta. */
  const monthPanel = room ? (
    <Panel
      paint="today"
      icon={Wallet}
      title="Ainda dá para gastar no mês"
      index={6}
      trailing={
        <Button
          type="button"
          variant="glass-quiet"
          size="icon"
          aria-label="Escolher saldos e limites da conta"
          onClick={() => setConfiguring(true)}
        >
          <SlidersHorizontal />
        </Button>
      }
    >
      <p className="text-[28px] leading-[34px] font-bold tracking-tight tabular-nums">
        <Private>{money(room.total)}</Private>
      </p>
      {room.nothing ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Nenhum saldo nem limite escolhido. Toque no ajuste para escolher.
        </p>
      ) : (
        <>
          <ul
            aria-label="De onde vem"
            className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-foreground/10"
          >
            {room.parts.map((part) => (
              <li
                key={part.id}
                title={`${part.label}: ${money(part.value)}`}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(part.value / room.positive) * 100}%`,
                  background: part.colour,
                }}
              >
                <span className="sr-only">
                  {part.label}: {money(part.value)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {[
              room.hasAccounts && { label: 'Contas', value: room.balance },
              room.hasBenefits && { label: 'Flash', value: room.flash },
              room.hasCards && { label: 'Limite livre', value: room.free },
            ]
              .filter((item) => item !== false)
              .map((item) => (
                <div
                  key={item.label}
                  className="min-w-0 rounded-2xl bg-muted/60 px-3 py-2"
                >
                  <dt className="truncate text-[11px] text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="truncate text-[15px] font-semibold tabular-nums">
                    <Private>{money(item.value)}</Private>
                  </dd>
                </div>
              ))}
          </dl>
        </>
      )}
    </Panel>
  ) : (
    <Skeleton className="h-52 rounded-[26px]" />
  );

  /* Grande: últimos gastos, com o gasto de hoje no cabeçalho. */
  const spentToday = expenses
    .filter(
      (entry) =>
        saoDate(entry.occurred_at) === todayKey && !entry.excluded_from_totals,
    )
    .reduce((sum, entry) => sum.plus(myShare(entry)), new Decimal(0));
  const spendingPanel = loadingData ? (
    <Skeleton className="h-[28rem] rounded-[26px]" />
  ) : (
    <Panel
      paint="week"
      icon={ReceiptText}
      title="Últimos gastos"
      subtitle={
        <>
          Hoje <Private>{money(spentToday)}</Private>
        </>
      }
      href="/financeiro"
      action="Todos"
      index={7}
    >
      {expenses.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          Nenhum gasto ainda. Toque em + no topo para registrar o primeiro.
        </p>
      ) : (
        <>
          <ul className="-mx-1">
            {expenses.slice(0, shown).map((entry, index, items) => {
              const when = saoDate(entry.occurred_at);
              const newDay =
                index === 0 || saoDate(items[index - 1].occurred_at) !== when;
              return (
                <li key={entry.id}>
                  {newDay && (
                    <p className="px-2 pt-3 pb-1 text-[13px] font-semibold text-muted-foreground first:pt-0">
                      {dayLabel(when, todayKey)}
                    </p>
                  )}
                  {isPendingSpend(entry) ? (
                    <ExpenseLine
                      entry={entry}
                      cards={sortedCards}
                      onOpen={setSelected}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSelected(entry)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring active:bg-muted/70"
                    >
                      <PaymentCardIcon
                        bankId={resolvePaymentMethod(entry.account, cards)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">
                          {entry.description}
                        </span>
                        <span className="block truncate text-[13px] text-muted-foreground">
                          {entry.category} · {time(entry.occurred_at)}
                          {entry.excluded_from_daily &&
                            !entry.excluded_from_totals &&
                            ' · fora do valor do dia'}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-[15px] font-semibold tabular-nums',
                          entry.excluded_from_totals &&
                            'text-muted-foreground line-through',
                        )}
                      >
                        <Private>−{money(myShare(entry))}</Private>
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {shown < expenses.length && (
            <Button
              type="button"
              variant="glass-quiet"
              className="mt-3 w-full"
              onClick={() => setShown((count) => count + 10)}
            >
              Mostrar mais
            </Button>
          )}
        </>
      )}
    </Panel>
  );

  /* Grande: resumo da semana (o que a aba Semana mostra). */
  const weekPanel = loadingData ? (
    <Skeleton className="h-96 rounded-[26px]" />
  ) : (
    <Panel
      paint="week"
      icon={ReceiptText}
      title="Resumo semanal"
      subtitle={`Esta semana · ${weekPeriod}`}
      href="/resumo"
      index={8}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[28px] leading-[34px] font-bold tracking-tight tabular-nums">
            <Private>{money(week.total)}</Private>
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {week.count} {week.count === 1 ? 'lançamento' : 'lançamentos'}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold',
            weekDiff.gt(0)
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : weekDiff.lt(0)
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {weekDiff.gt(0) ? (
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          ) : weekDiff.lt(0) ? (
            <ArrowDownRight aria-hidden="true" className="size-3.5" />
          ) : (
            <Minus aria-hidden="true" className="size-3.5" />
          )}
          {weekDiff.isZero() ? (
            'Mesmo valor'
          ) : (
            <>
              <Private>{money(weekDiff.abs())}</Private>{' '}
              {weekDiff.gt(0) ? 'a mais' : 'a menos'}
            </>
          )}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {week.previousStart === week.previousEnd
          ? `Comparado ao domingo passado (${dayMonth(week.previousStart)})`
          : `Comparado à semana passada até o mesmo dia (${dayMonth(week.previousStart)} – ${dayMonth(week.previousEnd)})`}
      </p>
      <div className="mt-4">
        <WeekBars days={week.days} today={todayKey} />
      </div>
      <div className="mt-4 grid gap-3 border-t border-border/70 pt-4">
        <p className="text-[13px] font-semibold">Maiores categorias</p>
        {week.categories.length ? (
          week.categories.slice(0, 3).map((category) => {
            const share = new Decimal(week.total).gt(0)
              ? new Decimal(category.total)
                  .div(week.total)
                  .times(100)
                  .toNumber()
              : 0;
            return (
              <div key={category.name}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate text-muted-foreground">
                    {category.name}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    <Private>{money(category.total)}</Private>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-orange-500"
                    style={{ width: `${Math.max(share, 4)}%` }}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Nenhum gasto registrado nesta semana.
          </p>
        )}
      </div>
      {!vaultsLoading && (
        <p className="mt-4 flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2.5 text-[13px]">
          <PiggyBank aria-hidden="true" className="size-4 text-sky-500" />
          <span className="min-w-0 flex-1">Cofrinhos renderam na semana</span>
          <span className="shrink-0 font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
            +<Private>{money(Decimal.max(weekGain, 0))}</Private>
          </span>
        </p>
      )}
    </Panel>
  );

  /* Médio: o mês (gastos e entradas), como na aba Semana. */
  const incomePanel = loadingData ? (
    <Skeleton className="h-40 rounded-[26px]" />
  ) : (
    <Panel paint="month" icon={ReceiptText} title="Este mês" index={9}>
      <div className="grid grid-cols-2 gap-3">
        {[
          {
            label: 'Gastos do mês',
            amount: month.expenses,
            note: 'Lançamentos registrados',
            href: '/financeiro',
            tone: '',
          },
          {
            label: 'Entrou no mês',
            amount: month.income,
            note: 'Salário, Flash e entradas escolhidas',
            href: '/resumo',
            tone: 'text-emerald-600 dark:text-emerald-400',
          },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="min-w-0 rounded-2xl bg-muted/60 p-3 transition-colors hover:bg-muted active:scale-[0.98]"
          >
            <span className="block text-[13px] text-muted-foreground">
              {item.label}
            </span>
            <span
              className={cn(
                'mt-1 block truncate text-[20px] leading-6 font-bold tabular-nums',
                item.tone,
              )}
            >
              <Private>{money(item.amount)}</Private>
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {item.note}
            </span>
          </Link>
        ))}
      </div>
    </Panel>
  );

  /* Grande: cada cofrinho com o que rendeu. */
  const vaultPanel = vaultsLoading ? (
    <Skeleton className="h-64 rounded-[26px]" />
  ) : (
    <Panel
      paint="vault"
      icon={PiggyBank}
      title="Cofrinhos"
      subtitle={
        <>
          <Private>{money(portfolio.netBalance)}</Private> · +
          <Private>{money(Decimal.max(portfolio.lifetimeNetGain, 0))}</Private>{' '}
          rendidos
        </>
      }
      href="/cobertura"
      action="Cobertura"
      index={10}
    >
      <ul className="-mx-1">
        {portfolio.results.map(({ bank, result }) => {
          const logo = bankLogo(bank.bank);
          const gain = Decimal.max(yieldOnly(result.earnings), 0);
          return (
            <li key={bank.id}>
              <Link
                href={`/cofrinhos/${bank.id}`}
                className="flex min-h-14 items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-muted/50 active:bg-muted/70"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full border bg-background">
                  {logo && (
                    <Image
                      src={logo}
                      alt=""
                      width={22}
                      height={22}
                      unoptimized
                      className="size-[22px] object-contain"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {bank.name}
                  </span>
                  <span className="block truncate text-[13px] text-emerald-600 dark:text-emerald-400">
                    +<Private>{money(gain)}</Private> rendidos
                  </span>
                </span>
                <span className="shrink-0 text-[15px] font-semibold tabular-nums">
                  <Private>{money(result.netBalance)}</Private>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground/60"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );

  const wishPanel = (
    <section className="min-w-0 rounded-[26px] bg-card p-4 shadow-sm ring-1 ring-border/60">
      <WishlistCard entries={recorded} flat />
    </section>
  );

  const recap = recapIsFresh() && (
    <Widget
      paint="recap"
      icon={Sparkles}
      title="Retrospectiva"
      href="/retrospectiva"
      className="min-h-0"
    >
      <span className="block text-[22px] leading-7 font-bold first-letter:uppercase">
        {monthLabel(recapDefaultMonth()).split(' ')[0]}
      </span>
      <span className="block text-[13px] font-medium text-white/90">
        Maior compra, dias sem gastar e quanto os cofrinhos renderam
      </span>
    </Widget>
  );

  return (
    <main className="min-h-screen overflow-x-clip bg-background text-foreground">
      <AppHeader onRefresh={reload} onAdd={() => setEntryOpen(true)} />
      <div className="app-container min-w-0 pt-5 pb-12 md:pt-8">
        <header className="mb-5 px-1">
          <p className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
            {dateLine}
          </p>
          <h1 className="mt-0.5 text-[34px] leading-[41px] font-bold tracking-tight">
            Início
          </h1>
          <div className="mt-1 text-[13px] text-muted-foreground">
            <RobotFreshness />
          </div>
        </header>

        {failed && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[22px] bg-card p-4 ring-1 ring-border/60">
            <p className="text-[15px]">Não foi possível atualizar os gastos.</p>
            <Button variant="glass" onClick={() => void reload()}>
              Tentar de novo
            </Button>
          </div>
        )}

        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2 lg:gap-6">
          <div className="grid min-w-0 gap-4">
            {top}
            {notes}
            {pills}
            {smalls}
            {recap}
            {monthPanel}
            {incomePanel}
          </div>
          <div className="grid min-w-0 gap-4">
            {!loadingData && <ReviewTeaser entries={recorded} />}
            {spendingPanel}
            {weekPanel}
            {vaultPanel}
            {wishPanel}
          </div>
        </div>
      </div>

      <Dialog open={configuring} onOpenChange={setConfiguring}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>O que entra na conta</DialogTitle>
            <DialogDescription>
              Marque os saldos e os limites que contam em “Ainda dá para
              gastar”. Conta ou cartão novo entra marcado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5">
            {[
              {
                legend: 'Saldos',
                items: (balances?.accounts ?? []).map((account) => ({
                  id: `room-account-${account.bank}`,
                  exclusion: {
                    kind: 'account',
                    key: account.bank,
                  } as Exclusion,
                  label: BANKS[account.bank].name,
                  value: money(account.balance),
                })),
              },
              {
                legend: 'Flash',
                items: (balances?.benefits ?? []).map((benefit) => ({
                  id: `room-benefit-${benefit.key}`,
                  exclusion: {
                    kind: 'account',
                    key: `flash-${benefit.key}`,
                  } as Exclusion,
                  label: benefit.label,
                  value: money(benefit.balance),
                })),
              },
              {
                legend: 'Limites',
                items: (balances?.cards ?? []).map((card, index) => ({
                  id: `room-card-${index}`,
                  exclusion: { kind: 'card', key: card.key } as Exclusion,
                  label: card.key,
                  value: `${money(card.available)} de ${money(card.limit)}`,
                })),
              },
            ]
              .filter((group) => group.items.length)
              .map((group) => (
                <fieldset key={group.legend} className="grid gap-1">
                  <legend className="mb-2 text-xs font-medium tracking-[.1em] text-muted-foreground uppercase">
                    {group.legend}
                  </legend>
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-xl px-1 py-2"
                    >
                      <Checkbox
                        id={item.id}
                        checked={!out(item.exclusion.kind, item.exclusion.key)}
                        onCheckedChange={(checked) =>
                          void toggle(item.exclusion, checked)
                        }
                      />
                      <label
                        htmlFor={item.id}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm"
                      >
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          <Private>{item.value}</Private>
                        </span>
                      </label>
                    </div>
                  ))}
                </fieldset>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {entryOpen && (
        <ExpenseEntryDialog
          cards={sortedCards}
          onClose={() => setEntryOpen(false)}
          onSaved={(entry) =>
            setEntries((previous) => [entry, ...(previous ?? [])])
          }
        />
      )}
      {selected && (
        <EntryDetails
          key={selected.id}
          entry={selected}
          cards={sortedCards}
          onClose={() => setSelected(null)}
          onRuleApplied={reload}
          onSaved={(updated) =>
            setEntries((previous) =>
              (previous ?? []).map((entry) =>
                entry.id === updated.id ? toTotalsView(updated) : entry,
              ),
            )
          }
          onDelete={async (id) => {
            const { error } = await client
              .from('financial_entries')
              .delete()
              .eq('id', id)
              .eq('user_id', selected.user_id);
            if (error) throw new Error(error.message);
            setEntries((previous) =>
              (previous ?? []).filter((entry) => entry.id !== id),
            );
            setSelected(null);
          }}
        />
      )}
    </main>
  );
}
