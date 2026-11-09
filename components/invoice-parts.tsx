'use client';
// Blocos da fatura (invoice-center.tsx): painel, histórico, resumo,
// categorias e compras.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import {
  CheckCircle2,
  Receipt,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from '@/components/navigation-link';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  invoiceStage,
  type CardInvoice,
  type CardLimitInfo,
} from '@/lib/card-invoices';
import { saoDate } from '@/lib/expense-insights';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { PAYMENT_METHOD_COLOUR, type PaymentCard } from '@/lib/payment-cards';
import { Private } from '@/components/private-value';
import { myShare } from '@/lib/entry-share';
import { isPendingSpend, pendingKey } from '@/lib/unidentified-spend';
import { PendingSpendDialog } from '@/components/pending-spend-dialog';
import { money } from '@/lib/money';

export const compactMoney = (value: Decimal.Value) =>
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
export const dayHeading = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replaceAll('.', '')
    .replace(/^./, (first) => first.toUpperCase());
export const monthShort = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`))
    .replace('.', '');
export const monthLong = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  );
/** Cor do cartão (PAYMENT_METHOD_COLOUR). */
export const invoiceAccent = (bankId: PaymentCard['bank_id']) =>
  bankId === 'other' ? 'var(--foreground)' : PAYMENT_METHOD_COLOUR[bankId];
/** Cores de marca legíveis como texto (por tema, em globals.css). */
export const BRAND_TEXT: Partial<Record<PaymentCard['bank_id'], string>> = {
  nubank: 'var(--brand-nubank-text)',
  picpay: 'var(--brand-picpay-text)',
  itau: '#ec7000',
  'mercado-pago': 'var(--brand-mercadopago-text)',
};
export const invoiceTextAccent = (bankId: PaymentCard['bank_id']) =>
  BRAND_TEXT[bankId] ?? 'var(--foreground)';
/** Nome da fatura; mesma régua do Vetra AI (`invoiceStage`). */
export const STAGE_TITLE = {
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
export const counted = (invoice: CardInvoice) =>
  invoice.entries.filter((entry) => !entry.excluded_from_totals);
/** Gasto do usuário: na compra dividida, só a parte dele. */
export const countedTotal = (invoice: CardInvoice) =>
  counted(invoice).reduce(
    (sum, entry) => sum.plus(myShare(entry)),
    new Decimal(0),
  );

export const byDue = (invoices: CardInvoice[]) =>
  [...invoices].sort((a, b) => a.due.localeCompare(b.due));

/** O "paga" verde, perto do valor de que ele fala. */
export function PaidMark({ className = '' }: { className?: string }) {
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
export function InvoiceHero({
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
export function InvoiceHistory({
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
export function InvoiceSummary({
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
export function CategoryBreakdown({
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

/** Ordens da lista de compras da fatura. Por data agrupa por dia. */
const EXPENSE_ORDERS = {
  recentes: 'Mais recentes',
  antigas: 'Mais antigas',
  maior: 'Maior valor',
  menor: 'Menor valor',
  nome: 'Nome (A–Z)',
} as const;
type ExpenseOrder = keyof typeof EXPENSE_ORDERS;

/** Ordem escolhida, mantida entre as faturas e os cartões abertos. */
let lastExpenseOrder: ExpenseOrder = 'recentes';

/** As compras da fatura, por dia (com o total do dia), valor ou nome. */
export function ExpenseList({ invoice }: { invoice: CardInvoice }) {
  const [order, setOrder] = useState<ExpenseOrder>(() => lastExpenseOrder);
  const byDate = order === 'recentes' || order === 'antigas';
  const days = useMemo(() => {
    const groups = new Map<string, FinancialEntry[]>();
    for (const entry of invoice.entries) {
      const day = saoDate(entry.occurred_at);
      groups.set(day, [...(groups.get(day) ?? []), entry]);
    }
    return [...groups].sort((a, b) =>
      order === 'antigas' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]),
    );
  }, [invoice, order]);
  const flat = useMemo(
    () =>
      [...invoice.entries].sort((a, b) =>
        order === 'nome'
          ? a.description.localeCompare(b.description, 'pt-BR')
          : order === 'menor'
            ? new Decimal(a.amount).comparedTo(b.amount)
            : new Decimal(b.amount).comparedTo(a.amount),
      ),
    [invoice, order],
  );
  const row = (entry: FinancialEntry, withDay: boolean) =>
    isPendingSpend(entry) ? (
      <PendingSpendRow key={entry.id} entry={entry} />
    ) : (
      <Link
        key={entry.id}
        href="/financeiro"
        className="flex items-center justify-between gap-3 py-3 transition-colors hover:text-muted-foreground"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm">{entry.description}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {withDay ? `${dayHeading(saoDate(entry.occurred_at))} · ` : ''}
            {entry.category}
            {entry.installment_number && entry.installment_total
              ? ` · parcela ${entry.installment_number}/${entry.installment_total}`
              : ''}
            {entry.projected
              ? ' · prevista'
              : entry.bank_status === 'PENDING'
                ? ' · pendente'
                : ''}
            {entry.excluded_from_totals ? ' · fora das contas' : ''}
          </span>
        </span>
        <span className="shrink-0 text-sm tabular-nums">
          <Private>{money(entry.amount)}</Private>
        </span>
      </Link>
    );
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-sm font-semibold">Compras</h2>
          <span className="text-xs text-muted-foreground">
            {invoice.entries.length === 1
              ? '1 compra'
              : `${invoice.entries.length} compras`}
          </span>
        </div>
        {invoice.entries.length > 1 && (
          <Select
            value={order}
            onValueChange={(value) => {
              if (!value) return;
              lastExpenseOrder = value as ExpenseOrder;
              setOrder(value as ExpenseOrder);
            }}
          >
            <SelectTrigger size="sm" aria-label="Ordenar compras">
              <span>{EXPENSE_ORDERS[order]}</span>
            </SelectTrigger>
            {/* Largura do gatilho como piso, não teto: o rótulo era cortado. */}
            <SelectContent className="w-auto min-w-(--anchor-width)">
              {(Object.keys(EXPENSE_ORDERS) as ExpenseOrder[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {EXPENSE_ORDERS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {!invoice.entries.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma compra nesta fatura.
        </p>
      ) : byDate ? (
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
                {items.map((entry) => row(entry, false))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border/40 border-t border-border/70">
          {flat.map((entry) => row(entry, true))}
        </div>
      )}
    </section>
  );
}

/**
 * Cartão de crédito sem fatura ainda (sem ciclo): mostra limite e aviso até
 * a primeira fatura fechar.
 */
/**
 * Gasto já no limite, compra ainda não chegou (lib/unidentified-spend.ts):
 * conta na fatura, mas não abre.
 */
export function PendingSpendRow({ entry }: { entry: FinancialEntry }) {
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
