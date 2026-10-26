'use client';

import { useState } from 'react';
import Image from 'next/image';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CreditCardInvoices } from '@/lib/card-invoices';
import type { PaymentCard } from '@/lib/payment-cards';
import { cn } from '@/lib/utils';

// Teste (/faturas/opcoes): quatro redesenhos da visão "Todas" de /faturas,
// com as mesmas informações (total, total nas contas, cartões e próximo
// vencimento; por cartão a imagem, nome, fatura, vencimento, valor, próxima e
// limite). Tocar num cartão abre os mesmos detalhes de hoje.
// Segunda rodada (26/10/2026): o Bruno não gostou de nenhuma da primeira.

const OPTIONS = [
  {
    id: 1,
    label: 'Carrossel',
    hint: 'Os cartões grandes, de arrastar para o lado, como no Apple Pay.',
  },
  {
    id: 2,
    label: 'Anel',
    hint: 'O total dentro de um anel dividido pelos cartões.',
  },
  {
    id: 3,
    label: 'Ficha',
    hint: 'Cada cartão como o painel da fatura, com os números em colunas.',
  },
  {
    id: 4,
    label: 'Editorial',
    hint: 'Sem caixas: só tipografia, fios e os números grandes.',
  },
] as const;
type OptionId = (typeof OPTIONS)[number]['id'];

/** A arte em alta (1071 px) para o cartão grande; os outros, o ícone. */
const CARD_ART: Partial<Record<PaymentCard['bank_id'], string>> = {
  nubank: '/cards/nubank-wallet.png',
  itau: '/cards/itau-wallet.png',
  picpay: '/cards/picpay-wallet.png',
  flash: '/cards/flash-wallet.png',
};

const limitOf = (limits: CardLimit[], account: string) =>
  limits.find((item) => item.account === account);
const nextOf = ({ current, invoices }: CreditCardInvoices) =>
  byDue(invoices).find((item) => item.due > current.due);
const cardCount = (data: InvoiceOverview) => {
  const count = data.cards.length + data.pending.length;
  return count === 1 ? '1 cartão' : `${count} cartões`;
};
const shareOf = (data: InvoiceOverview, balance: Decimal.Value) =>
  data.openTotal.gt(0)
    ? Decimal.max(new Decimal(balance), 0).div(data.openTotal).times(100)
    : new Decimal(0);

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

/** "4 cartões · próximo vencimento 05 de nov". */
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

/** O cartão grande, na largura de quem o contém. */
function BigCard({ bankId }: { bankId: PaymentCard['bank_id'] }) {
  const art = CARD_ART[bankId];
  if (!art)
    return (
      <span className="flex aspect-[1071/672] w-full items-center justify-center">
        <PaymentCardIcon bankId={bankId} large />
      </span>
    );
  return (
    <span className="relative block aspect-[1071/672] w-full">
      <Image
        src={art}
        alt=""
        aria-hidden="true"
        fill
        sizes="(min-width: 768px) 320px, 80vw"
        className="object-contain"
      />
    </span>
  );
}

/** Opção 1: carrossel de cartões grandes, cada um com a sua fatura embaixo. */
function CarouselOption({ data }: { data: InvoiceOverview }) {
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
        <DueLine data={data} className="mt-1" />
      </section>
      <ScrollArea orientation="horizontal" className="scroll-bleed">
        <div className="flex gap-4 pb-2">
          {data.cards.map((item) => {
            const { card, current, invoices } = item;
            const next = nextOf(item);
            return (
              <button
                key={card.account}
                type="button"
                onClick={() => data.onOpen(card.account)}
                className="grid w-[78vw] max-w-80 shrink-0 gap-4 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground"
              >
                <BigCard bankId={card.bank_id} />
                <span className="grid gap-4 px-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {card.account}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {invoiceStatus(current, invoices)} · vence{' '}
                        {dayMonth(current.due)}
                      </span>
                    </span>
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  </span>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span
                      className="text-3xl font-semibold tracking-tight tabular-nums"
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
            );
          })}
        </div>
      </ScrollArea>
      <Pending data={data} />
    </>
  );
}

/** O anel: cada cartão um arco na sua cor, do tamanho do peso no total. */
function Ring({ data }: { data: InvoiceOverview }) {
  const radius = 42;
  const length = 2 * Math.PI * radius;
  const gap = data.cards.length > 1 ? 1.6 : 0;
  const arcs = data.cards.reduce<
    {
      account: string;
      bankId: PaymentCard['bank_id'];
      arc: number;
      start: number;
      part: number;
    }[]
  >((list, { card, current }) => {
    const start = list.length
      ? list[list.length - 1].start + list[list.length - 1].part
      : 0;
    const part = (shareOf(data, current.balance).toNumber() / 100) * length;
    return [
      ...list,
      {
        account: card.account,
        bankId: card.bank_id,
        arc: Math.max(part - gap, 0),
        start,
        part,
      },
    ];
  }, []);
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="size-full -rotate-90"
    >
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        strokeWidth="7"
        className="stroke-foreground/10"
      />
      {arcs.map(({ account, bankId, arc, start }) =>
        arc > 0 ? (
          <circle
            key={account}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth="7"
            stroke={invoiceAccent(bankId)}
            strokeDasharray={`${arc} ${length - arc}`}
            strokeDashoffset={-start}
          />
        ) : null,
      )}
    </svg>
  );
}

/** Opção 2: o total no meio do anel e a legenda vira a lista dos cartões. */
function RingOption({ data }: { data: InvoiceOverview }) {
  return (
    <>
      <section className="mb-8 flex flex-col items-center text-center">
        <div className="relative size-64 md:size-72">
          <Ring data={data} />
          <div className="absolute inset-0 flex flex-col items-center justify-center px-10">
            <p className="text-[11px] uppercase tracking-[.14em] text-muted-foreground">
              Faturas atuais
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight tabular-nums md:text-4xl">
              <Private>{money(data.openTotal)}</Private>
            </h1>
            {!data.countedOpenTotal.eq(data.openTotal) && (
              <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">
                  <Private>{money(data.countedOpenTotal)}</Private>
                </span>
                <br />
                nas contas, sem o que está fora delas
              </p>
            )}
          </div>
        </div>
        <DueLine data={data} className="mt-4" />
      </section>
      <div className="grid gap-2">
        {data.cards.map((item) => {
          const { card, current, invoices } = item;
          const next = nextOf(item);
          const share = shareOf(data, current.balance).toDecimalPlaces(0);
          return (
            <button
              key={card.account}
              type="button"
              onClick={() => data.onOpen(card.account)}
              className="grid gap-3 rounded-2xl px-1 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-foreground"
            >
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="h-9 w-1 shrink-0 rounded-full"
                  style={{ background: invoiceAccent(card.bank_id) }}
                />
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
                  <span className="block text-[11px] text-muted-foreground tabular-nums">
                    {share.toString()}% do total
                  </span>
                </span>
              </span>
              <span className="grid gap-2 pl-4">
                {next && (
                  <span className="text-xs text-muted-foreground">
                    Próxima <Private>{money(shownAmount(next))}</Private>
                  </span>
                )}
                <LimitBar
                  limit={limitOf(data.limits, card.account)}
                  bankId={card.bank_id}
                />
              </span>
            </button>
          );
        })}
      </div>
      <Pending data={data} />
    </>
  );
}

/** Opção 3: cada cartão como o painel da fatura, números em colunas. */
function SheetOption({ data }: { data: InvoiceOverview }) {
  return (
    <>
      <section className="mb-5 rounded-3xl border bg-card p-5 md:p-6">
        <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
          Faturas atuais
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
          <Private>{money(data.openTotal)}</Private>
        </h1>
        <CountedLine data={data} className="mt-1.5" />
        {data.nextDue && (
          <dl className="mt-5 grid grid-cols-2 divide-x divide-border/70 border-t border-border/70 pt-3">
            <div className="pr-3">
              <dt className="text-[11px] uppercase tracking-[.1em] text-muted-foreground">
                Próximo vencimento
              </dt>
              <dd className="mt-1 text-sm font-semibold">
                {dayMonth(data.nextDue)}
              </dd>
            </div>
            <div className="pl-3">
              <dt className="text-[11px] uppercase tracking-[.1em] text-muted-foreground">
                Cartões
              </dt>
              <dd className="mt-1 text-sm font-semibold">{cardCount(data)}</dd>
            </div>
          </dl>
        )}
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        {data.cards.map((item) => {
          const { card, current, invoices } = item;
          const next = nextOf(item);
          const facts = [
            { label: 'Vence', value: dayMonth(current.due) },
            {
              label: 'Próxima',
              value: next ? <Private>{money(shownAmount(next))}</Private> : '—',
            },
            {
              label: 'Do total',
              value: `${shareOf(data, current.balance).toDecimalPlaces(0).toString()}%`,
            },
          ];
          return (
            <button
              key={card.account}
              type="button"
              onClick={() => data.onOpen(card.account)}
              className="grid gap-4 rounded-3xl border bg-card p-5 text-left transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-foreground"
            >
              <span className="flex items-start gap-4">
                <span className="w-24 shrink-0">
                  <BigCard bankId={card.bank_id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">
                    {card.account}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {invoiceStatus(current, invoices)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </span>
              <span
                className="text-3xl font-semibold tracking-tight tabular-nums"
                style={{ color: invoiceTextAccent(card.bank_id) }}
              >
                <Private>{money(current.balance)}</Private>
              </span>
              <span className="grid grid-cols-3 divide-x divide-border/70 border-y border-border/70 py-3">
                {facts.map((fact) => (
                  <span
                    key={fact.label}
                    className="min-w-0 px-3 first:pl-0 last:pr-0"
                  >
                    <span className="block text-[11px] uppercase tracking-[.1em] text-muted-foreground">
                      {fact.label}
                    </span>
                    <span className="mt-1 block truncate text-sm font-semibold tabular-nums">
                      {fact.value}
                    </span>
                  </span>
                ))}
              </span>
              <LimitBar
                limit={limitOf(data.limits, card.account)}
                bankId={card.bank_id}
              />
            </button>
          );
        })}
      </div>
      <Pending data={data} />
    </>
  );
}

/** Opção 4: sem caixas, só tipografia, fios e os números grandes. */
function EditorialOption({ data }: { data: InvoiceOverview }) {
  return (
    <>
      <section className="mb-8">
        <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
          Faturas atuais
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tighter tabular-nums md:text-7xl">
          <Private>{money(data.openTotal)}</Private>
        </h1>
        <CountedLine data={data} className="mt-3" />
        <DueLine data={data} className="mt-1" />
      </section>
      <ol className="border-t">
        {data.cards.map((item, index) => {
          const { card, current, invoices } = item;
          const next = nextOf(item);
          return (
            <li key={card.account} className="border-b">
              <button
                type="button"
                onClick={() => data.onOpen(card.account)}
                className="group grid w-full gap-4 py-6 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                <span className="flex items-center gap-3">
                  <span className="w-5 text-xs tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <PaymentCardIcon bankId={card.bank_id} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {card.account}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pl-8">
                  <span
                    className="text-4xl font-semibold tracking-tight tabular-nums"
                    style={{ color: invoiceTextAccent(card.bank_id) }}
                  >
                    <Private>{money(current.balance)}</Private>
                  </span>
                  <span className="text-right text-xs leading-relaxed text-muted-foreground">
                    <span className="block">
                      {invoiceStatus(current, invoices)} · vence{' '}
                      {dayMonth(current.due)}
                    </span>
                    {next && (
                      <span className="block tabular-nums">
                        Próxima <Private>{money(shownAmount(next))}</Private>
                      </span>
                    )}
                  </span>
                </span>
                <span className="pl-8">
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
      <Pending data={data} />
    </>
  );
}

const RENDER: Record<OptionId, (data: InvoiceOverview) => React.ReactNode> = {
  1: (data) => <CarouselOption data={data} />,
  2: (data) => <RingOption data={data} />,
  3: (data) => <SheetOption data={data} />,
  4: (data) => <EditorialOption data={data} />,
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
