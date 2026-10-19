'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { CheckCircle2, Plus, TriangleAlert } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { buildCreditCardInvoices, type CardInvoice } from '@/lib/card-invoices';
import type { CardInvoiceInputs } from '@/lib/card-invoices-query';
import { calculatePortfolio } from '@/lib/portfolio';
import { useVaultData } from '@/lib/use-vault-data';
import { cn } from '@/lib/utils';

// Cofrinho × faturas: o saldo de um cofrinho (ou de todos), mais um aporte
// que o Bruno informa, contra o que falta pagar nas faturas dos cartões. As
// faturas são as mesmas de /faturas, já sem as compras "fora das contas".

const ALL = 'all';
const QUICK = [100, 500, 1000];

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value).toNumber());
const dayMonth = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replace('.', '');
const vaultLogo = (bank: string) =>
  bank === 'Nubank' ? '/logos/nubank-ui.webp' : '/logos/mercado-pago-ui.webp';

// "Fora das contas" (compra de outra pessoa no cartão, por exemplo): o banco
// cobra, mas não sai do cofrinho; estorno marcado assim devolve.
const excludedOf = (invoice: CardInvoice) =>
  invoice.entries
    .filter((entry) => entry.excluded_from_totals)
    .reduce(
      (sum, entry) =>
        entry.entry_type === 'income'
          ? sum.minus(entry.amount)
          : sum.plus(entry.amount),
      new Decimal(0),
    );
const owed = (invoice: CardInvoice) =>
  Decimal.max(new Decimal(invoice.balance).minus(excludedOf(invoice)), 0);

export function VaultCoverage({
  inputs,
  initialError,
}: {
  inputs: CardInvoiceInputs | null;
  initialError: string;
}) {
  const router = useRouter();
  const { banks, rates, loading } = useVaultData();
  const [vaultId, setVaultId] = useState(ALL);
  const [withNext, setWithNext] = useState(false);
  const [deposit, setDeposit] = useState(new Decimal(0));

  const portfolio = useMemo(
    () => calculatePortfolio(banks, rates),
    [banks, rates],
  );
  const vault = portfolio.results.find(({ bank }) => bank.id === vaultId);
  const saved = vault ? vault.result.netBalance : portfolio.netBalance;
  const vaultName = vault ? vault.bank.name : 'Todos os cofrinhos';

  // Por cartão: a fatura atual e as seguintes ainda em aberto.
  const rows = useMemo(() => {
    if (!inputs) return [];
    return buildCreditCardInvoices(
      inputs.entries,
      inputs.cards,
      inputs.cycles,
      undefined,
      inputs.payments,
      inputs.bills,
      inputs.limits,
    ).map(({ card, current, invoices }) => ({
      card,
      current,
      next: invoices
        .filter(
          (invoice) =>
            invoice.due > current.due && new Decimal(invoice.balance).gt(0),
        )
        .sort((a, b) => a.due.localeCompare(b.due)),
    }));
  }, [inputs]);

  const counted = rows.flatMap((row) =>
    withNext ? [row.current, ...row.next] : [row.current],
  );
  const invoicesTotal = counted.reduce(
    (sum, invoice) => sum.plus(owed(invoice)),
    new Decimal(0),
  );
  const excludedTotal = counted.reduce(
    (sum, invoice) =>
      sum.plus(Decimal.max(invoice.balance, 0).minus(owed(invoice))),
    new Decimal(0),
  );
  const before = saved.minus(invoicesTotal);
  const available = saved.plus(deposit);
  const result = available.minus(invoicesTotal);
  const covers = result.gte(0);
  const coverage = invoicesTotal.gt(0)
    ? Decimal.min(available.div(invoicesTotal), 1)
    : new Decimal(1);
  const missing = Decimal.max(before.negated(), 0);

  const [typed, setTyped] = useState('');
  const setAmount = (value: Decimal) => {
    setDeposit(value);
    setTyped(value.gt(0) ? money(value) : '');
  };
  const onType = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 12);
    const next = digits ? new Decimal(digits).div(100) : new Decimal(0);
    setDeposit(next);
    setTyped(digits ? money(next) : '');
  };

  const chips = [
    { id: ALL, label: 'Todos', logo: null as string | null },
    ...portfolio.results.map(({ bank }) => ({
      id: bank.id,
      label: bank.name,
      logo: vaultLogo(bank.bank),
    })),
  ];

  return (
    <main className="min-h-dvh overflow-x-clip bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AppHeader onRefresh={() => router.refresh()} />
      <div className="app-container min-w-0 max-w-5xl py-6 md:py-9">
        <NavigationBackButton className="mb-5" />
        {initialError && (
          <p className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            Não foi possível carregar todas as faturas.
          </p>
        )}

        <div className="mb-6">
          <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
            Cofrinho × faturas
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
            Dá para pagar as faturas?
          </h1>
        </div>

        {/* Cofrinho escolhido (chips com vidro, como em Faturas). */}
        <ScrollArea orientation="horizontal" className="-mx-1 mb-6">
          <div className="flex gap-2 px-1 py-1">
            {chips.map((chip) => (
              <Button
                key={chip.id}
                type="button"
                size="sm"
                variant={vaultId === chip.id ? 'glass' : 'glass-quiet'}
                aria-pressed={vaultId === chip.id}
                className="h-9 shrink-0 gap-2 rounded-full px-4"
                onClick={() => setVaultId(chip.id)}
              >
                {chip.logo && (
                  <Image
                    src={chip.logo}
                    alt=""
                    aria-hidden="true"
                    width={32}
                    height={32}
                    unoptimized
                    className="size-4 rounded-full object-contain"
                  />
                )}
                {chip.label}
              </Button>
            ))}
          </div>
        </ScrollArea>

        {loading ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <Skeleton className="h-80 rounded-3xl" />
            <Skeleton className="h-80 rounded-3xl" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
            <div className="grid min-w-0 gap-4">
              {/* Resultado. */}
              <section
                className={cn(
                  'rounded-3xl border p-5 md:p-6',
                  covers
                    ? 'border-emerald-500/25 bg-emerald-500/[.07]'
                    : 'border-destructive/25 bg-destructive/[.07]',
                )}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  {covers ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <TriangleAlert className="size-4 text-destructive" />
                  )}
                  {covers ? 'Vai sobrar' : 'Ainda faltam'}
                </p>
                <p
                  className={cn(
                    'mt-1 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl',
                    covers
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-destructive',
                  )}
                >
                  <Private>{money(result.abs())}</Private>
                </p>

                {/* Quanto das faturas o dinheiro cobre. */}
                <div className="mt-5">
                  <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                    <span>Cobertura das faturas</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {coverage.times(100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-foreground/10">
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-300',
                        covers ? 'bg-emerald-500' : 'bg-destructive',
                      )}
                      style={{ width: `${coverage.times(100).toFixed(2)}%` }}
                    />
                  </div>
                </div>

                {/* A conta, linha a linha. */}
                <dl className="mt-5 grid gap-2 border-t pt-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="min-w-0 truncate text-muted-foreground">
                      {vaultName}
                    </dt>
                    <dd className="shrink-0 tabular-nums">
                      <Private>{money(saved)}</Private>
                    </dd>
                  </div>
                  {deposit.gt(0) && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Aporte</dt>
                      <dd className="shrink-0 tabular-nums text-emerald-700 dark:text-emerald-300">
                        + <Private>{money(deposit)}</Private>
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {withNext
                        ? 'Faturas atuais e próximas'
                        : 'Faturas atuais'}
                    </dt>
                    <dd className="shrink-0 tabular-nums">
                      − <Private>{money(invoicesTotal)}</Private>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t pt-2 font-medium">
                    <dt>{covers ? 'Sobra' : 'Falta'}</dt>
                    <dd className="shrink-0 tabular-nums">
                      <Private>{money(result.abs())}</Private>
                    </dd>
                  </div>
                </dl>
                {excludedTotal.gt(0) && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    As faturas já estão sem{' '}
                    <Private>{money(excludedTotal)}</Private> de compras fora
                    das contas.
                  </p>
                )}
              </section>

              {/* Calculadora do aporte. */}
              <section className="rounded-3xl border bg-card p-5 md:p-6">
                <h2 className="font-semibold">Simular um aporte</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quanto você vai colocar no cofrinho antes de pagar.
                </p>
                <div className="mt-4 grid gap-2">
                  <Label htmlFor="coverage-deposit" className="sr-only">
                    Valor do aporte
                  </Label>
                  <Input
                    id="coverage-deposit"
                    inputMode="numeric"
                    value={typed}
                    onChange={(event) => onType(event.target.value)}
                    placeholder="R$ 0,00"
                    className="h-12 text-lg tabular-nums"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUICK.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant="glass-quiet"
                      className="h-8 gap-1 rounded-full px-3"
                      onClick={() => setAmount(deposit.plus(value))}
                    >
                      <Plus className="size-3" />
                      {money(value).replace(',00', '')}
                    </Button>
                  ))}
                  {missing.gt(0) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="glass-quiet"
                      className="h-8 rounded-full px-3"
                      onClick={() => setAmount(missing)}
                    >
                      Só o que falta
                    </Button>
                  )}
                  {deposit.gt(0) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-full px-3 text-muted-foreground"
                      onClick={() => setAmount(new Decimal(0))}
                    >
                      Limpar
                    </Button>
                  )}
                </div>
                {deposit.gt(0) && (
                  <p className="mt-4 rounded-2xl bg-muted/60 p-3 text-sm">
                    Com <Private>{money(deposit)}</Private> a mais,{' '}
                    {covers ? (
                      <>
                        sobram <Private>{money(result)}</Private> depois de
                        pagar tudo.
                      </>
                    ) : (
                      <>
                        ainda faltam <Private>{money(result.abs())}</Private>.
                      </>
                    )}
                  </p>
                )}
              </section>
            </div>

            {/* Faturas que entram na conta. */}
            <section className="min-w-0 rounded-3xl border bg-card p-5 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Faturas</h2>
                <span className="text-sm font-medium tabular-nums">
                  <Private>{money(invoicesTotal)}</Private>
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-muted/60 px-3 py-2.5">
                <Label htmlFor="coverage-next" className="text-sm font-normal">
                  Somar as próximas faturas
                </Label>
                <Switch
                  id="coverage-next"
                  checked={withNext}
                  onCheckedChange={setWithNext}
                />
              </div>
              {rows.length ? (
                <ul className="mt-2 divide-y">
                  {rows.map(({ card, current, next }) => {
                    const cardTotal = (
                      withNext ? [current, ...next] : [current]
                    ).reduce(
                      (sum, item) => sum.plus(owed(item)),
                      new Decimal(0),
                    );
                    const part = invoicesTotal.gt(0)
                      ? cardTotal.div(invoicesTotal).times(100)
                      : new Decimal(0);
                    return (
                      <li
                        key={card.account}
                        className="grid min-w-0 gap-2 py-4"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="shrink-0">
                            <PaymentCardIcon bankId={card.bank_id} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium leading-snug break-words">
                              {card.account}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {current.settled
                                ? 'Paga'
                                : `Vence ${dayMonth(current.due)}`}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            <Private>{money(owed(current))}</Private>
                          </span>
                        </div>
                        {withNext &&
                          next.map((invoice) => (
                            <div
                              key={invoice.due}
                              className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                            >
                              <span>
                                Próxima · vence {dayMonth(invoice.due)}
                              </span>
                              <span className="shrink-0 tabular-nums">
                                <Private>{money(owed(invoice))}</Private>
                              </span>
                            </div>
                          ))}
                        <div
                          className="h-1 rounded-full bg-foreground/10"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full bg-foreground/50"
                            style={{ width: `${part.toFixed(2)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Nenhum cartão de crédito com fatura.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
