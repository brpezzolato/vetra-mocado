'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import { EyeOff } from 'lucide-react';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { saoDate } from '@/lib/expense-insights';
import { resolvePaymentMethod, type PaymentCard } from '@/lib/payment-cards';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Private } from '@/components/private-value';
import { isSplit, myShare } from '@/lib/entry-share';
import { isPendingSpend, pendingKey } from '@/lib/unidentified-spend';
import { PendingSpendDialog } from '@/components/pending-spend-dialog';

/* Linha de lançamento comum ao app: arte do cartão, nome com categoria e
   hora, valor à direita. Agrupada por dia em `ExpenseDayList`. */

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value).toNumber(),
  );

const time = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));

/** "Hoje", "Ontem" ou "sáb, 03 out". */
export function dayLabel(day: string, today = saoDate(new Date())) {
  const date = new Date(`${day}T12:00:00Z`);
  const diff = Math.round(
    (Date.parse(`${today}T12:00:00Z`) - date.getTime()) / 86_400_000,
  );
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    ...(date.getUTCFullYear() !== Number(today.slice(0, 4)) && {
      year: 'numeric',
    }),
    timeZone: 'UTC',
  })
    .format(date)
    .replaceAll('.', '');
}

export function ExpenseLine({
  entry,
  cards,
  onOpen,
}: {
  entry: FinancialEntry;
  cards: PaymentCard[];
  onOpen: (entry: FinancialEntry) => void;
}) {
  // Gasto sem compra ainda (lib/unidentified-spend.ts): asterisco; tocar
  // abre a divisão (valores e datas das compras de verdade).
  if (isPendingSpend(entry)) return <PendingLine entry={entry} cards={cards} />;
  const excluded = !!entry.excluded_from_totals;
  const income = entry.entry_type === 'income';
  // Compra dividida: o valor que aparece é a parte dele.
  const split = isSplit(entry);
  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      className="flex w-full min-w-0 items-center gap-3.5 rounded-xl px-2 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <PaymentCardIcon bankId={resolvePaymentMethod(entry.account, cards)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {entry.description}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {entry.category} · {time(entry.occurred_at)}
          {/* A parcela diz qual é, como na fatura do banco. */}
          {entry.installment_number && entry.installment_total
            ? ` · parcela ${entry.installment_number}/${entry.installment_total}`
            : ''}
          {split && ' · dividida'}
          {entry.excluded_from_daily && !excluded && ' · fora do valor do dia'}
        </span>
      </span>
      {/* Fora das contas: olho riscado e o valor riscado e apagado. */}
      <span
        className={`flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums ${excluded ? 'text-muted-foreground' : income ? 'text-emerald-500' : ''}`}
        title={excluded ? 'Fora das contas' : undefined}
      >
        {excluded && (
          <>
            <EyeOff aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Fora das contas: </span>
          </>
        )}
        <span
          className={
            excluded ? 'line-through decoration-muted-foreground/60' : undefined
          }
        >
          <Private>
            {income ? '+' : '−'}
            {money(myShare(entry))}
          </Private>
        </span>
      </span>
    </button>
  );
}

/**
 * Lançamentos agrupados por dia, com divisórias. `days={false}` para lista
 * de um dia só.
 */
export function ExpenseDayList({
  entries,
  cards,
  onOpen,
  days = true,
}: {
  entries: FinancialEntry[];
  cards: PaymentCard[];
  onOpen: (entry: FinancialEntry) => void;
  days?: boolean;
}) {
  const today = saoDate(new Date());
  const groups: [string, FinancialEntry[]][] = [];
  for (const entry of entries) {
    const day = days ? saoDate(entry.occurred_at) : '';
    const last = groups.at(-1);
    if (last?.[0] === day) last[1].push(entry);
    else groups.push([day, [entry]]);
  }
  return (
    <div>
      {groups.map(([day, items]) => (
        <div key={day || 'all'}>
          {days && (
            <p className="px-2 pt-3 pb-0.5 text-[11px] font-medium uppercase tracking-[.1em] text-muted-foreground">
              {dayLabel(day, today)}
            </p>
          )}
          <ul className="divide-y divide-border/50">
            {items.map((entry) => (
              <li key={entry.id}>
                <ExpenseLine entry={entry} cards={cards} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PendingLine({
  entry,
  cards,
}: {
  entry: FinancialEntry;
  cards: PaymentCard[];
}) {
  const [open, setOpen] = useState(false);
  const key = pendingKey(entry);
  const split = entry.notes === 'Dividida por você';
  return (
    <>
      <button
        type="button"
        disabled={!key}
        onClick={() => setOpen(true)}
        className="flex w-full min-w-0 items-center gap-3.5 rounded-xl px-2 py-3 text-left transition-colors hover:bg-muted/40 disabled:hover:bg-transparent"
      >
        <PaymentCardIcon bankId={resolvePaymentMethod(entry.account, cards)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {entry.description}*
          </span>
          {entry.pending_overdue ? (
            <span className="mt-0.5 block truncate text-xs font-medium text-amber-700 dark:text-amber-300">
              Passou de 3 dias sem chegar · toque para decidir
            </span>
          ) : (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {split
                ? 'Dividida por você · chega em até 7 dias'
                : `${entry.notes ?? `O limite caiu às ${time(entry.occurred_at)}`} · toque para dividir ou excluir`}
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
          <Private>−{money(entry.amount)}*</Private>
        </span>
      </button>
      {key && (
        <PendingSpendDialog
          account={key.account}
          day={key.day}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
