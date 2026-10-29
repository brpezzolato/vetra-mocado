'use client';

/* Home de teste no padrão das Human Interface Guidelines (skill apple-hig,
   pedido do Bruno em 29/10/2026). Os mesmos dados da home, desenho novo:
   título grande, "hoje" em destaque, listas agrupadas e um controle
   segmentado no lugar da pílula arrastável. Só lê: não congela o valor do
   dia nem mexe no que entra na conta (isso continua na home oficial). */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Decimal from 'decimal.js';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Flame,
  Sparkles,
} from 'lucide-react';
import Link from '@/components/navigation-link';
import { AppHeader } from '@/components/app-header';
import { EntryDetails } from '@/components/entry-details';
import { ExpenseEntryDialog } from '@/components/expense-entry-dialog';
import { ExpenseLine, dayLabel } from '@/components/expense-line';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Private } from '@/components/private-value';
import { blueTier } from '@/components/streak-badge';
import { WishlistCard } from '@/components/wishlist-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { recapDefaultMonth, recapIsFresh } from '@/lib/monthly-recap';
import {
  cardBankName,
  resolvePaymentMethod,
  sortPaymentCardsByUsage,
  suggestedCardBank,
  type PaymentCard,
} from '@/lib/payment-cards';
import { monthLabel } from '@/lib/period-summary';
import { calculatePortfolio, yieldOnly } from '@/lib/portfolio';
import { createClient } from '@/lib/supabase/client';
import { isPendingSpend, pendingEntries } from '@/lib/unidentified-spend';
import { loadUnidentifiedSpend } from '@/lib/unidentified-spend-query';
import { useMediaQuery } from '@/lib/use-media-query';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import { useVaultData } from '@/lib/use-vault-data';
import { cn } from '@/lib/utils';

type BankKey = 'nubank' | 'itau' | 'picpay' | 'mercado-pago';
type Balances = {
  accounts: { bank: BankKey; balance: number }[];
  cards: { key: string; limit: number; available: number }[];
  benefits: { key: string; label: string; balance: number }[];
  excluded: { kind: 'account' | 'card'; key: string }[];
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
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const time = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));

const SECTIONS = ['gastos', 'semana', 'cofrinhos'] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<Section, string> = {
  gastos: 'Gastos',
  semana: 'Semana',
  cofrinhos: 'Cofrinhos',
};

/* --- Peças do desenho (lista agrupada à moda do iOS) -------------------- */

/** Cabeçalho de seção: título 3 em negrito e um link opcional no fim. */
function SectionHeader({
  title,
  href,
  action,
}: {
  title: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="mb-2 flex min-h-11 items-end justify-between gap-3 px-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {href && action && (
        <Link
          href={href}
          className="inline-flex min-h-11 items-center gap-0.5 text-[15px] text-primary"
        >
          {action}
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      )}
    </div>
  );
}

/** Grupo: cartão sólido (camada de conteúdo, sem vidro) com linhas. */
function Group({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-clip rounded-3xl bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-border/60',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Linha de lista: ícone de 30px, título e detalhe, valor no fim e chevron
 * quando navega. Separador recuado até o texto (como no iOS).
 */
function Row({
  icon,
  title,
  detail,
  value,
  valueDetail,
  href,
  onClick,
  tone,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  value?: React.ReactNode;
  valueDetail?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  tone?: 'positive' | 'negative' | 'muted';
}) {
  const body = (
    <>
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch border-b border-border/70 py-3 pr-4 group-last/row:border-b-0">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">
            {title}
          </span>
          {detail && (
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
              {detail}
            </span>
          )}
        </span>
        {value !== undefined && (
          <span className="shrink-0 text-right">
            <span
              className={cn(
                'block text-[15px] font-semibold tabular-nums',
                tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
                tone === 'negative' && 'text-destructive',
                tone === 'muted' && 'text-muted-foreground',
              )}
            >
              {value}
            </span>
            {valueDetail && (
              <span className="block text-[13px] text-muted-foreground tabular-nums">
                {valueDetail}
              </span>
            )}
          </span>
        )}
        {(href || onClick) && (
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground/60"
          />
        )}
      </span>
    </>
  );
  const rowClass =
    'group/row flex min-h-14 w-full items-center gap-3 pl-4 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';
  const pressable = 'hover:bg-muted/40 active:bg-muted/70';
  if (href)
    return (
      <Link href={href} className={cn(rowClass, pressable)}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(rowClass, pressable)}
      >
        {body}
      </button>
    );
  return <div className={rowClass}>{body}</div>;
}

function LogoMark({ src }: { src: string | null }) {
  return (
    <span className="grid size-[30px] place-items-center overflow-hidden rounded-[9px] bg-background ring-1 ring-border/70">
      {src && (
        <Image
          src={src}
          alt=""
          width={20}
          height={20}
          unoptimized
          className="size-5 object-contain"
        />
      )}
    </span>
  );
}

/* --- Dados -------------------------------------------------------------- */

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
    if (nextBalances) setBalances(nextBalances);
  }, [client]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  useResumeRefresh(load);
  return { client, entries, setEntries, cards, balances, failed, reload: load };
}

/* --- Tela --------------------------------------------------------------- */

export function HomeApple() {
  const { client, entries, setEntries, cards, balances, failed, reload } =
    useHomeData();
  const { banks, rates, loading: vaultsLoading } = useVaultData();
  const [section, setSection] = useState<Section>('gastos');
  const [entryOpen, setEntryOpen] = useState(false);
  const [selected, setSelected] = useState<FinancialEntry | null>(null);
  const wide = useMediaQuery('(min-width: 1024px)');
  const todayKey = saoDate(new Date());

  const list = useMemo(() => entries ?? [], [entries]);
  const expenses = useMemo(
    () =>
      list
        .filter(
          (entry) =>
            entry.entry_type === 'expense' &&
            new Date(entry.occurred_at) <= new Date() &&
            // Parcela antiga não é gasto do dia (igual à home).
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

  /* Ainda dá para gastar no mês e hoje (as mesmas contas da home). */
  const room = useMemo(() => {
    if (!balances) return null;
    const out = (kind: 'account' | 'card', key: string) =>
      balances.excluded.some((item) => item.kind === kind && item.key === key);
    const accounts = balances.accounts.filter(
      (account) => !out('account', account.bank),
    );
    const limits = balances.cards.filter((card) => !out('card', card.key));
    const benefits = balances.benefits.filter(
      (benefit) => !out('account', `flash-${benefit.key}`),
    );
    const total = [
      ...accounts.map((item) => item.balance),
      ...limits.map((item) => item.available),
      ...benefits.map((item) => item.balance),
    ].reduce((sum, value) => sum.plus(value), new Decimal(0));
    const parts = [
      ...accounts.map((item) => ({
        id: `a-${item.bank}`,
        colour: barColour(item.bank, 'balance'),
        value: item.balance,
      })),
      ...benefits.map((item) => ({
        id: `b-${item.key}`,
        colour: barColour('flash', 'balance'),
        value: item.balance,
      })),
      ...limits.map((item) => ({
        id: `c-${item.key}`,
        colour: barColour(suggestedCardBank(item.key), 'limit'),
        value: item.available,
      })),
    ].filter((part) => part.value > 0);
    const positive = parts.reduce((sum, part) => sum + part.value, 0);
    return { accounts, limits, benefits, total, parts, positive };
  }, [balances]);

  const today = useMemo(() => {
    const plan = balances?.plan;
    if (!plan || !room) return null;
    const spent = new Decimal(plan.spentByDay[todayKey] ?? 0);
    const computed = allowanceForToday({
      today: todayKey,
      room: room.total,
      spentToday: spent,
      subscriptions: plan.subscriptions,
    });
    const { adjusted } = adjustAllowances({
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
      pending: (plan.unidentified ?? []).filter(
        (item) => item.day === todayKey,
      ),
    };
  }, [balances, room, todayKey]);

  const dateLine = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());

  /* Hoje: a pergunta da home ("quanto posso gastar?") vem primeiro. */
  const todayCard = today ? (
    <Group className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[15px] text-muted-foreground">
            {today.over ? 'Hoje você passou' : 'Hoje ainda dá para gastar'}
          </p>
          <p
            className={cn(
              'mt-1 text-[34px] leading-[41px] font-bold tracking-tight tabular-nums',
              today.over && 'text-destructive',
            )}
          >
            <Private>
              {money(
                today.over ? today.spent.minus(today.allowance) : today.left,
              )}
            </Private>
          </p>
        </div>
        {today.blue.total > 0 && (
          <span
            className="flex shrink-0 flex-col items-end"
            title={today.blue.provisional ? 'Provisório' : undefined}
          >
            <span className="inline-flex items-center gap-1 text-[17px] font-semibold tabular-nums">
              <Flame
                aria-hidden="true"
                className={cn(
                  'size-4 fill-current',
                  blueTier(today.blue.total).text,
                )}
              />
              {today.blue.total}
            </span>
            <span className="text-[13px] text-muted-foreground">
              {today.blue.total === 1 ? 'dia no azul' : 'dias no azul'}
            </span>
          </span>
        )}
      </div>
      <div
        aria-hidden="true"
        className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/10"
      >
        <span
          className={cn(
            'block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
            today.over ? 'bg-destructive' : 'bg-emerald-500',
          )}
          style={{ width: `${today.percent}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-muted-foreground">
        <span>
          Gastou <Private>{money(today.spent)}</Private> de{' '}
          <Private>{money(today.allowance)}</Private>
        </span>
        <span>
          até {shortDay(today.until)} ·{' '}
          {today.days === 1 ? 'último dia' : `${today.days} dias`}
        </span>
      </div>
      {today.pending.length > 0 && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Inclui{' '}
          {today.pending.map((item, index) => (
            <span key={item.account}>
              {index > 0 && ' e '}
              <Private>{money(item.amount)}</Private> no{' '}
              {cardBankName(suggestedCardBank(item.account))}
            </span>
          ))}{' '}
          que o limite já mostra e a compra ainda não chegou.
        </p>
      )}
      {today.short.gt(0) && (
        <p className="mt-3 text-[13px] text-destructive">
          Faltam <Private>{money(today.short)}</Private> para cobrir as
          assinaturas do mês.
        </p>
      )}
    </Group>
  ) : (
    <Skeleton className="h-44 rounded-3xl" />
  );

  /* O mês: total com a barra das origens e uma linha por conta/limite. */
  const monthCard = room ? (
    <section>
      <SectionHeader title="Disponível no mês" />
      <Group>
        <div className="px-4 pt-4 pb-3">
          <p className="text-[28px] leading-[34px] font-bold tracking-tight tabular-nums">
            <Private>{money(room.total)}</Private>
          </p>
          <div
            aria-hidden="true"
            className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-foreground/10"
          >
            {room.parts.map((part) => (
              <span
                key={part.id}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(part.value / room.positive) * 100}%`,
                  background: part.colour,
                }}
              />
            ))}
          </div>
        </div>
        <div className="border-t border-border/70">
          {room.accounts.map((account) => (
            <Row
              key={account.bank}
              icon={<LogoMark src={BANKS[account.bank].logo} />}
              title={BANKS[account.bank].name}
              detail="Conta corrente"
              value={<Private>{money(account.balance)}</Private>}
              tone={account.balance < 0 ? 'negative' : undefined}
              href={`/bancos/${account.bank}`}
            />
          ))}
          {room.benefits.map((benefit) => (
            <Row
              key={benefit.key}
              icon={<LogoMark src="/logos/flash-f-pink-ui.webp" />}
              title={benefit.label}
              detail="Flash"
              value={<Private>{money(benefit.balance)}</Private>}
              href="/beneficios"
            />
          ))}
          {room.limits.map((card) => (
            <Row
              key={card.key}
              icon={
                <PaymentCardIcon
                  bankId={resolvePaymentMethod(card.key, cards)}
                />
              }
              title={card.key}
              detail="Limite livre"
              value={<Private>{money(card.available)}</Private>}
              valueDetail={
                <>
                  de <Private>{money(card.limit)}</Private>
                </>
              }
              href="/faturas"
            />
          ))}
        </div>
      </Group>
    </section>
  ) : (
    <Skeleton className="h-72 rounded-3xl" />
  );

  /* Gastos: por dia, títulos de seção e linhas agrupadas. */
  const recent = expenses.slice(0, 20);
  const byDay = recent.reduce<[string, FinancialEntry[]][]>((days, entry) => {
    const day = saoDate(entry.occurred_at);
    const last = days.at(-1);
    if (last && last[0] === day) last[1].push(entry);
    else days.push([day, [entry]]);
    return days;
  }, []);
  const spending = (
    <section>
      <SectionHeader
        title="Últimos gastos"
        href="/financeiro"
        action="Ver todos"
      />
      {entries === null ? (
        <Skeleton className="h-96 rounded-3xl" />
      ) : byDay.length === 0 ? (
        <Group className="p-6 text-center">
          <p className="text-[15px] font-medium">Nenhum gasto ainda</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Toque em + no topo para registrar o primeiro.
          </p>
        </Group>
      ) : (
        <div className="grid gap-5">
          {byDay.map(([day, items]) => (
            <div key={day}>
              <p className="mb-1.5 px-4 text-[13px] font-medium text-muted-foreground">
                {dayLabel(day, todayKey)}
              </p>
              <Group>
                {items.map((entry) =>
                  isPendingSpend(entry) ? (
                    <div key={entry.id} className="px-2">
                      <ExpenseLine
                        entry={entry}
                        cards={sortedCards}
                        onOpen={setSelected}
                      />
                    </div>
                  ) : (
                    <Row
                      key={entry.id}
                      icon={
                        <PaymentCardIcon
                          bankId={resolvePaymentMethod(entry.account, cards)}
                        />
                      }
                      title={entry.description}
                      detail={`${entry.category} · ${time(entry.occurred_at)}`}
                      value={
                        <Private>
                          {entry.excluded_from_totals ? '' : '−'}
                          {money(myShare(entry))}
                        </Private>
                      }
                      valueDetail={
                        entry.excluded_from_totals
                          ? 'fora das contas'
                          : undefined
                      }
                      tone={entry.excluded_from_totals ? 'muted' : undefined}
                      onClick={() => setSelected(entry)}
                    />
                  ),
                )}
              </Group>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  /* Semana: total, comparação com a anterior e um dia por barra. */
  const weekMax = Math.max(
    1,
    ...week.days.map((day) => Number(day.total ?? 0)),
  );
  const difference = new Decimal(week.total).minus(week.previous);
  const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const weekly = (
    <section>
      <SectionHeader title="Esta semana" href="/resumo" action="Resumo" />
      {entries === null ? (
        <Skeleton className="h-80 rounded-3xl" />
      ) : (
        <div className="grid gap-5">
          <Group className="p-5">
            <p className="text-[28px] leading-[34px] font-bold tracking-tight tabular-nums">
              <Private>{money(week.total)}</Private>
            </p>
            <p className="mt-1 flex items-center gap-1 text-[13px] text-muted-foreground">
              {difference.isZero() ? (
                'Igual à semana passada'
              ) : (
                <>
                  {difference.isNegative() ? (
                    <ArrowDownRight
                      aria-hidden="true"
                      className="size-3.5 text-emerald-600 dark:text-emerald-400"
                    />
                  ) : (
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-3.5 text-destructive"
                    />
                  )}
                  <Private>{money(difference.abs())}</Private>
                  {difference.isNegative() ? ' a menos' : ' a mais'} que a
                  semana passada
                </>
              )}
            </p>
            {/* Um dia por barra; hoje em destaque, futuros vazios. */}
            <ul className="mt-5 grid h-28 grid-cols-7 items-end gap-2">
              {week.days.map((day, index) => {
                const value = Number(day.total ?? 0);
                const isToday = day.day === todayKey;
                return (
                  <li
                    key={day.day}
                    className="flex h-full flex-col items-center justify-end gap-1.5"
                  >
                    <span className="sr-only">
                      {dayLabel(day.day, todayKey)}:{' '}
                      {day.total === null ? 'ainda não chegou' : money(value)}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'w-full max-w-7 rounded-md',
                        day.total === null
                          ? 'bg-foreground/5'
                          : isToday
                            ? 'bg-primary'
                            : 'bg-foreground/25',
                      )}
                      style={{
                        height:
                          day.total === null
                            ? '4px'
                            : `${Math.max(4, (value / weekMax) * 100)}%`,
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'text-[11px] text-muted-foreground',
                        isToday && 'font-semibold text-foreground',
                      )}
                    >
                      {weekdays[index]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Group>
          {week.categories.length > 0 && (
            <Group>
              {week.categories.slice(0, 4).map((category) => (
                <Row
                  key={category.name}
                  title={category.name}
                  detail={`${new Decimal(category.total)
                    .div(Decimal.max(week.total, 1))
                    .times(100)
                    .toFixed(0)}% da semana`}
                  value={<Private>{money(category.total)}</Private>}
                />
              ))}
            </Group>
          )}
          <Group>
            <Row
              title="Gastos do mês"
              detail="Lançamentos registrados"
              value={<Private>{money(month.expenses)}</Private>}
              href="/financeiro"
            />
            <Row
              title="Entrou no mês"
              detail="Salário, Flash e entradas escolhidas"
              value={<Private>{money(month.income)}</Private>}
              tone="positive"
              href="/resumo"
            />
          </Group>
        </div>
      )}
    </section>
  );

  /* Cofrinhos: total, quanto rendeu e um por linha; desejos embaixo. */
  const vaults = (
    <section>
      <SectionHeader title="Cofrinhos" href="/cobertura" action="Cobertura" />
      {vaultsLoading ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : (
        <div className="grid gap-5">
          <Group>
            <div className="px-4 pt-4 pb-3">
              <p className="text-[28px] leading-[34px] font-bold tracking-tight tabular-nums">
                <Private>{money(portfolio.netBalance)}</Private>
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +
                  <Private>
                    {money(Decimal.max(portfolio.lifetimeNetGain, 0))}
                  </Private>
                </span>{' '}
                de rendimento desde o começo
              </p>
            </div>
            <div className="border-t border-border/70">
              {portfolio.results.map(({ bank, result }) => (
                <Row
                  key={bank.id}
                  icon={<LogoMark src={bankLogo(bank.bank)} />}
                  title={bank.name}
                  detail={
                    <>
                      +
                      <Private>
                        {money(Decimal.max(yieldOnly(result.earnings), 0))}
                      </Private>{' '}
                      rendidos
                    </>
                  }
                  value={<Private>{money(result.netBalance)}</Private>}
                  href={`/cofrinhos/${bank.id}`}
                />
              ))}
            </div>
          </Group>
          <Group className="p-4">
            <WishlistCard
              entries={list.filter((entry) => !isPendingSpend(entry))}
              flat
            />
          </Group>
        </div>
      )}
    </section>
  );

  const recapRow = recapIsFresh() && (
    <Group>
      <Row
        icon={
          <span className="grid size-[30px] place-items-center rounded-[9px] bg-primary text-primary-foreground">
            <Sparkles aria-hidden="true" className="size-4" />
          </span>
        }
        title={
          <span className="first-letter:uppercase">
            Retrospectiva de {monthLabel(recapDefaultMonth()).split(' ')[0]}
          </span>
        }
        detail="Maior compra, dias sem gastar e rendimento"
        href="/retrospectiva"
      />
    </Group>
  );

  const content: Record<Section, React.ReactNode> = {
    gastos: spending,
    semana: weekly,
    cofrinhos: vaults,
  };

  return (
    <main className="min-h-screen overflow-x-clip bg-background text-foreground">
      <AppHeader onRefresh={reload} onAdd={() => setEntryOpen(true)} />
      <div className="app-container min-w-0 pt-5 pb-12 md:pt-8">
        {/* Título grande, com o dia por cima (como Saúde e Fitness). */}
        <header className="mb-6 px-1">
          <p className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
            {dateLine}
          </p>
          <h1 className="mt-0.5 text-[34px] leading-[41px] font-bold tracking-tight">
            Início
          </h1>
        </header>

        {failed && (
          <Group className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-[15px]">Não foi possível atualizar os gastos.</p>
            <Button variant="glass" onClick={() => void reload()}>
              Tentar de novo
            </Button>
          </Group>
        )}

        {wide ? (
          // Largo: tudo visível em duas colunas, sem controle segmentado.
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-start gap-8">
            <div className="grid min-w-0 gap-8">
              {todayCard}
              {recapRow}
              {monthCard}
              {vaults}
            </div>
            <div className="grid min-w-0 gap-8">
              {weekly}
              {spending}
            </div>
          </div>
        ) : (
          <div className="grid min-w-0 gap-8">
            {todayCard}
            {recapRow}
            {monthCard}
            <div className="min-w-0">
              {/* Controle segmentado: três seções, toque troca. */}
              <Tabs
                value={section}
                onValueChange={(value) => setSection(value as Section)}
              >
                <TabsList className="mb-5 h-9 w-full">
                  {SECTIONS.map((value) => (
                    <TabsTrigger key={value} value={value} className="flex-1">
                      {SECTION_LABEL[value]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {content[section]}
            </div>
          </div>
        )}
      </div>

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
