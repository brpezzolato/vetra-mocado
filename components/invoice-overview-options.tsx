'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import { ChevronRight } from 'lucide-react';
import {
  byDue,
  dayMonth,
  invoiceAccent,
  invoiceStatus,
  invoiceTextAccent,
  InvoiceCenter,
  LimitBar,
  money,
  PendingCardPanel,
  shownAmount,
  type CardLimit,
  type InvoiceOverview,
} from '@/components/invoice-center';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import type { CreditCardInvoices } from '@/lib/card-invoices';
import { cn } from '@/lib/utils';

// Teste (/faturas/opcoes): quatro redesenhos da visão "Todas" de /faturas,
// com as mesmas informações (total, total nas contas, cartões e próximo
// vencimento; por cartão a imagem, nome, fatura, vencimento, valor, próxima e
// limite). Tocar num cartão abre os mesmos detalhes de hoje.

const OPTIONS = [
  { id: 1, label: 'Lista', hint: 'Tudo num bloco só, uma linha por cartão.' },
  {
    id: 2,
    label: 'Destaque',
    hint: 'Cartão grande, cor da marca e o peso de cada um no total.',
  },
  {
    id: 3,
    label: 'Calendário',
    hint: 'Na ordem do vencimento, com quantos dias faltam.',
  },
  { id: 4, label: 'Grade', hint: 'Resumo em painel e cartões lado a lado.' },
] as const;
type OptionId = (typeof OPTIONS)[number]['id'];

const limitOf = (limits: CardLimit[], account: string) =>
  limits.find((item) => item.account === account);
const nextOf = ({ current, invoices }: CreditCardInvoices) =>
  byDue(invoices).find((item) => item.due > current.due);
const cardCount = (data: InvoiceOverview) => {
  const count = data.cards.length + data.pending.length;
  return count === 1 ? '1 cartão' : `${count} cartões`;
};
/** Hoje em São Paulo, AAAA-MM-DD. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
const daysUntil = (due: string) =>
  Math.round(
    (Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) /
      86_400_000,
  );
const inDays = (due: string) => {
  const days = daysUntil(due);
  if (days < 0) return 'venceu';
  if (days === 0) return 'vence hoje';
  if (days === 1) return 'amanhã';
  return `em ${days} dias`;
};

/** "R$ X nas contas, sem o que está fora delas", só quando difere. */
function CountedLine({
  data,
  className,
}: {
  data: InvoiceOverview;
  className?: string;
}) {
  if (data.countedOpenTotal.eq(data.openTotal)) return null;
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      <span className="font-medium text-foreground tabular-nums">
        <Private>{money(data.countedOpenTotal)}</Private>
      </span>{' '}
      nas contas, sem o que está fora delas
    </p>
  );
}

/** Quanto cada cartão pesa no total, na cor dele. */
function ShareBar({ data }: { data: InvoiceOverview }) {
  if (!data.openTotal.gt(0)) return null;
  return (
    <div
      aria-hidden="true"
      className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-foreground/10"
    >
      {data.cards.map(({ card, current }) =>
        new Decimal(current.balance).gt(0) ? (
          <span
            key={card.account}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${new Decimal(current.balance)
                .div(data.openTotal)
                .times(100)
                .toFixed(2)}%`,
              background: invoiceAccent(card.bank_id),
            }}
          />
        ) : null,
      )}
    </div>
  );
}

function Pending({ data }: { data: InvoiceOverview }) {
  return data.pending.map((card) => (
    <PendingCardPanel
      key={card.account}
      card={card}
      limit={limitOf(data.limits, card.account)}
      onOpen={data.onOpen}
    />
  ));
}

/** Opção 1: um bloco só, uma linha por cartão separadas por fio. */
function ListOption({ data }: { data: InvoiceOverview }) {
  return (
    <>
      <section className="mb-6">
        <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
          Faturas atuais
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
          <Private>{money(data.openTotal)}</Private>
        </h1>
        <CountedLine data={data} className="mt-1.5" />
        {data.nextDue && (
          <p className="mt-2 text-sm text-muted-foreground">
            {cardCount(data)} · próximo vencimento {dayMonth(data.nextDue)}
          </p>
        )}
      </section>
      <div className="divide-y divide-border/70 overflow-clip rounded-3xl border bg-card">
        {data.cards.map((item) => {
          const { card, current, invoices } = item;
          const next = nextOf(item);
          return (
            <button
              key={card.account}
              type="button"
              onClick={() => data.onOpen(card.account)}
              className="grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground md:px-5"
            >
              <span className="flex items-center gap-3">
                <PaymentCardIcon bankId={card.bank_id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {card.account}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {invoiceStatus(current, invoices)} · vence{' '}
                    {dayMonth(current.due)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className="block text-base font-semibold tabular-nums"
                    style={{ color: invoiceTextAccent(card.bank_id) }}
                  >
                    <Private>{money(current.balance)}</Private>
                  </span>
                  {next && (
                    <span className="block text-[11px] text-muted-foreground tabular-nums">
                      Próxima <Private>{money(shownAmount(next))}</Private>
                    </span>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </span>
              <LimitBar
                limit={limitOf(data.limits, card.account)}
                bankId={card.bank_id}
              />
            </button>
          );
        })}
      </div>
      {data.pending.length > 0 && (
        <div className="mt-3 grid gap-3">
          <Pending data={data} />
        </div>
      )}
    </>
  );
}

/** Opção 2: cartão grande, fundo na cor da marca e o peso no total. */
function FeatureOption({ data }: { data: InvoiceOverview }) {
  return (
    <>
      <section className="mb-7">
        <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
          Faturas atuais
        </p>
        <h1 className="mt-2 text-5xl font-semibold tracking-tight tabular-nums md:text-6xl">
          <Private>{money(data.openTotal)}</Private>
        </h1>
        <CountedLine data={data} className="mt-2" />
        {data.nextDue && (
          <p className="mt-1 text-sm text-muted-foreground">
            {cardCount(data)} · próximo vencimento {dayMonth(data.nextDue)}
          </p>
        )}
        <div className="mt-5">
          <ShareBar data={data} />
        </div>
      </section>
      <div className="grid gap-4">
        {data.cards.map((item) => {
          const { card, current, invoices } = item;
          const next = nextOf(item);
          const share = data.openTotal.gt(0)
            ? new Decimal(current.balance)
                .div(data.openTotal)
                .times(100)
                .toDecimalPlaces(0)
            : null;
          return (
            <button
              key={card.account}
              type="button"
              onClick={() => data.onOpen(card.account)}
              className="grid gap-5 rounded-3xl border p-5 text-left transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-foreground md:p-6"
              style={{
                background: `color-mix(in oklab, ${invoiceAccent(card.bank_id)} 9%, var(--card))`,
              }}
            >
              <span className="flex items-start gap-4">
                <PaymentCardIcon bankId={card.bank_id} large />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">
                    {card.account}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {invoiceStatus(current, invoices)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    vence {dayMonth(current.due)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </span>
              <span className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                <span
                  className="text-3xl font-semibold tracking-tight tabular-nums"
                  style={{ color: invoiceTextAccent(card.bank_id) }}
                >
                  <Private>{money(current.balance)}</Private>
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {share && share.gt(0) && (
                    <span className="block">{share.toString()}% do total</span>
                  )}
                  {next && (
                    <span className="block tabular-nums">
                      Próxima <Private>{money(shownAmount(next))}</Private>
                    </span>
                  )}
                </span>
              </span>
              <LimitBar
                limit={limitOf(data.limits, card.account)}
                bankId={card.bank_id}
              />
            </button>
          );
        })}
        <Pending data={data} />
      </div>
    </>
  );
}

/** Opção 3: na ordem do vencimento, com a data em destaque à esquerda. */
function CalendarOption({ data }: { data: InvoiceOverview }) {
  const sorted = [...data.cards].sort(
    (a, b) =>
      a.current.due.localeCompare(b.current.due) ||
      data.cards.indexOf(a) - data.cards.indexOf(b),
  );
  return (
    <>
      <section className="mb-7 rounded-3xl border bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
              Faturas atuais
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
              <Private>{money(data.openTotal)}</Private>
            </h1>
            <CountedLine data={data} className="mt-1.5" />
          </div>
          {data.nextDue && (
            <div className="text-left sm:text-right">
              <p className="text-xs text-muted-foreground">
                Próximo vencimento
              </p>
              <p className="mt-0.5 text-lg font-semibold">
                {dayMonth(data.nextDue)}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  · {inDays(data.nextDue)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{cardCount(data)}</p>
            </div>
          )}
        </div>
      </section>
      <ol className="grid gap-3">
        {sorted.map((item) => {
          const { card, current, invoices } = item;
          const next = nextOf(item);
          const [day, month] = dayMonth(current.due).split(' de ');
          return (
            <li key={card.account}>
              <button
                type="button"
                onClick={() => data.onOpen(card.account)}
                className="flex w-full gap-4 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground"
              >
                <span className="flex w-12 shrink-0 flex-col items-center pt-4">
                  <span className="text-2xl font-semibold leading-none tabular-nums">
                    {day}
                  </span>
                  <span className="mt-1 text-[11px] uppercase tracking-[.12em] text-muted-foreground">
                    {month}
                  </span>
                  <span className="mt-1 text-[10px] text-muted-foreground">
                    {inDays(current.due)}
                  </span>
                </span>
                <span className="grid min-w-0 flex-1 gap-3 rounded-3xl border bg-card p-4 transition-colors hover:border-foreground/30 md:p-5">
                  <span className="flex items-center gap-3">
                    <PaymentCardIcon bankId={card.bank_id} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {card.account}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {invoiceStatus(current, invoices)} · vence{' '}
                        {dayMonth(current.due)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </span>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span
                      className="text-2xl font-semibold tracking-tight tabular-nums"
                      style={{ color: invoiceTextAccent(card.bank_id) }}
                    >
                      <Private>{money(current.balance)}</Private>
                    </span>
                    {next && (
                      <span className="text-xs text-muted-foreground">
                        Próxima <Private>{money(shownAmount(next))}</Private>
                      </span>
                    )}
                  </span>
                  <LimitBar
                    limit={limitOf(data.limits, card.account)}
                    bankId={card.bank_id}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {data.pending.length > 0 && (
        <div className="mt-3 grid gap-3">
          <Pending data={data} />
        </div>
      )}
    </>
  );
}

/** O limite em duas linhas, para caber no ladrilho estreito. */
function TileLimit({
  limit,
  bankId,
}: {
  limit?: CardLimit;
  bankId: CreditCardInvoices['card']['bank_id'];
}) {
  if (limit?.credit_limit == null) return null;
  const total = new Decimal(limit.credit_limit);
  if (!total.gt(0)) return null;
  const available = new Decimal(limit.available_limit ?? 0);
  const used = Decimal.max(
    0,
    Decimal.min(100, total.minus(available).div(total).times(100)),
  );
  return (
    <span className="block text-[11px] leading-snug text-muted-foreground">
      <span className="block">Limite disponível</span>
      <span className="block tabular-nums">
        <Private>{money(available)}</Private> de{' '}
        <Private>{money(total)}</Private>
      </span>
      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${used.toNumber()}%`,
            background: invoiceAccent(bankId),
          }}
        />
      </span>
    </span>
  );
}

/** Opção 4: resumo em painel com a divisão por cartão e ladrilhos 2×2. */
function GridOption({ data }: { data: InvoiceOverview }) {
  return (
    <>
      <section className="mb-4 rounded-3xl border bg-card p-5 md:p-6">
        <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
          Faturas atuais
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
          <Private>{money(data.openTotal)}</Private>
        </h1>
        <CountedLine data={data} className="mt-1.5" />
        <div className="mt-5">
          <ShareBar data={data} />
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {data.cards.map(({ card }) => (
            <li key={card.account} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: invoiceAccent(card.bank_id) }}
              />
              {card.account}
            </li>
          ))}
        </ul>
        {data.nextDue && (
          <p className="mt-4 border-t border-border/70 pt-3 text-sm text-muted-foreground">
            {cardCount(data)} · próximo vencimento {dayMonth(data.nextDue)}
          </p>
        )}
      </section>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.cards.map((item) => {
          const { card, current, invoices } = item;
          const next = nextOf(item);
          return (
            <button
              key={card.account}
              type="button"
              onClick={() => data.onOpen(card.account)}
              className="flex min-w-0 flex-col gap-3 rounded-3xl border bg-card p-4 text-left transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-foreground"
            >
              <span className="flex items-start justify-between gap-2">
                <PaymentCardIcon bankId={card.bank_id} />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </span>
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm font-medium leading-snug">
                  {card.account}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {invoiceStatus(current, invoices)} · vence{' '}
                  {dayMonth(current.due)}
                </span>
              </span>
              <span className="mt-auto min-w-0">
                <span
                  className="block truncate text-xl font-semibold tracking-tight tabular-nums"
                  style={{ color: invoiceTextAccent(card.bank_id) }}
                >
                  <Private>{money(current.balance)}</Private>
                </span>
                {next && (
                  <span className="block text-[11px] text-muted-foreground tabular-nums">
                    Próxima <Private>{money(shownAmount(next))}</Private>
                  </span>
                )}
              </span>
              <TileLimit
                limit={limitOf(data.limits, card.account)}
                bankId={card.bank_id}
              />
            </button>
          );
        })}
      </div>
      {data.pending.length > 0 && (
        <div className="mt-3 grid gap-3">
          <Pending data={data} />
        </div>
      )}
    </>
  );
}

const RENDER: Record<OptionId, (data: InvoiceOverview) => React.ReactNode> = {
  1: (data) => <ListOption data={data} />,
  2: (data) => <FeatureOption data={data} />,
  3: (data) => <CalendarOption data={data} />,
  4: (data) => <GridOption data={data} />,
};

export function InvoiceOverviewOptions(
  props: Omit<React.ComponentProps<typeof InvoiceCenter>, 'overview' | 'top'>,
) {
  const [option, setOption] = useState<OptionId>(1);
  const current = OPTIONS.find((item) => item.id === option)!;
  return (
    <InvoiceCenter
      {...props}
      overview={RENDER[option]}
      top={
        <section
          aria-label="Opções de redesenho"
          className="mb-6 rounded-3xl border border-dashed p-4"
        >
          <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
            Teste · escolha uma opção
          </p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {OPTIONS.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={option === item.id ? 'glass' : 'glass-quiet'}
                aria-pressed={option === item.id}
                className="h-9 rounded-full px-2"
                onClick={() => setOption(item.id)}
              >
                {item.id}
                <span className="sr-only sm:not-sr-only">· {item.label}</span>
              </Button>
            ))}
          </div>
          <p className="mt-3 text-sm">
            <span className="font-medium">
              Opção {current.id} · {current.label}.
            </span>{' '}
            <span className="text-muted-foreground">{current.hint}</span>
          </p>
        </section>
      }
    />
  );
}
