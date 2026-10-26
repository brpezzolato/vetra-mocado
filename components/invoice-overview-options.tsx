'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import { ChevronRight } from 'lucide-react';
import {
  byDue,
  dayMonth,
  invoiceAccent,
  invoiceTextAccent,
  InvoiceCenter,
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

// Teste (/faturas/opcoes), terceira rodada (26/10/2026): a lista editorial não
// agradou. Mesmas informações (total, total nas contas, cartões e próximo
// vencimento; por cartão a imagem, nome, vencimento, valor, próxima e
// limite), sem a fileira de bancos no alto. Tocar abre os detalhes de hoje.

const OPTIONS = [
  {
    id: 1,
    label: 'Compacta',
    hint: 'Uma linha curta por cartão, tudo à vista sem rolar.',
  },
  {
    id: 2,
    label: 'Colorida',
    hint: 'Cada cartão um bloco na cor do banco, como o cartão de verdade.',
  },
  {
    id: 3,
    label: 'Fatura × limite',
    hint: 'Os dois números lado a lado: quanto vence e quanto ainda tem.',
  },
  {
    id: 4,
    label: 'Agrupada',
    hint: 'Resumo com a divisão por cartão e a lista num grupo só, estilo iPhone.',
  },
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
/** Limite total, disponível e quanto está em uso (0–100), quando há. */
const limitFigures = (limit?: CardLimit) => {
  if (limit?.credit_limit == null) return null;
  const total = new Decimal(limit.credit_limit);
  if (!total.gt(0)) return null;
  const available = new Decimal(limit.available_limit ?? 0);
  const used = Decimal.max(
    0,
    Decimal.min(100, total.minus(available).div(total).times(100)),
  ).toNumber();
  return { total, available, used };
};

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

function DueLine({
  data,
  className,
}: {
  data: InvoiceOverview;
  className?: string;
}) {
  if (!data.nextDue) return null;
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      {cardCount(data)} · próximo vencimento {dayMonth(data.nextDue)}
    </p>
  );
}

/** O cabeçalho de sempre: rótulo, total, total nas contas e vencimento. */
function Summary({ data }: { data: InvoiceOverview }) {
  return (
    <section className="mb-6">
      <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
        Faturas atuais
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
        <Private>{money(data.openTotal)}</Private>
      </h1>
      <CountedLine data={data} className="mt-1.5" />
      <DueLine data={data} className="mt-0.5" />
    </section>
  );
}

function Pending({ data }: { data: InvoiceOverview }) {
  if (!data.pending.length) return null;
  return (
    <div className="mt-3 grid gap-3">
      {data.pending.map((card) => (
        <PendingCardPanel
          key={card.account}
          card={card}
          limit={limitOf(data.limits, card.account)}
          onOpen={data.onOpen}
        />
      ))}
    </div>
  );
}

/** Barra fina do limite em uso, na cor do cartão (ou da cor dada). */
function Bar({
  used,
  color,
  className,
}: {
  used: number;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'block h-1 overflow-hidden rounded-full bg-foreground/10',
        className,
      )}
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${used}%`, background: color }}
      />
    </span>
  );
}

/** Opção 1: uma linha curta por cartão, entre fios. */
function CompactOption({ data }: { data: InvoiceOverview }) {
  return (
    <>
      <Summary data={data} />
      <ul className="divide-y border-y">
        {data.cards.map((item) => {
          const { card, current } = item;
          const next = nextOf(item);
          const limit = limitFigures(limitOf(data.limits, card.account));
          return (
            <li key={card.account}>
              <button
                type="button"
                onClick={() => data.onOpen(card.account)}
                className="grid w-full gap-2.5 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                <span className="flex items-center gap-3">
                  <PaymentCardIcon bankId={card.bank_id} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {card.account}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Vence {dayMonth(current.due)}
                      {next && (
                        <>
                          {' '}
                          · Próxima{' '}
                          <Private>{money(shownAmount(next))}</Private>
                        </>
                      )}
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-base font-semibold tabular-nums"
                    style={{ color: invoiceTextAccent(card.bank_id) }}
                  >
                    <Private>{money(current.balance)}</Private>
                  </span>
                </span>
                {limit && (
                  <span className="flex items-center gap-3 pl-[4.25rem]">
                    <Bar
                      used={limit.used}
                      color={invoiceAccent(card.bank_id)}
                      className="flex-1"
                    />
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      Livre <Private>{money(limit.available)}</Private> de{' '}
                      <Private>{money(limit.total)}</Private>
                    </span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Pending data={data} />
    </>
  );
}

/** Opção 2: cada cartão um bloco na cor do banco, texto branco. */
function ColorOption({ data }: { data: InvoiceOverview }) {
  return (
    <>
      <Summary data={data} />
      <div className="grid gap-3 md:grid-cols-2">
        {data.cards.map((item) => {
          const { card, current } = item;
          const next = nextOf(item);
          const limit = limitFigures(limitOf(data.limits, card.account));
          const color = invoiceAccent(card.bank_id);
          return (
            <button
              key={card.account}
              type="button"
              onClick={() => data.onOpen(card.account)}
              className="grid gap-4 rounded-3xl p-5 text-left text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              style={{
                background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 55%, black))`,
              }}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-snug">
                    {card.account}
                  </span>
                  <span className="mt-0.5 block text-xs text-white/75">
                    Vence {dayMonth(current.due)}
                  </span>
                </span>
                <span className="rounded-[5px] ring-1 ring-white/25">
                  <PaymentCardIcon bankId={card.bank_id} />
                </span>
              </span>
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-3xl font-semibold tracking-tight tabular-nums">
                  <Private>{money(current.balance)}</Private>
                </span>
                {next && (
                  <span className="text-xs text-white/75 tabular-nums">
                    Próxima <Private>{money(shownAmount(next))}</Private>
                  </span>
                )}
              </span>
              {limit && (
                <span className="grid gap-2">
                  <span className="flex items-baseline justify-between gap-3 text-xs text-white/75">
                    <span>Limite disponível</span>
                    <span className="tabular-nums">
                      <Private>{money(limit.available)}</Private> de{' '}
                      <Private>{money(limit.total)}</Private>
                    </span>
                  </span>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-white/20">
                    <span
                      className="block h-full rounded-full bg-white"
                      style={{ width: `${limit.used}%` }}
                    />
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Pending data={data} />
    </>
  );
}

/** Opção 3: fatura e limite livre lado a lado, os dois em destaque. */
function SideBySideOption({ data }: { data: InvoiceOverview }) {
  return (
    <>
      <Summary data={data} />
      <div className="grid gap-3 md:grid-cols-2">
        {data.cards.map((item) => {
          const { card, current } = item;
          const next = nextOf(item);
          const limit = limitFigures(limitOf(data.limits, card.account));
          return (
            <button
              key={card.account}
              type="button"
              onClick={() => data.onOpen(card.account)}
              className="grid gap-4 rounded-3xl border bg-card p-4 text-left transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-foreground"
            >
              <span className="flex items-center gap-3">
                <PaymentCardIcon bankId={card.bank_id} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {card.account}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </span>
              <span className="grid grid-cols-2 gap-3">
                <span className="min-w-0 rounded-2xl bg-muted/60 p-3">
                  <span className="block text-[11px] text-muted-foreground">
                    Fatura · vence {dayMonth(current.due)}
                  </span>
                  <span
                    className="mt-1 block truncate text-xl font-semibold tracking-tight tabular-nums"
                    style={{ color: invoiceTextAccent(card.bank_id) }}
                  >
                    <Private>{money(current.balance)}</Private>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground tabular-nums">
                    {next ? (
                      <>
                        Próxima <Private>{money(shownAmount(next))}</Private>
                      </>
                    ) : (
                      'Sem próxima'
                    )}
                  </span>
                </span>
                <span className="min-w-0 rounded-2xl bg-muted/60 p-3">
                  <span className="block text-[11px] text-muted-foreground">
                    Limite disponível
                  </span>
                  {limit ? (
                    <>
                      <span className="mt-1 block truncate text-xl font-semibold tracking-tight tabular-nums">
                        <Private>{money(limit.available)}</Private>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground tabular-nums">
                        de <Private>{money(limit.total)}</Private>
                      </span>
                    </>
                  ) : (
                    <span className="mt-1 block text-sm text-muted-foreground">
                      Sem informação
                    </span>
                  )}
                </span>
              </span>
              {limit && (
                <Bar
                  used={limit.used}
                  color={invoiceAccent(card.bank_id)}
                  className="h-1.5"
                />
              )}
            </button>
          );
        })}
      </div>
      <Pending data={data} />
    </>
  );
}

/** Opção 4: resumo num painel com a divisão por cartão; lista agrupada. */
function GroupedOption({ data }: { data: InvoiceOverview }) {
  const share = (balance: Decimal.Value) =>
    data.openTotal.gt(0)
      ? Decimal.max(new Decimal(balance), 0)
          .div(data.openTotal)
          .times(100)
          .toFixed(2)
      : '0';
  return (
    <>
      <section className="mb-5 rounded-3xl border bg-card p-5">
        <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
          Faturas atuais
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
          <Private>{money(data.openTotal)}</Private>
        </h1>
        <CountedLine data={data} className="mt-1.5" />
        <span
          aria-hidden="true"
          className="mt-5 flex h-3 gap-0.5 overflow-hidden rounded-full bg-foreground/10"
        >
          {data.cards.map(({ card, current }) => (
            <span
              key={card.account}
              className="h-full"
              style={{
                width: `${share(current.balance)}%`,
                background: invoiceAccent(card.bank_id),
              }}
            />
          ))}
        </span>
        <DueLine data={data} className="mt-3 text-xs" />
      </section>
      <ul className="overflow-clip rounded-3xl border bg-card">
        {data.cards.map((item) => {
          const { card, current } = item;
          const next = nextOf(item);
          const limit = limitFigures(limitOf(data.limits, card.account));
          return (
            <li
              key={card.account}
              className="border-b border-border/70 last:border-b-0"
            >
              <button
                type="button"
                onClick={() => data.onOpen(card.account)}
                className="grid w-full gap-2 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
              >
                <span className="flex items-center gap-3">
                  <PaymentCardIcon bankId={card.bank_id} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {card.account}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Vence {dayMonth(current.due)}
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
                {limit && (
                  <span className="grid gap-1.5 pl-[4.25rem] pr-7">
                    <Bar
                      used={limit.used}
                      color={invoiceAccent(card.bank_id)}
                    />
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      Limite disponível{' '}
                      <Private>{money(limit.available)}</Private> de{' '}
                      <Private>{money(limit.total)}</Private>
                    </span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Pending data={data} />
    </>
  );
}

const RENDER: Record<OptionId, (data: InvoiceOverview) => React.ReactNode> = {
  1: (data) => <CompactOption data={data} />,
  2: (data) => <ColorOption data={data} />,
  3: (data) => <SideBySideOption data={data} />,
  4: (data) => <GroupedOption data={data} />,
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
