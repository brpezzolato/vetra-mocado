'use client';
// Resumo da semana de gastos (home e /financeiro).

import Decimal from 'decimal.js';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Minus,
  PiggyBank,
  ReceiptText,
} from 'lucide-react';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { weeklySummary } from '@/lib/expense-insights';
import { Private } from '@/components/private-value';
import { money } from '@/lib/money';

export function WeeklyExpenseSummary({
  entries,
  reserveGain,
  framed = true,
}: {
  entries: FinancialEntry[];
  reserveGain?: string;
  /** Sem a moldura de cartão: dentro do cartão das abas da home. */
  framed?: boolean;
}) {
  const s = weeklySummary(entries);
  const difference = new Decimal(s.total).minus(s.previous);
  const total = new Decimal(s.total);
  const spendingIncreased = difference.gt(0);
  const spendingDecreased = difference.lt(0);
  const DifferenceIcon = spendingIncreased
    ? ArrowUpRight
    : spendingDecreased
      ? ArrowDownRight
      : Minus;
  const comparisonLabel = spendingIncreased
    ? `${money(difference.abs())} a mais`
    : spendingDecreased
      ? `${money(difference.abs())} a menos`
      : 'Mesmo valor';
  const dayMonth = (iso: string) =>
    iso.split('-').reverse().slice(0, 2).join('/');
  // No domingo a semana tem um dia só; "27/09 – 27/09" pareceria erro.
  const period =
    s.start === s.end
      ? dayMonth(s.start)
      : `${dayMonth(s.start)} – ${dayMonth(s.end)}`;

  return (
    <section
      className={
        framed
          ? 'overflow-hidden rounded-3xl border bg-card shadow-sm'
          : 'overflow-hidden'
      }
      id="resumo-semanal"
    >
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4 md:px-6">
        <div>
          <h2 className="font-semibold tracking-tight">Resumo semanal</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Esta semana · {period}
          </p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
          <CalendarDays className="size-4" aria-hidden="true" />
        </span>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
        <div className="px-5 py-5 md:px-6 md:py-6">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Total gasto
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums md:text-4xl">
            {money(s.total)}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium">
              <ReceiptText className="size-3.5" aria-hidden="true" />
              {s.count} {s.count === 1 ? 'lançamento' : 'lançamentos'}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                spendingIncreased
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : spendingDecreased
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              <DifferenceIcon className="size-3.5" aria-hidden="true" />
              <Private>{comparisonLabel}</Private>
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {s.previousStart === s.previousEnd
              ? `Comparado ao domingo passado (${dayMonth(s.previousStart)})`
              : `Comparado à semana passada até o mesmo dia (${dayMonth(s.previousStart)} – ${dayMonth(s.previousEnd)})`}
          </p>
        </div>

        <div className="border-t px-5 py-5 md:border-t-0 md:border-l md:px-6 md:py-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Maiores categorias</p>
            <span className="text-[11px] text-muted-foreground">Top 3</span>
          </div>
          {s.categories.length ? (
            <div className="space-y-4">
              {s.categories.slice(0, 3).map((category) => {
                const percentage = total.gt(0)
                  ? new Decimal(category.total).div(total).times(100).toNumber()
                  : 0;
                return (
                  <div key={category.name}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-muted-foreground">
                        {category.name}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {money(category.total)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground transition-[width] duration-500"
                        style={{ width: `${Math.max(percentage, 4)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum gasto registrado neste período.
            </p>
          )}
        </div>
      </div>

      {reserveGain !== undefined && (
        <div className="flex items-center gap-3 border-t bg-muted/25 px-5 py-4 md:px-6">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background">
            <PiggyBank className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              Rendimento dos cofrinhos no período
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              + {money(reserveGain)}
            </p>
          </div>
          <span className="hidden text-right text-[11px] text-muted-foreground sm:block">
            Estimativa do motor
          </span>
        </div>
      )}

      <p className="border-t px-5 py-3 text-[11px] leading-relaxed text-muted-foreground md:px-6">
        Considera os lançamentos registrados no Vetra, no horário de São Paulo.
      </p>
    </section>
  );
}
