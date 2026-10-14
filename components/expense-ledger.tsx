'use client';

import { useCallback, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import Image from 'next/image';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Clock3,
  CreditCard,
  EyeOff,
  Layers,
  List,
  Plus,
  Search,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { createClient } from '@/lib/supabase/client';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import { loadUnidentifiedSpend } from '@/lib/unidentified-spend-query';
import {
  pendingEntries,
  type UnidentifiedSpend,
} from '@/lib/unidentified-spend';
import {
  PAYMENT_METHOD_COLOUR,
  resolvePaymentMethod,
  sortPaymentCardsByUsage,
  type PaymentCard,
  type PaymentMethodId,
} from '@/lib/payment-cards';
import { countedAmount, isSplit } from '@/lib/entry-share';
import { isInstallment, type CardCycle } from '@/lib/expense-insights';
import { invoiceSpendingMonth } from '@/lib/card-invoices';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import { cn } from '@/lib/utils';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { ExpenseEntryDialog } from '@/components/expense-entry-dialog';
import { ExpenseDayList } from '@/components/expense-line';
import { EntryDetails } from '@/components/entry-details';
import { ExpenseAssistant } from '@/components/expense-assistant';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* Extrato (/financeiro): o mês em destaque, busca, filtros por situação
   (pendentes, parcelas, divididas, fora das contas) e por cartão, e os
   gastos por mês e dia. "Pendentes" são as compras a chegar
   (lib/unidentified-spend.ts): só aparecem lá e não somam no extrato até
   chegarem do banco. */

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value || 0).toDecimalPlaces(2).toNumber(),
  );

const monthKey = (value: Date | string = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date(value));

/** Dia do mês em São Paulo. */
const dayOfMonth = (value: Date | string) =>
  Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
    }).format(new Date(value)),
  );

/** "outubro de 2026", de "2026-10". */
const monthName = (month: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-15T12:00:00Z`));

/** "set", de "2026-09". */
const shortMonth = (month: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'short' })
    .format(new Date(`${month}-15T12:00:00Z`))
    .replace('.', '');

const previousMonth = (month: string) => {
  const date = new Date(`${month}-15T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
};

/** Busca sem acento e sem caixa. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const sum = (entries: FinancialEntry[]) =>
  entries.reduce(
    (total, entry) => total.plus(countedAmount(entry)),
    new Decimal(0),
  );

type Status = 'all' | 'pending' | 'installments' | 'split' | 'excluded';

const STATUSES: { value: Status; label: string; icon: LucideIcon }[] = [
  { value: 'all', label: 'Tudo', icon: List },
  { value: 'pending', label: 'Pendentes', icon: Clock3 },
  { value: 'installments', label: 'Parcelas', icon: Layers },
  { value: 'split', label: 'Divididas', icon: Users },
  { value: 'excluded', label: 'Fora das contas', icon: EyeOff },
];

/** O logo de cada banco no filtro por meio de pagamento. */
const BANK_LOGO: Partial<Record<PaymentMethodId, string>> = {
  flash: '/logos/flash-ui.webp',
  nubank: '/logos/nubank-ui.webp',
  itau: '/logos/itau-app.webp',
  picpay: '/logos/picpay-ui.webp',
  'mercado-pago': '/logos/mercado-pago-ui.webp',
  pix: '/logos/pix.png',
};

export function ExpenseLedger({
  userId,
  initialEntries,
  initialCards,
  initialPending,
  initialError,
  cycles,
}: {
  userId: string;
  initialEntries: FinancialEntry[];
  initialCards: PaymentCard[];
  /** Compras a chegar, já calculadas no servidor. */
  initialPending: UnidentifiedSpend[];
  initialError: string;
  /** Os ciclos de crédito, para pôr cada parcela no mês de gasto da fatura. */
  cycles: CardCycle[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState(initialEntries);
  const [cards, setCards] = useState(initialCards);
  const [pending, setPending] = useState(initialPending);
  const [error, setError] = useState(initialError);
  const [entryOpen, setEntryOpen] = useState(false);
  const [selected, setSelected] = useState<FinancialEntry | null>(null);
  const [status, setStatus] = useState<Status>('all');
  // `null` = todos os meios de pagamento.
  const [method, setMethod] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const currentMonth = monthKey();
  const today = dayOfMonth(new Date());
  const now = new Date();

  const expenses = useMemo(
    () => entries.filter((entry) => entry.entry_type === 'expense'),
    [entries],
  );
  const sortedCards = useMemo(
    () =>
      sortPaymentCardsByUsage(
        cards,
        expenses.map((entry) => entry.account),
      ),
    [cards, expenses],
  );
  const arriving = useMemo(() => pendingEntries(pending), [pending]);

  // Parcela fica no mês de gasto da fatura (a data carimbada pelo banco na
  // parcela futura não diz nada).
  const entryMonth = useCallback(
    (entry: FinancialEntry) =>
      isInstallment(entry) && entry.invoice_due_override
        ? invoiceSpendingMonth(
            entry.invoice_due_override,
            cycles.find((cycle) => cycle.account === entry.account),
          )
        : monthKey(entry.occurred_at),
    [cycles],
  );

  // O mês até hoje, e o mês passado até o mesmo dia, para comparar.
  const spentIn = (month: string, untilDay?: number) =>
    expenses.filter(
      (entry) =>
        monthKey(entry.occurred_at) === month &&
        new Date(entry.occurred_at) <= now &&
        (untilDay === undefined || dayOfMonth(entry.occurred_at) <= untilDay) &&
        (!method || entry.account === method),
    );
  const thisMonth = spentIn(currentMonth).filter(
    (entry) => !entry.excluded_from_totals,
  );
  const monthTotal = sum(thisMonth);
  const lastMonth = previousMonth(currentMonth);
  const lastTotal = sum(spentIn(lastMonth, today));
  const change = lastTotal.gt(0)
    ? monthTotal.minus(lastTotal).div(lastTotal).times(100).round().toNumber()
    : null;
  const biggest = thisMonth.reduce<FinancialEntry | null>(
    (best, entry) =>
      !best || countedAmount(entry).gt(countedAmount(best)) ? entry : best,
    null,
  );

  // Meios de pagamento do mês, do maior ao menor (inclui Pix e o que não é
  // cartão cadastrado). Não depende do filtro de meio.
  const byMethod = (() => {
    const totals = new Map<string, Decimal>();
    for (const entry of expenses)
      if (
        !entry.excluded_from_totals &&
        monthKey(entry.occurred_at) === currentMonth &&
        new Date(entry.occurred_at) <= new Date()
      )
        totals.set(
          entry.account,
          (totals.get(entry.account) ?? new Decimal(0)).plus(
            countedAmount(entry),
          ),
        );
    return [...totals].sort((a, b) => b[1].comparedTo(a[1]));
  })();
  const methodsTotal = byMethod.reduce(
    (total, [, value]) => total.plus(value),
    new Decimal(0),
  );
  // O filtro pode sobreviver ao meio; cai para todos.
  const activeMethod =
    method && byMethod.some(([account]) => account === method) ? method : null;

  const byStatus: Record<Status, FinancialEntry[]> = {
    all: expenses,
    pending: arriving,
    installments: expenses.filter(isInstallment),
    split: expenses.filter(isSplit),
    excluded: expenses.filter((entry) => entry.excluded_from_totals),
  };

  const needle = fold(query.trim());
  const visible = byStatus[status]
    .filter((entry) => !activeMethod || entry.account === activeMethod)
    .filter(
      (entry) =>
        !needle ||
        fold(
          `${entry.description} ${entry.category} ${entry.account}`,
        ).includes(needle),
    )
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  const months = new Map<string, FinancialEntry[]>();
  for (const entry of visible) {
    const month = entryMonth(entry);
    months.set(month, [...(months.get(month) ?? []), entry]);
  }
  const byMonth = [...months].sort((a, b) => b[0].localeCompare(a[0]));

  const reload = useCallback(async () => {
    const [entryResult, cardResult, arrivingNow] = await Promise.all([
      loadFinancialEntries(supabase, { includeExcluded: true }),
      supabase.from('payment_cards').select('*').order('account'),
      loadUnidentifiedSpend(supabase).catch(() => null),
    ]);
    if (entryResult.error || cardResult.error)
      throw entryResult.error ?? cardResult.error;
    setEntries((entryResult.data ?? []) as FinancialEntry[]);
    setCards((cardResult.data ?? []) as PaymentCard[]);
    if (arrivingNow) setPending(arrivingNow);
  }, [supabase]);

  const refresh = useCallback(
    () =>
      reload()
        .then(() => setError(''))
        .catch(() => setError('Não foi possível atualizar. Tente novamente.')),
    [reload],
  );
  useResumeRefresh(refresh);

  // Confirmação no EntryDetails; a falha sobe para o diálogo mostrar.
  async function deleteEntry(id: string) {
    const result = await supabase
      .from('financial_entries')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (result.error) throw new Error(result.error.message);
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setSelected(null);
  }

  const filtered = status !== 'all' || !!activeMethod || !!needle;

  return (
    <main className="min-h-dvh bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AppHeader onRefresh={refresh} />
      <div className="app-container pt-3">
        <NavigationBackButton />
      </div>

      <div className="app-container py-6 md:py-9">
        <div className="mx-auto max-w-3xl lg:max-w-none">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[.16em] text-muted-foreground">
                Extrato
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
                Seus gastos
              </h1>
            </div>
            <Button variant="glass" onClick={() => setEntryOpen(true)}>
              <Plus />
              Novo
            </Button>
          </div>

          {error && (
            <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
              {error}
            </p>
          )}

          {/* Celular: uma coluna. Computador: resumo, busca, filtros e revisão
              à esquerda; a lista à direita. */}
          <div className="lg:mt-6 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-x-8 lg:gap-y-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
            {/* O mês em destaque. */}
            <section className="mt-6 rounded-3xl border bg-card p-5 md:p-6 lg:col-start-1 lg:row-start-1 lg:mt-0">
              <p className="text-xs text-muted-foreground first-letter:uppercase">
                {monthName(currentMonth)}
                {activeMethod ? ` · ${activeMethod}` : ''}
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-4xl font-semibold tracking-tight tabular-nums">
                  <Private>{money(monthTotal)}</Private>
                </p>
                {change !== null && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-0.5 text-xs font-medium',
                      change > 0
                        ? 'text-destructive'
                        : 'text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    {change > 0 ? (
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ArrowDownRight className="size-3.5" aria-hidden="true" />
                    )}
                    {Math.abs(change)}% vs. {shortMonth(lastMonth)} até o dia{' '}
                    {today}
                  </span>
                )}
              </div>

              {/* A divisão por meio de pagamento, na cor de cada um. */}
              {methodsTotal.gt(0) && (
                <div
                  aria-hidden="true"
                  className="mt-5 flex h-2 gap-0.5 overflow-hidden rounded-full"
                >
                  {byMethod.map(([account, value]) => (
                    <span
                      key={account}
                      className={cn(
                        'h-full rounded-full transition-opacity',
                        activeMethod &&
                          activeMethod !== account &&
                          'opacity-25',
                      )}
                      style={{
                        width: `${value.div(methodsTotal).times(100).toNumber()}%`,
                        backgroundColor:
                          PAYMENT_METHOD_COLOUR[
                            resolvePaymentMethod(account, sortedCards)
                          ],
                      }}
                    />
                  ))}
                </div>
              )}

              <dl className="mt-5 grid grid-cols-3 gap-3 border-t pt-4">
                <Stat label="Compras">{thisMonth.length}</Stat>
                <Stat label="Média">
                  <Private>
                    {money(
                      thisMonth.length
                        ? monthTotal.div(thisMonth.length)
                        : new Decimal(0),
                    )}
                  </Private>
                </Stat>
                <Stat label="Maior" hint={biggest?.description}>
                  <Private>
                    {money(biggest ? countedAmount(biggest) : new Decimal(0))}
                  </Private>
                </Stat>
              </dl>
            </section>

            {/* Busca e filtros. */}
            <div className="mt-6 flex flex-col gap-4 lg:col-start-1 lg:row-start-2 lg:mt-0">
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar gastos"
                  aria-label="Buscar gastos"
                  className="h-11 rounded-2xl pr-10 pl-10"
                />
                {query && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setQuery('')}
                    aria-label="Limpar busca"
                    className="absolute top-1/2 right-1.5 -translate-y-1/2"
                  >
                    <X />
                  </Button>
                )}
              </div>

              {/* Situação em ícones; o ligado abre o nome. */}
              <fieldset className="m-0 flex min-w-0 items-center gap-1 rounded-full border-0 bg-muted/70 p-1">
                <legend className="sr-only">Situação</legend>
                {STATUSES.map(({ value, label, icon: Icon }) => {
                  const active = status === value;
                  const count = value === 'all' ? 0 : byStatus[value].length;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      aria-label={count ? `${label}, ${count}` : label}
                      title={label}
                      onClick={() => setStatus(value)}
                      className={cn(
                        'flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-[flex-grow,background-color,color] duration-300 focus-visible:outline-2 focus-visible:-outline-offset-2',
                        active
                          ? 'flex-none bg-foreground px-3 font-semibold text-background shadow-sm'
                          : 'flex-1 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <span className="relative shrink-0">
                        <Icon className="size-4" aria-hidden="true" />
                        {count > 0 && !active && (
                          <span
                            aria-hidden="true"
                            className="absolute -top-2 left-2.5 min-w-4 rounded-full bg-foreground/15 px-1 text-center text-[10px] leading-4 tabular-nums text-foreground"
                          >
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </span>
                      {active && (
                        <span aria-hidden="true" className="truncate">
                          {label}
                          {count > 0 && (
                            <span className="ml-1 tabular-nums opacity-60">
                              {count}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </fieldset>

              {/* Cartões em lista: logo e nome; o escolhido com ✓. */}
              {byMethod.length > 1 && (
                <fieldset className="m-0 min-w-0 rounded-3xl border bg-card p-1">
                  <legend className="sr-only">Cartão</legend>
                  <CardRow
                    active={!activeMethod}
                    onClick={() => setMethod(null)}
                    mark={
                      <span
                        aria-hidden="true"
                        className="grid size-6 shrink-0 place-items-center rounded-full bg-muted"
                      >
                        <CreditCard className="size-3.5" />
                      </span>
                    }
                  >
                    Todos os cartões
                  </CardRow>
                  {byMethod.map(([account]) => (
                    <CardRow
                      key={account}
                      active={activeMethod === account}
                      // Tocar no escolhido volta para todos.
                      onClick={() =>
                        setMethod(activeMethod === account ? null : account)
                      }
                      mark={
                        <BankMark
                          bankId={resolvePaymentMethod(account, sortedCards)}
                          name={account}
                        />
                      }
                    >
                      {account}
                    </CardRow>
                  ))}
                </fieldset>
              )}
            </div>

            {/* A lista. */}
            <div className="lg:col-start-2 lg:row-span-3 lg:row-start-1">
              {status === 'pending' && (
                <p className="mt-5 rounded-2xl bg-muted/50 p-4 lg:mt-0 lg:mb-6 text-xs leading-relaxed text-muted-foreground">
                  O limite do cartão já caiu e a compra ainda não chegou do
                  banco. Toque numa delas para dividir ou corrigir a data. Elas
                  entram no extrato quando chegam.
                </p>
              )}

              {/* Os gastos, por mês e dia. */}
              <div className="mt-6 space-y-6 lg:mt-0">
                {byMonth.map(([month, items]) => {
                  const counted = items.filter(
                    (entry) => !entry.excluded_from_totals,
                  );
                  const daily = items.filter((entry) => !isInstallment(entry));
                  const installments = items.filter(isInstallment);
                  return (
                    <section key={month} aria-label={monthName(month)}>
                      <div className="flex items-baseline justify-between gap-3 px-1">
                        <h2 className="text-sm font-semibold first-letter:uppercase">
                          {monthName(month)}
                        </h2>
                        <p className="shrink-0 text-xs text-muted-foreground">
                          <Private>
                            <span className="font-semibold tabular-nums text-foreground">
                              {money(sum(counted))}
                            </span>
                          </Private>{' '}
                          · {items.length}{' '}
                          {items.length === 1 ? 'gasto' : 'gastos'}
                        </p>
                      </div>
                      <div className="mt-2 rounded-3xl border bg-card px-3 pb-2 md:px-4">
                        {daily.length > 0 && (
                          <ExpenseDayList
                            entries={daily}
                            cards={sortedCards}
                            onOpen={setSelected}
                          />
                        )}
                        {/* Parcelas no fim do mês. */}
                        {installments.length > 0 && (
                          <>
                            <p className="px-2 pt-3 pb-0.5 text-[11px] font-medium uppercase tracking-[.1em] text-muted-foreground">
                              Parcelas
                            </p>
                            <ExpenseDayList
                              entries={installments}
                              cards={sortedCards}
                              onOpen={setSelected}
                              days={false}
                            />
                          </>
                        )}
                      </div>
                    </section>
                  );
                })}
                {!byMonth.length && (
                  <div className="rounded-3xl border border-dashed p-8 text-center">
                    <p className="text-sm font-medium">
                      {needle
                        ? 'Nada encontrado'
                        : status === 'pending'
                          ? 'Nenhuma compra pendente'
                          : 'Nenhum gasto aqui'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {status === 'pending' && !needle
                        ? 'Tudo o que você gastou já chegou do banco.'
                        : 'Tente outro filtro ou outra busca.'}
                    </p>
                    {filtered && (
                      <Button
                        variant="glass-quiet"
                        size="sm"
                        className="mt-4"
                        onClick={() => {
                          setStatus('all');
                          setMethod(null);
                          setQuery('');
                        }}
                      >
                        Limpar filtros
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Duplicatas e recorrências, para revisar. */}
            <div className="mt-10 space-y-4 lg:col-start-1 lg:row-start-3 lg:mt-0">
              <h2 className="px-1 text-[11px] font-medium uppercase tracking-[.16em] text-muted-foreground">
                Revisar
              </h2>
              <ExpenseAssistant
                weekly={false}
                userId={userId}
                entries={expenses}
                cards={sortedCards}
                onChanged={reload}
              />
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <EntryDetails
          key={selected.id}
          onDelete={deleteEntry}
          entry={selected}
          cards={sortedCards}
          onClose={() => setSelected(null)}
          onRuleApplied={reload}
          onSaved={(updated) =>
            setEntries((previous) =>
              previous.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
            )
          }
        />
      )}
      {entryOpen && (
        <ExpenseEntryDialog
          cards={sortedCards}
          onClose={() => setEntryOpen(false)}
          onSaved={(entry) => setEntries((previous) => [entry, ...previous])}
        />
      )}
    </main>
  );
}

/** Linha da lista de cartões: a escolhida em destaque, com ✓. */
function CardRow({
  active,
  onClick,
  mark,
  children,
}: {
  active: boolean;
  onClick: () => void;
  mark: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-11 w-full min-w-0 items-center gap-3 rounded-2xl px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2',
        active
          ? 'bg-muted font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {mark}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <Check aria-hidden="true" className="size-4 shrink-0" />}
    </button>
  );
}

/** Logo do banco num círculo; sem logo, a inicial na cor da marca. */
function BankMark({ bankId, name }: { bankId: PaymentMethodId; name: string }) {
  const logo = BANK_LOGO[bankId];
  return logo ? (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-background"
    >
      <Image
        src={logo}
        alt=""
        width={14}
        height={14}
        className="size-3.5 object-contain"
      />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
      style={{ backgroundColor: PAYMENT_METHOD_COLOUR[bankId] }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function Stat({
  label,
  hint,
  children,
}: {
  label: string;
  /** Linha de apoio (o nome do maior gasto). */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums">
        {children}
      </dd>
      {hint && (
        <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>
      )}
    </div>
  );
}
