'use client';

/* Home de teste no padrão Apple (skill apple-hig), segunda tentativa
   (29/10/2026): "Resumo" à moda de Saúde/Fitness — anel do dia, pílulas dos
   saldos (as da home, pedido do Bruno), destaques em blocos coloridos com
   minigráficos e a lista de gastos à moda do app Apple Card. Só lê: não
   congela o valor do dia nem mexe no que entra na conta. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Decimal from 'decimal.js';
import {
  ChevronRight,
  CreditCard,
  Flame,
  PiggyBank,
  ReceiptText,
  Sparkles,
  TrendingDown,
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
import { blueTier } from '@/components/streak-badge';
import { WishlistCard } from '@/components/wishlist-card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { barColour } from '@/lib/bank-colors';
import {
  adjustAllowances,
  allowanceForToday,
  daysInTheBlue,
  type AllowanceDay,
} from '@/lib/daily-allowance';
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
import { calculatePortfolio } from '@/lib/portfolio';
import { createClient } from '@/lib/supabase/client';
import { isPendingSpend, pendingEntries } from '@/lib/unidentified-spend';
import { loadUnidentifiedSpend } from '@/lib/unidentified-spend-query';
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

/* Uma cor por assunto, a mesma em toda a tela (e o texto diz o assunto:
   cor nunca é o único sinal). */
const TONES = {
  room: {
    text: 'text-emerald-600 dark:text-emerald-400',
    fill: 'bg-emerald-500',
  },
  spend: {
    text: 'text-orange-600 dark:text-orange-400',
    fill: 'bg-orange-500',
  },
  vault: { text: 'text-sky-600 dark:text-sky-400', fill: 'bg-sky-500' },
  flash: { text: 'text-pink-600 dark:text-pink-400', fill: 'bg-pink-500' },
  income: { text: 'text-teal-600 dark:text-teal-400', fill: 'bg-teal-500' },
} as const;
type Tone = keyof typeof TONES;

/* --- Dados (os mesmos da home) ------------------------------------------ */

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

/* --- Peças -------------------------------------------------------------- */

/** Anel do dia (como os de Atividade): quanto do valor do dia já saiu. */
function DayRing({ percent, over }: { percent: number; over: boolean }) {
  const size = 108;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="shrink-0 -rotate-90"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-foreground/10"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - Math.max(percent, 1) / 100)}
        className={cn(
          'transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none',
          over ? 'stroke-destructive' : 'stroke-emerald-500',
        )}
      />
    </svg>
  );
}

/**
 * Bloco de destaque (como os de Saúde): ícone e assunto na cor do assunto,
 * valor grande, legenda, e um minigráfico opcional embaixo. Tocar abre a tela.
 */
function Tile({
  tone,
  icon: Icon,
  title,
  value,
  caption,
  href,
  children,
  className,
}: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  href: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex min-w-0 flex-col rounded-3xl bg-card p-4 ring-1 ring-border/60 transition-[transform,background-color] hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:active:scale-100',
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon aria-hidden="true" className={cn('size-4', TONES[tone].text)} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[15px] font-semibold',
            TONES[tone].text,
          )}
        >
          {title}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
        />
      </span>
      <span className="mt-4 block text-[22px] leading-7 font-bold tracking-tight tabular-nums">
        {value}
      </span>
      {caption && (
        <span className="mt-0.5 block text-[13px] text-muted-foreground">
          {caption}
        </span>
      )}
      {children && <span className="mt-3 block">{children}</span>}
    </Link>
  );
}

/** Minigráfico de barras (7 dias); hoje na cor cheia, futuros apagados. */
function MiniBars({
  days,
  today,
  tone,
}: {
  days: { day: string; total: string | null }[];
  today: string;
  tone: Tone;
}) {
  const max = Math.max(1, ...days.map((day) => Number(day.total ?? 0)));
  return (
    <span aria-hidden="true" className="flex h-12 items-end gap-1.5">
      {days.map((day) => (
        <span
          key={day.day}
          className={cn(
            'flex-1 rounded-[3px]',
            day.total === null
              ? 'bg-foreground/5'
              : day.day === today
                ? TONES[tone].fill
                : 'bg-foreground/20',
          )}
          style={{
            height:
              day.total === null
                ? '3px'
                : `${Math.max(6, (Number(day.total) / max) * 100)}%`,
          }}
        />
      ))}
    </span>
  );
}

/* --- Tela --------------------------------------------------------------- */

export function HomeApple() {
  const { client, entries, setEntries, cards, balances, failed, reload } =
    useHomeData();
  const { banks, rates, loading: vaultsLoading } = useVaultData();
  const [entryOpen, setEntryOpen] = useState(false);
  const [selected, setSelected] = useState<FinancialEntry | null>(null);
  const todayKey = saoDate(new Date());

  const list = useMemo(() => entries ?? [], [entries]);
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
    const sum = (values: number[]) =>
      values.reduce((total, value) => total.plus(value), new Decimal(0));
    const balance = sum(accounts.map((item) => item.balance));
    const free = sum(limits.map((item) => item.available));
    const flash = sum(benefits.map((item) => item.balance));
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
    return {
      total: balance.plus(free).plus(flash),
      balance,
      free,
      flash,
      parts,
      positive: parts.reduce((total, part) => total + part.value, 0),
    };
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

  /* Hoje: o número que a home existe para responder, com o anel ao lado. */
  const hero = today ? (
    <section
      aria-label="Hoje"
      className="rounded-[28px] bg-card p-5 ring-1 ring-border/60"
    >
      <div className="flex items-center gap-5">
        <div className="relative grid place-items-center">
          <DayRing percent={today.percent} over={today.over} />
          <span className="absolute text-center">
            <span className="block text-[17px] leading-5 font-bold tabular-nums">
              {Math.round(today.percent)}%
            </span>
            <span className="block text-[11px] text-muted-foreground">
              usado
            </span>
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-muted-foreground">
            {today.over ? 'Hoje você passou' : 'Hoje ainda dá'}
          </p>
          <p
            className={cn(
              'text-[34px] leading-[41px] font-bold tracking-tight tabular-nums',
              today.over ? 'text-destructive' : TONES.room.text,
            )}
          >
            <Private>
              {money(
                today.over ? today.spent.minus(today.allowance) : today.left,
              )}
            </Private>
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            de <Private>{money(today.allowance)}</Private> · até{' '}
            {shortDay(today.until)}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/70 pt-3 text-[13px]">
        <span className="text-muted-foreground">
          {today.days === 1
            ? 'Último dia do período'
            : `${today.days} dias até o fim do mês`}
        </span>
        {today.blue.total > 0 && (
          <span
            className="inline-flex items-center gap-1 font-semibold"
            title={today.blue.provisional ? 'Provisório' : undefined}
          >
            <Flame
              aria-hidden="true"
              className={cn(
                'size-4 fill-current',
                blueTier(today.blue.total).text,
              )}
            />
            {today.blue.total}{' '}
            {today.blue.total === 1 ? 'dia no azul' : 'dias no azul'}
          </span>
        )}
      </div>
      {today.pending.length > 0 && (
        <p className="mt-2 text-[13px] text-muted-foreground">
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
        <p className="mt-2 text-[13px] text-destructive">
          Faltam <Private>{money(today.short)}</Private> para cobrir as
          assinaturas do mês.
        </p>
      )}
    </section>
  ) : (
    <Skeleton className="h-48 rounded-[28px]" />
  );

  /* Destaques: blocos de assunto, dois por linha no celular. */
  const weekDiff = new Decimal(week.total).minus(week.previous);
  const tiles = (
    <section aria-labelledby="destaques">
      <h2
        id="destaques"
        className="mb-3 px-1 text-[22px] leading-7 font-bold tracking-tight"
      >
        Destaques
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {room ? (
          <Tile
            tone="room"
            icon={Wallet}
            title="No mês"
            value={<Private>{money(room.total)}</Private>}
            caption="disponível até o fim do mês"
            href="/financeiro"
            className="col-span-2"
          >
            <span
              aria-hidden="true"
              className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-foreground/10"
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
            </span>
            <span className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              <span>
                Contas <Private>{money(room.balance)}</Private>
              </span>
              {room.flash.gt(0) && (
                <span>
                  Flash <Private>{money(room.flash)}</Private>
                </span>
              )}
              <span>
                Limite <Private>{money(room.free)}</Private>
              </span>
            </span>
          </Tile>
        ) : (
          <Skeleton className="col-span-2 h-36 rounded-3xl" />
        )}
        {entries === null ? (
          <>
            <Skeleton className="h-40 rounded-3xl" />
            <Skeleton className="h-40 rounded-3xl" />
          </>
        ) : (
          <>
            <Tile
              tone="spend"
              icon={TrendingDown}
              title="Semana"
              value={<Private>{money(week.total)}</Private>}
              caption={
                weekDiff.isZero() ? (
                  'igual à anterior'
                ) : (
                  <>
                    <Private>{money(weekDiff.abs())}</Private>{' '}
                    {weekDiff.isNegative() ? 'a menos' : 'a mais'}
                  </>
                )
              }
              href="/resumo"
            >
              <MiniBars days={week.days} today={todayKey} tone="spend" />
            </Tile>
            <Tile
              tone="spend"
              icon={ReceiptText}
              title="Mês"
              value={<Private>{money(month.expenses)}</Private>}
              caption={
                <>
                  entrou <Private>{money(month.income)}</Private>
                </>
              }
              href="/financeiro"
            >
              <span
                aria-hidden="true"
                className="block h-2 overflow-hidden rounded-full bg-teal-500/25"
              >
                <span
                  className={cn('block h-full rounded-full', TONES.spend.fill)}
                  style={{
                    width: `${
                      month.income.gt(0)
                        ? Math.min(
                            100,
                            month.expenses
                              .div(month.income)
                              .times(100)
                              .toNumber(),
                          )
                        : 100
                    }%`,
                  }}
                />
              </span>
              <span className="mt-1.5 block text-[11px] text-muted-foreground">
                gasto × entrada
              </span>
            </Tile>
          </>
        )}
        {vaultsLoading ? (
          <Skeleton className="h-36 rounded-3xl" />
        ) : (
          <Tile
            tone="vault"
            icon={PiggyBank}
            title="Cofrinhos"
            value={<Private>{money(portfolio.netBalance)}</Private>}
            caption={
              <>
                +
                <Private>
                  {money(Decimal.max(portfolio.lifetimeNetGain, 0))}
                </Private>{' '}
                rendidos
              </>
            }
            href="/cobertura"
          />
        )}
        {room && room.flash.gt(0) && (
          <Tile
            tone="flash"
            icon={CreditCard}
            title="Flash"
            value={<Private>{money(room.flash)}</Private>}
            caption="nos benefícios"
            href="/beneficios"
          />
        )}
        {recapIsFresh() && (
          <Tile
            tone="income"
            icon={Sparkles}
            title="Retrospectiva"
            value={
              <span className="first-letter:uppercase">
                {monthLabel(recapDefaultMonth()).split(' ')[0]}
              </span>
            }
            caption="maior compra, dias sem gastar"
            href="/retrospectiva"
          />
        )}
      </div>
    </section>
  );

  /* Gastos recentes: uma lista só, como as transações do Apple Card. */
  const recent = expenses.slice(0, 8);
  const transactions = (
    <section aria-labelledby="gastos">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <h2
          id="gastos"
          className="text-[22px] leading-7 font-bold tracking-tight"
        >
          Últimos gastos
        </h2>
        <Link
          href="/financeiro"
          className="inline-flex min-h-11 items-center text-[15px] text-primary"
        >
          Ver todos
        </Link>
      </div>
      {entries === null ? (
        <Skeleton className="h-96 rounded-3xl" />
      ) : recent.length === 0 ? (
        <div className="rounded-3xl bg-card p-6 text-center ring-1 ring-border/60">
          <p className="text-[15px] font-medium">Nenhum gasto ainda</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Toque em + no topo para registrar o primeiro.
          </p>
        </div>
      ) : (
        <ul className="overflow-clip rounded-3xl bg-card ring-1 ring-border/60">
          {recent.map((entry) => (
            <li
              key={entry.id}
              className="border-b border-border/70 last:border-b-0"
            >
              {isPendingSpend(entry) ? (
                <div className="px-2">
                  <ExpenseLine
                    entry={entry}
                    cards={sortedCards}
                    onOpen={setSelected}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring active:bg-muted/70"
                >
                  <PaymentCardIcon
                    bankId={resolvePaymentMethod(entry.account, cards)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">
                      {entry.description}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {entry.category}
                    </span>
                    <span className="block text-[13px] text-muted-foreground">
                      {dayLabel(saoDate(entry.occurred_at), todayKey)} ·{' '}
                      {time(entry.occurred_at)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 self-start pt-0.5 text-[15px] font-semibold tabular-nums',
                      entry.excluded_from_totals &&
                        'text-muted-foreground line-through',
                    )}
                  >
                    <Private>{money(myShare(entry))}</Private>
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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
            Resumo
          </h1>
        </header>

        {failed && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-card p-4 ring-1 ring-border/60">
            <p className="text-[15px]">Não foi possível atualizar os gastos.</p>
            <Button variant="glass" onClick={() => void reload()}>
              Tentar de novo
            </Button>
          </div>
        )}

        <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <div className="grid min-w-0 gap-5">
            {hero}
            {pills}
            {tiles}
          </div>
          <div className="grid min-w-0 gap-8">
            {transactions}
            <section
              aria-label="Lista de desejos"
              className="rounded-3xl bg-card p-4 ring-1 ring-border/60"
            >
              <WishlistCard
                entries={list.filter((entry) => !isPendingSpend(entry))}
                flat
              />
            </section>
          </div>
        </div>
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
