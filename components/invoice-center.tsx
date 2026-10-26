'use client';

import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import {
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Receipt,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import Link from '@/components/navigation-link';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  buildCreditCardInvoices,
  invoiceStage,
  type CardBill,
  type CardInvoice,
  type CardInvoicePayment,
  type CardLimitInfo,
  type CreditCardInvoices,
} from '@/lib/card-invoices';
import { saoDate, type CardCycle } from '@/lib/expense-insights';
import type { FinancialEntry } from '@/lib/financial-tracker';
import {
  PAYMENT_METHOD_COLOUR,
  sortPaymentCardsByUsage,
  type PaymentCard,
} from '@/lib/payment-cards';
import { Private } from '@/components/private-value';
import { myShare } from '@/lib/entry-share';
import { isPendingSpend, pendingKey } from '@/lib/unidentified-spend';
import { PendingSpendDialog } from '@/components/pending-spend-dialog';

// Faturas em blocos: painel (valor, datas, limite), histórico em barras que
// trocam a fatura, resumo e destaques, categorias e compras por dia.

export const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value).toNumber());
const compactMoney = (value: Decimal.Value) =>
  `R$ ${new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(new Decimal(value).toNumber())}`;
export const dayMonth = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replace('.', '');
const dayHeading = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replaceAll('.', '')
    .replace(/^./, (first) => first.toUpperCase());
const monthShort = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`))
    .replace('.', '');
const monthLong = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  );
/** Cor do cartão (PAYMENT_METHOD_COLOUR). */
export const invoiceAccent = (bankId: PaymentCard['bank_id']) =>
  bankId === 'other' ? 'var(--foreground)' : PAYMENT_METHOD_COLOUR[bankId];
/** Cores de marca legíveis como texto (por tema, em globals.css). */
const BRAND_TEXT: Partial<Record<PaymentCard['bank_id'], string>> = {
  nubank: 'var(--brand-nubank-text)',
  picpay: 'var(--brand-picpay-text)',
  itau: '#ec7000',
  'mercado-pago': 'var(--brand-mercadopago-text)',
};
export const invoiceTextAccent = (bankId: PaymentCard['bank_id']) =>
  BRAND_TEXT[bankId] ?? 'var(--foreground)';
/** Nome da fatura; mesma régua do Vetra AI (`invoiceStage`). */
const STAGE_TITLE = {
  anterior: 'Fatura anterior',
  fechada: 'Fatura fechada',
  atual: 'Fatura atual',
  próxima: 'Próxima fatura',
} as const;
export const invoiceStatus = (invoice: CardInvoice, invoices: CardInvoice[]) =>
  STAGE_TITLE[invoiceStage(invoice, invoices)];

/** Paga mostra o valor que teve; as outras, o que falta. */
export const shownAmount = (invoice: CardInvoice) =>
  invoice.settled ? invoice.charged : invoice.balance;

/**
 * Compras que contam como gasto: sem as "fora das contas" (que seguem no valor
 * da fatura, mas não em destaques e categorias).
 */
const counted = (invoice: CardInvoice) =>
  invoice.entries.filter((entry) => !entry.excluded_from_totals);
/** Gasto do usuário: na compra dividida, só a parte dele. */
const countedTotal = (invoice: CardInvoice) =>
  counted(invoice).reduce(
    (sum, entry) => sum.plus(myShare(entry)),
    new Decimal(0),
  );

export const byDue = (invoices: CardInvoice[]) =>
  [...invoices].sort((a, b) => a.due.localeCompare(b.due));

/** O "paga" verde, perto do valor de que ele fala. */
function PaidMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 ${className}`}
    >
      <CheckCircle2 className="size-3.5" />
      Paga
    </span>
  );
}

/** O limite do cartão, como o banco informa pela Pluggy. */
export type CardLimit = CardLimitInfo & { synced_at?: string | null };

/** Quanto do limite está em uso, numa barra da cor do cartão. */
export function LimitBar({
  limit,
  bankId,
}: {
  limit?: CardLimit;
  bankId: PaymentCard['bank_id'];
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
    <span className="block">
      <span className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span>Limite disponível</span>
        <span className="tabular-nums">
          <Private>{money(available)}</Private> de{' '}
          <Private>{money(total)}</Private>
        </span>
      </span>
      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-foreground/10">
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

/** O painel de cima: status, valor, as datas e o limite. */
function InvoiceHero({
  invoice,
  invoices,
  card,
  limit,
}: {
  invoice: CardInvoice;
  invoices: CardInvoice[];
  card: PaymentCard;
  limit?: CardLimit;
}) {
  const facts = [
    { label: 'Vence', value: dayMonth(invoice.due) },
    { label: 'Fecha', value: dayMonth(invoice.closing) },
    invoice.minimum
      ? { label: 'Mínimo', value: <Private>{money(invoice.minimum)}</Private> }
      : { label: 'Compras', value: String(invoice.entries.length) },
  ];
  return (
    <section className="mb-8 rounded-3xl border bg-card p-5 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
            {invoiceStatus(invoice, invoices)}
          </p>
          <h1
            className="mt-2 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl"
            style={{ color: invoiceTextAccent(card.bank_id) }}
          >
            <Private>{money(shownAmount(invoice))}</Private>
          </h1>
          {invoice.settled ? (
            <PaidMark className="mt-2 text-sm" />
          ) : (
            new Decimal(invoice.paid).gt(0) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Já pago <Private>{money(invoice.paid)}</Private> de{' '}
                <Private>{money(invoice.charged)}</Private>
              </p>
            )
          )}
        </div>
        <span className="shrink-0 sm:hidden">
          <PaymentCardIcon bankId={card.bank_id} />
        </span>
        <span className="hidden shrink-0 sm:block">
          <PaymentCardIcon bankId={card.bank_id} large />
        </span>
      </div>
      <dl className="mt-6 grid grid-cols-3 divide-x divide-border/70 border-y border-border/70 py-3">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0 px-3 first:pl-0 last:pr-0">
            <dt className="text-[11px] uppercase tracking-[.1em] text-muted-foreground">
              {fact.label}
            </dt>
            <dd className="mt-1 truncate text-sm font-semibold tabular-nums">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
      {limit?.credit_limit != null && (
        <div className="mt-4">
          <LimitBar limit={limit} bankId={card.bank_id} />
        </div>
      )}
    </section>
  );
}

/**
 * Histórico em barras: a escolhida na cor do cartão, as próximas em
 * pontilhado. Tocar abre a fatura.
 */
function InvoiceHistory({
  invoice,
  invoices,
  bankId,
  onChange,
}: {
  invoice: CardInvoice;
  invoices: CardInvoice[];
  bankId: PaymentCard['bank_id'];
  onChange: (due: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const sorted = byDue(invoices);
  const accent = invoiceAccent(bankId);
  const highest = Decimal.max(
    1,
    ...sorted.map((item) => new Decimal(shownAmount(item))),
  );
  // Centraliza a fatura escolhida quando há mais colunas que tela.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const selected = viewport?.querySelector<HTMLElement>(
      `[data-invoice-due="${invoice.due}"]`,
    );
    if (!viewport || !selected) return;
    viewport.scrollLeft =
      selected.offsetLeft - (viewport.clientWidth - selected.offsetWidth) / 2;
  }, [invoice.due, bankId]);
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold">Histórico</h2>
      <ScrollArea
        orientation="horizontal"
        viewportRef={viewportRef}
        className="scroll-bleed"
      >
        <div
          role="tablist"
          aria-label="Escolher fatura"
          className="grid min-w-full items-end justify-start gap-2 pb-1 md:gap-3"
          style={{
            // Coluna com teto de largura.
            gridTemplateColumns: `repeat(${sorted.length}, minmax(2.75rem, 4rem))`,
          }}
        >
          {sorted.map((item) => {
            const selected = item.due === invoice.due;
            const projected = invoiceStage(item, invoices) === 'próxima';
            const amount = new Decimal(shownAmount(item));
            const height = Math.max(
              6,
              amount.div(highest).times(100).toNumber(),
            );
            return (
              <button
                key={item.due}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={`${monthLong(item.due)}${projected ? ', prevista' : ''}: ${money(amount)}`}
                data-invoice-due={item.due}
                onClick={() => onChange(item.due)}
                className="group grid min-w-0 gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                <span className="flex h-32 items-end md:h-40">
                  <span
                    className={`block w-full rounded-t-md transition-colors ${
                      selected
                        ? ''
                        : projected
                          ? 'border-2 border-dotted border-foreground/50 bg-foreground/15 group-hover:bg-foreground/25'
                          : 'bg-foreground/15 group-hover:bg-foreground/25'
                    }`}
                    style={{
                      height: `${height}%`,
                      background: selected ? accent : undefined,
                    }}
                  />
                </span>
                <span className="grid gap-0.5 text-center">
                  <span
                    className={`block truncate text-[10px] tabular-nums ${selected ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                  >
                    <Private>{compactMoney(amount)}</Private>
                  </span>
                  <span
                    className={`flex items-center justify-center gap-0.5 text-[10px] uppercase tracking-[.08em] ${selected ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                  >
                    {monthShort(item.due)}
                    {item.due.slice(0, 4) !== invoice.due.slice(0, 4) &&
                      ` ${item.due.slice(2, 4)}`}
                    {item.settled && (
                      <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
}

/** O que compõe o valor, linha a linha, e três destaques da fatura. */
function InvoiceSummary({
  invoice,
  invoices,
}: {
  invoice: CardInvoice;
  invoices: CardInvoice[];
}) {
  const signed = (value: Decimal.Value) =>
    `${new Decimal(value).isNegative() ? '−' : '+'} ${money(new Decimal(value).abs())}`;
  const sorted = byDue(invoices);
  const previous =
    sorted[sorted.findIndex((item) => item.due === invoice.due) - 1];
  const own = counted(invoice);
  const ownTotal = countedTotal(invoice);
  const previousTotal = previous ? countedTotal(previous) : null;
  const excluded = invoice.entries
    .filter((entry) => entry.excluded_from_totals)
    .reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
  // O que os outros vão pagar das compras divididas.
  const others = new Decimal(invoice.total).minus(ownTotal).minus(excluded);
  const biggest = own.reduce<FinancialEntry | null>(
    (best, entry) => (!best || myShare(entry).gt(myShare(best)) ? entry : best),
    null,
  );
  const count = own.length;
  const average = count ? ownTotal.div(count) : null;
  const change =
    previous && previousTotal?.gt(0)
      ? ownTotal.minus(previousTotal).div(previousTotal).times(100)
      : null;
  // O valor só vira texto dentro do <Private>.
  const rows: {
    label: string;
    amount: Decimal.Value;
    signed?: boolean;
    tone?: string;
  }[] =
    excluded.isZero() && !others.gt(0)
      ? [{ label: 'Compras do ciclo', amount: invoice.total }]
      : [
          { label: 'Suas compras', amount: ownTotal },
          ...(others.gt(0)
            ? [{ label: 'Parte dos outros (divididas)', amount: others }]
            : []),
          ...(excluded.isZero()
            ? []
            : [{ label: 'Fora das contas', amount: excluded }]),
        ];
  if (invoice.carried)
    rows.push({
      label: 'Pago a mais na anterior',
      amount: invoice.carried,
      signed: true,
      tone: 'text-emerald-600 dark:text-emerald-400',
    });
  if (invoice.adjustments)
    rows.push({
      label: 'Encargos do banco',
      amount: invoice.adjustments,
      signed: true,
    });
  if (!invoice.settled && new Decimal(invoice.paid).gt(0))
    rows.push({
      label: 'Pagamentos',
      amount: new Decimal(invoice.paid).negated(),
      signed: true,
      tone: 'text-emerald-600 dark:text-emerald-400',
    });
  const highlights: { icon: typeof Receipt; text: React.ReactNode }[] = [];
  if (change && previous)
    highlights.push({
      icon: change.gte(0) ? TrendingUp : TrendingDown,
      text: `${change.gte(0) ? '+' : '−'}${change.abs().toDecimalPlaces(0).toString()}% em compras que em ${monthLong(previous.due)}`,
    });
  if (biggest)
    highlights.push({
      icon: ShoppingBag,
      text: (
        <>
          Maior compra: {biggest.description} ·{' '}
          <Private>{money(myShare(biggest))}</Private>
        </>
      ),
    });
  if (average)
    highlights.push({
      icon: Receipt,
      text: (
        <>
          Média de <Private>{money(average)}</Private> por compra
        </>
      ),
    });
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold">Resumo</h2>
      <div className="rounded-3xl border bg-card p-4 md:p-5">
        <dl className="grid gap-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className={`tabular-nums ${row.tone ?? ''}`}>
                <Private>
                  {row.signed ? signed(row.amount) : money(row.amount)}
                </Private>
              </dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between gap-3 border-t border-border/70 pt-3 font-semibold">
            <dt>{invoice.settled ? 'Total da fatura' : 'Falta pagar'}</dt>
            <dd className="tabular-nums">
              <Private>{money(shownAmount(invoice))}</Private>
            </dd>
          </div>
        </dl>
        {highlights.length > 0 && (
          <ul className="mt-4 grid gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground">
            {highlights.map(({ icon: Icon, text }, index) => (
              <li key={index} className="flex min-w-0 items-center gap-2">
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** As categorias da fatura, uma por linha, com a barra do quanto pesam. */
function CategoryBreakdown({
  invoice,
  bankId,
}: {
  invoice: CardInvoice;
  bankId: PaymentCard['bank_id'];
}) {
  const categories = useMemo(() => {
    const totals = new Map<string, Decimal>();
    for (const entry of counted(invoice))
      totals.set(
        entry.category,
        (totals.get(entry.category) ?? new Decimal(0)).plus(myShare(entry)),
      );
    return [...totals]
      .filter(([, value]) => value.gt(0))
      .sort((a, b) => b[1].comparedTo(a[1]));
  }, [invoice]);
  const total = categories.reduce(
    (sum, [, value]) => sum.plus(value),
    new Decimal(0),
  );
  if (!total.gt(0)) return null;
  const top = categories.slice(0, 5);
  const rest = categories
    .slice(5)
    .reduce((sum, [, value]) => sum.plus(value), new Decimal(0));
  const parts = [
    ...top,
    ...(rest.gt(0) ? [['Outras', rest] as [string, Decimal]] : []),
  ];
  const percent = (value: Decimal) => value.div(total).times(100).toNumber();
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold">Por categoria</h2>
      <div className="grid gap-3">
        {parts.map(([name, value]) => (
          <div key={name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{name}</span>
              <span className="shrink-0 tabular-nums">
                <Private>{money(value)}</Private>
                <span className="ml-2 inline-block w-9 text-right text-xs text-muted-foreground">
                  {Math.round(percent(value))}%
                </span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${percent(value)}%`,
                  background: invoiceAccent(bankId),
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** As compras agrupadas por dia, com o total de cada dia. */
function ExpenseList({ invoice }: { invoice: CardInvoice }) {
  const days = useMemo(() => {
    const groups = new Map<string, FinancialEntry[]>();
    for (const entry of invoice.entries) {
      const day = saoDate(entry.occurred_at);
      groups.set(day, [...(groups.get(day) ?? []), entry]);
    }
    return [...groups].sort((a, b) => b[0].localeCompare(a[0]));
  }, [invoice]);
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Compras</h2>
        <span className="text-xs text-muted-foreground">
          {invoice.entries.length === 1
            ? '1 compra'
            : `${invoice.entries.length} compras`}
        </span>
      </div>
      {days.length ? (
        <div className="grid gap-5">
          {days.map(([day, items]) => (
            <div key={day}>
              <div className="flex items-baseline justify-between gap-3 border-b border-border/70 pb-1.5 text-xs text-muted-foreground">
                <span>{dayHeading(day)}</span>
                {items.length > 1 && (
                  <span className="tabular-nums">
                    <Private>
                      {money(
                        items.reduce(
                          (sum, entry) => sum.plus(entry.amount),
                          new Decimal(0),
                        ),
                      )}
                    </Private>
                  </span>
                )}
              </div>
              <div className="divide-y divide-border/40">
                {items.map((entry) =>
                  isPendingSpend(entry) ? (
                    <PendingSpendRow key={entry.id} entry={entry} />
                  ) : (
                    <Link
                      key={entry.id}
                      href="/financeiro"
                      className="flex items-center justify-between gap-3 py-3 transition-colors hover:text-muted-foreground"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">
                          {entry.description}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {entry.category}
                          {entry.installment_number && entry.installment_total
                            ? ` · parcela ${entry.installment_number}/${entry.installment_total}`
                            : ''}
                          {entry.bank_status === 'PENDING' ? ' · pendente' : ''}
                          {entry.excluded_from_totals
                            ? ' · fora das contas'
                            : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums">
                        <Private>{money(entry.amount)}</Private>
                      </span>
                    </Link>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma compra nesta fatura.
        </p>
      )}
    </section>
  );
}

/**
 * Cartão de crédito sem fatura ainda (sem ciclo): mostra limite e aviso até
 * a primeira fatura fechar.
 */
export function PendingCardPanel({
  card,
  limit,
  onOpen,
}: {
  card: PaymentCard;
  limit?: CardLimit;
  onOpen?: (account: string) => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-3">
        <PaymentCardIcon bankId={card.bank_id} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {card.account}
          </span>
          <span className="block text-xs text-muted-foreground">
            Sem fatura ainda
          </span>
        </span>
        {onOpen && <ChevronRight className="size-4 text-muted-foreground" />}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">
        O banco ainda não fechou nenhuma fatura deste cartão. Quando fechar, o
        vencimento, as compras e o valor aparecem aqui sozinhos.
      </span>
      <LimitBar limit={limit} bankId={card.bank_id} />
    </>
  );
  return onOpen ? (
    <button
      type="button"
      onClick={() => onOpen(card.account)}
      className="grid gap-4 rounded-3xl border bg-card p-5 text-left transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-foreground"
    >
      {body}
    </button>
  ) : (
    <section className="mb-8 grid gap-4 rounded-3xl border bg-card p-5 md:p-6">
      {body}
    </section>
  );
}

/**
 * "Todas", sem caixas: cada cartão numa faixa entre fios, com o valor grande,
 * a fatura e a próxima numa linha só e o limite embaixo.
 */
function ConsolidatedInvoices({
  cards,
  pending,
  limits,
  onOpen,
}: {
  cards: CreditCardInvoices[];
  pending: PaymentCard[];
  limits: CardLimit[];
  onOpen: (account: string) => void;
}) {
  return (
    <>
      <ol className="border-t">
        {cards.map(({ card, current, invoices }, index) => {
          const next = byDue(invoices).find((item) => item.due > current.due);
          return (
            <li key={card.account} className="border-b">
              <button
                type="button"
                onClick={() => onOpen(card.account)}
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
                <span className="grid gap-2 pl-8">
                  <span
                    className="text-4xl font-semibold tracking-tight tabular-nums"
                    style={{ color: invoiceTextAccent(card.bank_id) }}
                  >
                    <Private>{money(current.balance)}</Private>
                  </span>
                  <span className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">
                      Vence {dayMonth(current.due)}
                    </span>
                    {next && (
                      <span className="shrink-0 tabular-nums">
                        Próxima <Private>{money(shownAmount(next))}</Private>
                      </span>
                    )}
                  </span>
                </span>
                <span className="pl-8">
                  <LimitBar
                    limit={limits.find((item) => item.account === card.account)}
                    bankId={card.bank_id}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {pending.length > 0 && (
        <div className="mt-3 grid gap-3">
          {pending.map((card) => (
            <PendingCardPanel
              key={card.account}
              card={card}
              limit={limits.find((item) => item.account === card.account)}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Cartões das faturas na ordem da tela: bancos em ordem fixa e, no mesmo
 * banco, o mais usado primeiro. `pending`: cartão com limite e sem fatura.
 */
export function useInvoiceCards({
  entries,
  cards,
  cycles,
  payments,
  bills,
  limits,
}: {
  entries: FinancialEntry[];
  cards: PaymentCard[];
  cycles: CardCycle[];
  payments: CardInvoicePayment[];
  bills: CardBill[];
  limits: CardLimit[];
}) {
  const sortedCards = useMemo(
    () =>
      sortPaymentCardsByUsage(
        cards,
        entries.map((entry) => entry.account),
      )
        .map((card, index) => ({ card, index }))
        .sort(
          (a, b) =>
            bankRank(a.card.bank_id) - bankRank(b.card.bank_id) ||
            a.index - b.index,
        )
        .map(({ card }) => card),
    [cards, entries],
  );
  const invoiceCards = useMemo(
    () =>
      buildCreditCardInvoices(
        entries,
        sortedCards,
        cycles,
        undefined,
        payments,
        bills,
        limits,
      ),
    [bills, cycles, entries, limits, payments, sortedCards],
  );
  const pendingCards = useMemo(
    () =>
      sortedCards.filter(
        (card) =>
          limits.some((item) => item.account === card.account) &&
          !invoiceCards.some((item) => item.card.account === card.account),
      ),
    [invoiceCards, limits, sortedCards],
  );
  return { invoiceCards, pendingCards };
}

/** A ordem dos bancos nas faturas; os que não estão aqui vêm depois. */
const BANK_ORDER: PaymentCard['bank_id'][] = [
  'nubank',
  'itau',
  'picpay',
  'mercado-pago',
];
const bankRank = (bank: PaymentCard['bank_id']) => {
  const index = BANK_ORDER.indexOf(bank);
  return index === -1 ? BANK_ORDER.length : index;
};

/** O que a visão "Todas" mostra; as opções de redesenho recebem o mesmo. */
export type InvoiceOverview = {
  cards: CreditCardInvoices[];
  pending: PaymentCard[];
  limits: CardLimit[];
  openTotal: Decimal;
  countedOpenTotal: Decimal;
  nextDue?: string;
  onOpen: (account: string) => void;
};

export function InvoiceCenter({
  entries,
  cards,
  cycles,
  payments,
  bills = [],
  limits = [],
  initialAccount = 'all',
  initialError,
  overview,
  top,
}: {
  entries: FinancialEntry[];
  cards: PaymentCard[];
  cycles: CardCycle[];
  payments: CardInvoicePayment[];
  bills?: CardBill[];
  limits?: CardLimit[];
  /** O cartão que a página abre escolhido; "all" é a visão de todas. */
  initialAccount?: string;
  initialError: string;
  /** Teste de redesenho: troca a visão "Todas" (/faturas/opcoes). */
  overview?: (data: InvoiceOverview) => ReactNode;
  /** Acima de tudo, abaixo do voltar (o seletor das opções). */
  top?: ReactNode;
}) {
  const router = useRouter();
  const { invoiceCards, pendingCards } = useInvoiceCards({
    entries,
    cards,
    cycles,
    payments,
    bills,
    limits,
  });
  const [activeAccount, setActiveAccount] = useState(initialAccount);
  const [selectedDue, setSelectedDue] = useState('');
  const active = invoiceCards.find(
    ({ card }) => card.account === activeAccount,
  );
  const invoice = active
    ? (active.invoices.find((item) => item.due === selectedDue) ??
      active.current)
    : null;
  const limit = active
    ? limits.find((item) => item.account === active.card.account)
    : undefined;
  const openTotal = invoiceCards.reduce(
    (sum, item) => sum.plus(item.current.balance),
    new Decimal(0),
  );
  // O mesmo total sem as compras "fora das contas" (como em /cobertura).
  const countedOpenTotal = invoiceCards.reduce(
    (sum, item) =>
      sum.plus(
        Decimal.max(
          new Decimal(item.current.balance).minus(
            item.current.entries
              .filter((entry) => entry.excluded_from_totals)
              .reduce(
                (total, entry) =>
                  entry.entry_type === 'income'
                    ? total.minus(entry.amount)
                    : total.plus(entry.amount),
                new Decimal(0),
              ),
          ),
          0,
        ),
      ),
    new Decimal(0),
  );
  const nextDue = invoiceCards.map((item) => item.current.due).sort()[0];
  const activePending = pendingCards.find(
    (card) => card.account === activeAccount,
  );
  const choose = (account: string) => {
    setActiveAccount(account);
    setSelectedDue('');
    // Trocar entre a lista e um cartão começa a tela do topo.
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="min-h-dvh overflow-x-clip bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AppHeader onRefresh={() => router.refresh()} />
      <div className="app-container min-w-0 max-w-3xl py-6 md:py-9">
        {/* Sem a fileira de bancos (pedido do Bruno, 26/10/2026): com um
            cartão aberto, voltar leva à lista; aberto de fora, volta à
            página de onde veio. */}
        <NavigationBackButton
          className="mb-5"
          onBack={
            activeAccount !== 'all' && initialAccount === 'all'
              ? () => choose('all')
              : undefined
          }
        />
        {top}
        {initialError && (
          <p className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            Não foi possível carregar todas as informações das faturas.
          </p>
        )}

        {invoiceCards.length || pendingCards.length ? (
          <>
            {activePending ? (
              <PendingCardPanel
                card={activePending}
                limit={limits.find(
                  (item) => item.account === activePending.account,
                )}
              />
            ) : (!active || !invoice) && overview ? (
              overview({
                cards: invoiceCards,
                pending: pendingCards,
                limits,
                openTotal,
                countedOpenTotal,
                nextDue,
                onOpen: choose,
              })
            ) : !active || !invoice ? (
              <>
                <section className="mb-8">
                  <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
                    Faturas atuais
                  </p>
                  <h1 className="mt-3 text-5xl font-semibold tracking-tighter tabular-nums md:text-7xl">
                    <Private>{money(openTotal)}</Private>
                  </h1>
                  {!countedOpenTotal.eq(openTotal) && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground tabular-nums">
                        <Private>{money(countedOpenTotal)}</Private>
                      </span>{' '}
                      nas contas, sem o que está fora delas
                    </p>
                  )}
                  {nextDue && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {invoiceCards.length + pendingCards.length === 1
                        ? '1 cartão'
                        : `${invoiceCards.length + pendingCards.length} cartões`}{' '}
                      · próximo vencimento {dayMonth(nextDue)}
                    </p>
                  )}
                </section>
                <ConsolidatedInvoices
                  cards={invoiceCards}
                  pending={pendingCards}
                  limits={limits}
                  onOpen={choose}
                />
              </>
            ) : (
              <>
                <InvoiceHero
                  invoice={invoice}
                  invoices={active.invoices}
                  card={active.card}
                  limit={limit}
                />
                <InvoiceHistory
                  invoice={invoice}
                  invoices={active.invoices}
                  bankId={active.card.bank_id}
                  onChange={setSelectedDue}
                />
                <div
                  key={`${active.card.account}-${invoice.due}`}
                  className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
                >
                  <InvoiceSummary
                    invoice={invoice}
                    invoices={active.invoices}
                  />
                  <CategoryBreakdown
                    invoice={invoice}
                    bankId={active.card.bank_id}
                  />
                  <ExpenseList invoice={invoice} />
                </div>
              </>
            )}
          </>
        ) : (
          <section className="grid min-h-80 place-items-center text-center">
            <div>
              <CreditCard className="mx-auto size-8 text-muted-foreground" />
              <h2 className="mt-4 font-semibold">
                Configure seus cartões de crédito
              </h2>
              <Button className="mt-5" render={<Link href="/configuracoes" />}>
                Abrir configurações
              </Button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/**
 * Gasto já no limite, compra ainda não chegou (lib/unidentified-spend.ts):
 * conta na fatura, mas não abre.
 */
function PendingSpendRow({ entry }: { entry: FinancialEntry }) {
  const [open, setOpen] = useState(false);
  const key = pendingKey(entry);
  const split = entry.notes === 'Dividida por você';
  return (
    <>
      <button
        type="button"
        disabled={!key}
        aria-label={`${entry.description}: dividir ou corrigir a data`}
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm">{entry.description}*</span>
          {entry.pending_overdue ? (
            <span className="mt-0.5 block truncate text-xs font-medium text-amber-700 dark:text-amber-300">
              Passou de 3 dias sem chegar · toque para decidir
            </span>
          ) : (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {split
                ? 'Dividida por você · chega em até 7 dias'
                : 'O limite já caiu · toque para dividir ou excluir'}
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          <Private>{money(entry.amount)}*</Private>
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
