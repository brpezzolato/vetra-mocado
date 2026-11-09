'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { ChevronRight, CreditCard } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import Link from '@/components/navigation-link';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Button } from '@/components/ui/button';
import {
  buildCreditCardInvoices,
  type CardBill,
  type CardInvoicePayment,
  type CreditCardInvoices,
} from '@/lib/card-invoices';
import { type CardCycle } from '@/lib/expense-insights';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { sortPaymentCardsByUsage, type PaymentCard } from '@/lib/payment-cards';
import { Private } from '@/components/private-value';
import { money } from '@/lib/money';
import {
  dayMonth,
  invoiceAccent,
  invoiceTextAccent,
  shownAmount,
  byDue,
  type CardLimit,
  LimitBar,
  InvoiceHero,
  InvoiceHistory,
  InvoiceSummary,
  CategoryBreakdown,
  ExpenseList,
} from '@/components/invoice-parts';

// Faturas em blocos: painel (valor, datas, limite), histórico em barras que
// trocam a fatura, resumo e destaques, categorias e compras por dia.

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
 * "Todas": por cartão, a fatura e o limite disponível lado a lado (opção 3
 * da terceira rodada, escolhida pelo Bruno em 26/10/2026) e a barra do
 * limite em uso embaixo.
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
  // Sempre da maior fatura atual para a menor (pedido do Bruno, 09/11/2026).
  const sorted = [...cards].sort((a, b) =>
    new Decimal(b.current.balance).comparedTo(a.current.balance),
  );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sorted.map(({ card, current, invoices }) => {
        const next = byDue(invoices).find((item) => item.due > current.due);
        const limit = limits.find((item) => item.account === card.account);
        const total =
          limit?.credit_limit != null ? new Decimal(limit.credit_limit) : null;
        const available = new Decimal(limit?.available_limit ?? 0);
        const used =
          total && total.gt(0)
            ? Decimal.max(
                0,
                Decimal.min(100, total.minus(available).div(total).times(100)),
              ).toNumber()
            : null;
        return (
          <button
            key={card.account}
            type="button"
            onClick={() => onOpen(card.account)}
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
                {used !== null && total ? (
                  <>
                    <span className="mt-1 block truncate text-xl font-semibold tracking-tight tabular-nums">
                      <Private>{money(available)}</Private>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground tabular-nums">
                      de <Private>{money(total)}</Private>
                    </span>
                  </>
                ) : (
                  <span className="mt-1 block text-sm text-muted-foreground">
                    Sem informação
                  </span>
                )}
              </span>
            </span>
            {used !== null && (
              <span className="block h-1.5 overflow-hidden rounded-full bg-foreground/10">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${used}%`,
                    background: invoiceAccent(card.bank_id),
                  }}
                />
              </span>
            )}
          </button>
        );
      })}
      {pending.map((card) => (
        <PendingCardPanel
          key={card.account}
          card={card}
          limit={limits.find((item) => item.account === card.account)}
          onOpen={onOpen}
        />
      ))}
    </div>
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

export function InvoiceCenter({
  entries,
  cards,
  cycles,
  payments,
  bills = [],
  limits = [],
  initialAccount = 'all',
  initialError,
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
            ) : !active || !invoice ? (
              <>
                <section className="mb-6">
                  <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
                    Faturas atuais
                  </p>
                  <h1 className="mt-2 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
                    <Private>{money(openTotal)}</Private>
                  </h1>
                  {!countedOpenTotal.eq(openTotal) && (
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground tabular-nums">
                        <Private>{money(countedOpenTotal)}</Private>
                      </span>{' '}
                      nas contas, sem o que está fora delas
                    </p>
                  )}
                  {nextDue && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
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
