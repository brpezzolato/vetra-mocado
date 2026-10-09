'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import { ExpenseDayList } from '@/components/expense-line';
import Link from '@/components/navigation-link';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import {
  ArrowRightSymbol,
  ChevronLeftSymbol,
  ChevronRightSymbol,
} from '@/components/ui/glass-button';
import { saoDate } from '@/lib/expense-insights';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';

/* "Últimos gastos" da home: agrupados por dia, com arte do cartão, nome,
   categoria, hora e valor, paginados. */

/** Gastos por página. */
const PAGE = 5;

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value).toNumber(),
  );

export function RecentExpenses({
  entries,
  cards,
  available,
  onOpen,
  framed = true,
  pageSize = PAGE,
}: {
  /** Já só os gastos, do mais novo para o mais antigo. */
  entries: FinancialEntry[];
  cards: PaymentCard[];
  available: boolean;
  onOpen: (entry: FinancialEntry) => void;
  /** Sem a moldura de cartão: dentro do cartão das abas da home. */
  framed?: boolean;
  /** Gastos por página (a home mostra mais para encher o cartão das abas). */
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const today = saoDate(new Date());
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = entries.slice(
    current * pageSize,
    current * pageSize + pageSize,
  );
  const spentToday = entries
    .filter(
      (entry) =>
        saoDate(entry.occurred_at) === today && !entry.excluded_from_totals,
    )
    .reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));

  return (
    <section
      className={
        framed
          ? 'overflow-hidden rounded-3xl border bg-card shadow-sm'
          : 'overflow-hidden'
      }
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-5 md:px-6 md:pt-6">
        <div className="min-w-0">
          <h2 className="font-semibold">Últimos gastos</h2>
          {available && (
            <p className="mt-1 text-xs text-muted-foreground">
              {spentToday.gt(0) ? (
                <>
                  Hoje você gastou <Private>{money(spentToday)}</Private>
                </>
              ) : (
                'Nenhum gasto hoje'
              )}
            </p>
          )}
        </div>
        <Link
          href="/financeiro"
          className="vetra-glass inline-flex min-h-9 shrink-0 items-center gap-1.5 px-3 text-xs font-medium"
        >
          <span className="hidden min-[430px]:inline">Ver extrato</span>
          <ArrowRightSymbol className="size-3.5" />
        </Link>
      </div>

      {available && visible.length ? (
        <>
          <div className="px-3 pt-1 pb-3 md:px-4">
            <ExpenseDayList entries={visible} cards={cards} onOpen={onOpen} />
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-5 py-3 md:px-6">
              <Button
                type="button"
                variant="glass-quiet"
                size="icon"
                aria-label="Página anterior dos gastos"
                disabled={current === 0}
                onClick={() => setPage(Math.max(0, current - 1))}
              >
                <ChevronLeftSymbol />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {current + 1} de {pages}
              </span>
              <Button
                type="button"
                variant="glass-quiet"
                size="icon"
                aria-label="Próxima página dos gastos"
                disabled={current >= pages - 1}
                onClick={() => setPage(Math.min(pages - 1, current + 1))}
              >
                <ChevronRightSymbol />
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="px-5 pt-4 pb-6 text-sm text-muted-foreground md:px-6">
          {available
            ? 'Nenhum gasto ainda. Registre pelo app, pelos Atalhos ou conecte um banco.'
            : 'Aguardando seus lançamentos…'}
        </p>
      )}
    </section>
  );
}
