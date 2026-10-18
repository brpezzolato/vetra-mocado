'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Private } from '@/components/private-value';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { buildCreditCardInvoices, type CardInvoice } from '@/lib/card-invoices';
import type { CardInvoiceInputs } from '@/lib/card-invoices-query';
import { calculatePortfolio } from '@/lib/portfolio';
import { useVaultData } from '@/lib/use-vault-data';

// Cofrinho × faturas: o saldo de um cofrinho (ou de todos) contra o que falta
// pagar nas faturas dos cartões. As faturas são as mesmas de /faturas.

const ALL = 'all';

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

  const portfolio = useMemo(
    () => calculatePortfolio(banks, rates),
    [banks, rates],
  );
  const vault = portfolio.results.find(({ bank }) => bank.id === vaultId);
  const saved = vault ? vault.result.netBalance : portfolio.netBalance;

  // Por cartão: a fatura atual e, se pedido, as seguintes ainda em aberto.
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

  // "Fora das contas" (compras de outra pessoa no cartão, por exemplo): o
  // banco cobra, mas não sai do cofrinho; estorno marcado assim devolve.
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
  const counted = rows.flatMap((row) =>
    withNext ? [row.current, ...row.next] : [row.current],
  );
  const invoicesTotal = counted.reduce(
    (sum, invoice) => sum.plus(owed(invoice)),
    new Decimal(0),
  );
  const excludedTotal = counted.reduce(
    (sum, invoice) =>
      sum.plus(
        Decimal.min(excludedOf(invoice), new Decimal(invoice.balance)).clamp(
          0,
          Infinity,
        ),
      ),
    new Decimal(0),
  );
  const result = saved.minus(invoicesTotal);
  const covers = result.gte(0);
  const scale = Decimal.max(saved, invoicesTotal);
  const share = (value: Decimal) =>
    scale.gt(0) ? `${value.div(scale).times(100).toFixed(2)}%` : '0%';
  const vaultName = vault ? vault.bank.name : 'Todos os cofrinhos';

  return (
    <main className="min-h-dvh overflow-x-clip bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AppHeader onRefresh={() => router.refresh()} />
      <div className="app-container min-w-0 max-w-3xl py-6 md:py-9">
        <NavigationBackButton className="mb-5" />
        {initialError && (
          <p className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            Não foi possível carregar todas as faturas.
          </p>
        )}

        <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
          Cofrinho × faturas
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          O cofrinho paga as faturas?
        </h1>

        <div className="mt-6 grid gap-4 rounded-3xl border bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor="coverage-vault">Cofrinho</Label>
            <Select
              value={vaultId}
              onValueChange={(value) => value && setVaultId(value)}
            >
              <SelectTrigger id="coverage-vault" className="w-full">
                <SelectValue placeholder="Todos os cofrinhos">
                  {vaultName}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="w-auto min-w-(--anchor-width)">
                <SelectItem value={ALL}>Todos os cofrinhos</SelectItem>
                {portfolio.results.map(({ bank }) => (
                  <SelectItem key={bank.id} value={bank.id}>
                    {bank.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-h-9 items-center gap-3">
            <Switch
              id="coverage-next"
              checked={withNext}
              onCheckedChange={setWithNext}
            />
            <Label htmlFor="coverage-next" className="font-normal">
              Somar as próximas faturas
            </Label>
          </div>
        </div>

        {loading ? (
          <div className="mt-6 grid gap-3">
            <Skeleton className="h-36 rounded-3xl" />
            <Skeleton className="h-48 rounded-3xl" />
          </div>
        ) : (
          <>
            <section
              className={`mt-6 rounded-3xl border p-5 ${
                covers
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-destructive/30 bg-destructive/10'
              }`}
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                {covers ? (
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <TriangleAlert className="size-4 text-destructive" />
                )}
                {covers
                  ? 'Cobre as faturas e ainda sobra'
                  : 'Não cobre: faltam'}
              </p>
              <p
                className={`mt-2 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl ${
                  covers
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-destructive'
                }`}
              >
                <Private>{money(result.abs())}</Private>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                <Private>{money(saved)}</Private> em{' '}
                {vault ? vault.bank.name : 'todos os cofrinhos'} −{' '}
                <Private>{money(invoicesTotal)}</Private> de{' '}
                {withNext ? 'faturas (atuais e próximas)' : 'faturas atuais'}
                {excludedTotal.gt(0) && (
                  <>
                    , já sem <Private>{money(excludedTotal)}</Private> de
                    compras fora das contas
                  </>
                )}
              </p>

              <div className="mt-5 grid gap-3">
                {[
                  {
                    label: vaultName,
                    value: saved,
                    colour: 'bg-emerald-500',
                  },
                  {
                    label: 'Faturas',
                    value: invoicesTotal,
                    colour: 'bg-foreground/70',
                  },
                ].map((bar) => (
                  <div key={bar.label} className="grid gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="truncate text-muted-foreground">
                        {bar.label}
                      </span>
                      <span className="font-medium tabular-nums">
                        <Private>{money(bar.value)}</Private>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-foreground/10">
                      <div
                        className={`h-full rounded-full ${bar.colour} transition-[width] duration-300`}
                        style={{ width: share(bar.value) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-6">
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                Faturas somadas
              </h2>
              {rows.length ? (
                <ul className="divide-y rounded-3xl border bg-card">
                  {rows.map(({ card, current, next }) => (
                    <li key={card.account} className="grid gap-2 p-4">
                      <div className="flex items-center gap-3">
                        <PaymentCardIcon bankId={card.bank_id} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {card.account}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {current.settled
                              ? 'Paga'
                              : `Vence ${dayMonth(current.due)}`}
                          </span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums">
                          <Private>{money(owed(current))}</Private>
                        </span>
                      </div>
                      {withNext &&
                        next.map((invoice) => (
                          <div
                            key={invoice.due}
                            className="flex items-center justify-between gap-3 pl-[3.25rem] text-xs text-muted-foreground"
                          >
                            <span>Próxima · vence {dayMonth(invoice.due)}</span>
                            <span className="tabular-nums">
                              <Private>{money(owed(invoice))}</Private>
                            </span>
                          </div>
                        ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground">
                  Nenhum cartão de crédito com fatura.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
