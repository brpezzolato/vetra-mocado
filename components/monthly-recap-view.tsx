'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Decimal from 'decimal.js';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Crown,
  Flame,
  PiggyBank,
  ShoppingBag,
  Sparkles,
  Store,
  Sun,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { saoDate } from '@/lib/expense-insights';
import { spentByDayOf, type AllowanceDay } from '@/lib/daily-allowance';
import type { FinancialEntry } from '@/lib/financial-tracker';
import {
  monthlyRecap,
  recapDefaultMonth,
  shiftMonth,
} from '@/lib/monthly-recap';
import { monthLabel, monthsWithEntries } from '@/lib/period-summary';
import { calculatePortfolio, yieldOnly } from '@/lib/portfolio';
import { useVaultData } from '@/lib/use-vault-data';
import { cn } from '@/lib/utils';

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value || 0).toNumber());

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${day}T12:00:00Z`));

const monthName = (month: string) => monthLabel(month).split(' ')[0];

/** Um destaque. Cartão neutro, como o resto do app; a cor fica só no
 * ícone. */
function RecapCard({
  icon: Icon,
  eyebrow,
  tone,
  className,
  children,
}: {
  icon: LucideIcon;
  eyebrow: string;
  tone: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex min-h-40 flex-col rounded-3xl border bg-card p-5 shadow-sm',
        className,
      )}
    >
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn('grid size-7 place-items-center rounded-full', tone)}
        >
          <Icon className="size-3.5" />
        </span>
        {eyebrow}
      </p>
      <div className="mt-auto pt-5">{children}</div>
    </section>
  );
}

export function MonthlyRecapView({
  entries,
  allowances = [],
}: {
  entries: FinancialEntry[];
  /** Os valores do dia do "Hoje você pode" (`daily_allowances`). */
  allowances?: AllowanceDay[];
}) {
  const today = saoDate(new Date()).slice(0, 7);
  const first = monthsWithEntries(entries).at(-1) ?? today;
  const [month, setMonth] = useState(() => recapDefaultMonth());
  const recap = useMemo(() => monthlyRecap(entries, month), [entries, month]);
  // Dias no azul do mês: com o gasto dentro do valor do dia
  // (lib/daily-allowance.ts). Gasto do dia sem parcelas, como na home.
  const inTheBlue = useMemo(() => {
    const spentByDay = spentByDayOf(entries);
    const days = allowances.filter((item) => item.day.startsWith(month));
    if (!days.length) return null;
    const blue = days.filter((item) =>
      new Decimal(spentByDay[item.day] ?? 0).lte(item.allowance),
    ).length;
    return { blue, total: days.length };
  }, [allowances, entries, month]);

  const { banks, rates, loading: vaultsLoading } = useVaultData();
  const vaults = useMemo(() => {
    if (!banks.length || !rates.length) return null;
    const portfolio = calculatePortfolio(banks, rates);
    const start = `${month}-01`,
      end = `${month}-31`;
    const perVault = portfolio.results
      .map(({ bank, result }) => ({
        name: bank.name,
        net: yieldOnly(result.earnings, start, end),
      }))
      .sort((a, b) => b.net.comparedTo(a.net));
    return {
      total: perVault.reduce((sum, item) => sum.plus(item.net), new Decimal(0)),
      best: perVault[0]?.net.gt(0) ? perVault[0] : null,
    };
  }, [banks, rates, month]);

  const delta = recap.previous?.deltaPercent ?? null;
  const name = monthName(month);
  const hasData = recap.count > 0;

  return (
    <main className="min-h-screen overflow-x-clip bg-background text-foreground">
      <AppHeader onRefresh={() => window.location.reload()} />
      <div className="app-container mx-auto max-w-5xl py-6 md:py-9">
        <NavigationBackButton fallback="/" className="mb-5" />
        <h1 className="text-2xl font-semibold tracking-tight">Retrospectiva</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          O seu mês em destaques: onde o dinheiro foi, o que mudou e quanto os
          cofrinhos renderam.
        </p>

        <div className="mx-auto mt-6 mb-5 flex w-full max-w-xs items-center gap-2">
          <Button
            variant="glass-quiet"
            size="icon"
            className="shrink-0"
            aria-label="Mês anterior"
            disabled={month <= first}
            onClick={() => setMonth((value) => shiftMonth(value, -1))}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-0 flex-1 truncate text-center text-sm font-medium first-letter:uppercase">
            {monthLabel(month)}
          </span>
          <Button
            variant="glass-quiet"
            size="icon"
            className="shrink-0"
            aria-label="Próximo mês"
            disabled={month >= today}
            onClick={() => setMonth((value) => shiftMonth(value, 1))}
          >
            <ChevronRight />
          </Button>
        </div>

        {!hasData ? (
          <p className="rounded-3xl border bg-card p-6 text-center text-sm text-muted-foreground">
            Nenhum gasto registrado em {name}.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <RecapCard
              icon={Sparkles}
              eyebrow={recap.partial ? `${name} até agora` : `Seu ${name}`}
              tone="bg-violet-500/12 text-violet-600 dark:text-violet-400"
              className="min-h-48 sm:col-span-2 lg:col-span-3"
            >
              <p className="text-sm text-muted-foreground">Você gastou</p>
              <p className="mt-1 text-4xl font-bold tracking-tight md:text-5xl">
                <Private>{money(recap.spent)}</Private>
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {recap.count}{' '}
                  {recap.count === 1 ? 'lançamento' : 'lançamentos'}
                </span>
                {delta !== null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 font-medium text-foreground">
                    {delta > 0 ? (
                      <ArrowUpRight aria-hidden="true" className="size-3.5" />
                    ) : (
                      <ArrowDownRight aria-hidden="true" className="size-3.5" />
                    )}
                    {Math.abs(delta).toLocaleString('pt-BR')}%{' '}
                    {delta > 0 ? 'a mais' : 'a menos'} que em{' '}
                    {monthName(recap.previous!.month)}
                  </span>
                )}
              </p>
            </RecapCard>

            {recap.biggestPurchase && (
              <RecapCard
                icon={ShoppingBag}
                eyebrow="Maior compra"
                tone="bg-orange-500/12 text-orange-600 dark:text-orange-400"
              >
                <p className="truncate text-lg font-semibold">
                  {recap.biggestPurchase.description}
                </p>
                <p className="mt-1 text-3xl font-bold tracking-tight">
                  <Private>{money(recap.biggestPurchase.amount)}</Private>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dayLabel(recap.biggestPurchase.day)}
                  {recap.biggestPurchase.installments &&
                    ` · em ${recap.biggestPurchase.installments}×`}
                </p>
              </RecapCard>
            )}

            {recap.risingCategory && (
              <RecapCard
                icon={TrendingUp}
                eyebrow="Categoria que mais subiu"
                tone="bg-rose-500/12 text-rose-600 dark:text-rose-400"
              >
                <p className="truncate text-lg font-semibold">
                  {recap.risingCategory.name}
                </p>
                <p className="mt-1 text-3xl font-bold tracking-tight">
                  <Private>+{money(recap.risingCategory.delta)}</Private>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <Private>{money(recap.risingCategory.previous)}</Private> →{' '}
                  <Private>{money(recap.risingCategory.total)}</Private>
                </p>
              </RecapCard>
            )}

            {recap.topCategory && (
              <RecapCard
                icon={Crown}
                eyebrow="Onde mais foi dinheiro"
                tone="bg-sky-500/12 text-sky-600 dark:text-sky-400"
              >
                <p className="truncate text-lg font-semibold">
                  {recap.topCategory.name}
                </p>
                <p className="mt-1 text-3xl font-bold tracking-tight">
                  {recap.topCategory.share.toLocaleString('pt-BR')}%
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  dos gastos do mês ·{' '}
                  <Private>{money(recap.topCategory.total)}</Private>
                </p>
              </RecapCard>
            )}

            {recap.favoritePlace && recap.favoritePlace.count > 1 && (
              <RecapCard
                icon={Store}
                eyebrow="Seu lugar do mês"
                tone="bg-teal-500/12 text-teal-600 dark:text-teal-400"
              >
                <p className="truncate text-lg font-semibold">
                  {recap.favoritePlace.name}
                </p>
                <p className="mt-1 text-3xl font-bold tracking-tight">
                  {recap.favoritePlace.count} vezes
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <Private>{money(recap.favoritePlace.total)}</Private> no total
                </p>
              </RecapCard>
            )}

            {recap.noSpendStreak && (
              <RecapCard
                icon={Sun}
                eyebrow="Dias sem gastar"
                tone="bg-lime-500/12 text-lime-700 dark:text-lime-400"
              >
                <p className="text-3xl font-bold tracking-tight">
                  {recap.noSpendStreak.days}{' '}
                  {recap.noSpendStreak.days === 1 ? 'dia' : 'dias'} seguidos
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {recap.noSpendStreak.days === 1
                    ? `em ${dayLabel(recap.noSpendStreak.start)}`
                    : `de ${dayLabel(recap.noSpendStreak.start)} a ${dayLabel(recap.noSpendStreak.end)}`}
                  {' · '}
                  {recap.noSpendDays} no mês
                </p>
              </RecapCard>
            )}

            {inTheBlue && (
              <RecapCard
                icon={Flame}
                eyebrow="No azul"
                tone="bg-orange-500/12 text-orange-600 dark:text-orange-400"
              >
                <p className="text-3xl font-bold tracking-tight">
                  {inTheBlue.blue} {inTheBlue.blue === 1 ? 'dia' : 'dias'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  dentro do valor do dia · de {inTheBlue.total}{' '}
                  {inTheBlue.total === 1 ? 'dia' : 'dias'} com valor
                </p>
              </RecapCard>
            )}

            <RecapCard
              icon={PiggyBank}
              eyebrow="Os cofrinhos renderam"
              tone="bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
            >
              {vaults ? (
                <>
                  <p className="text-3xl font-bold tracking-tight">
                    <Private>+{money(vaults.total)}</Private>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {vaults.best ? (
                      <>
                        líquido de IR e IOF · {vaults.best.name} rendeu{' '}
                        <Private>{money(vaults.best.net)}</Private>
                      </>
                    ) : (
                      'líquido de IR e IOF'
                    )}
                  </p>
                </>
              ) : vaultsLoading ? (
                <Skeleton className="h-9 w-40" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem cofrinhos para mostrar.
                </p>
              )}
            </RecapCard>
          </div>
        )}
      </div>
    </main>
  );
}
