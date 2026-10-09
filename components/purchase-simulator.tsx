'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import {
  CalendarClock,
  Calculator,
  CreditCard,
  Gauge,
  ReceiptText,
  Repeat2,
  Scale,
} from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { DateInput } from '@/components/date-input';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  saoDate,
  type CardCycle,
  type RecurringExpense,
} from '@/lib/expense-insights';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { sortPaymentCardsByUsage, type PaymentCard } from '@/lib/payment-cards';
import { simulatePurchaseInvoices } from '@/lib/purchase-simulator';
import {
  compareInstallmentsWithCash,
  type PaymentOption,
} from '@/lib/installment-vs-cash';
import { useVaultData } from '@/lib/use-vault-data';
import type { PiggyBank } from '@/lib/domain';
import { Private } from '@/components/private-value';

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value).toNumber(),
  );
const monthLabel = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replace('.', '');

export function PurchaseSimulator({
  entries,
  cards,
  cycles,
  subscriptions,
  initialError,
}: {
  entries: FinancialEntry[];
  cards: PaymentCard[];
  cycles: CardCycle[];
  subscriptions: RecurringExpense[];
  initialError: string;
}) {
  const router = useRouter();
  const orderedCards = useMemo(
    () =>
      sortPaymentCardsByUsage(
        cards,
        entries.map((item) => item.account),
      ).filter((card) =>
        cycles.some((cycle) => cycle.account === card.account),
      ),
    [cards, cycles, entries],
  );
  const [amount, setAmount] = useState('');
  const [budget, setBudget] = useState('');
  const [installments, setInstallments] = useState('1');
  const [account, setAccount] = useState(orderedCards[0]?.account ?? '');
  const [purchaseDate, setPurchaseDate] = useState(saoDate(new Date()));
  useEffect(() => {
    const saved = window.localStorage.getItem('vetra:monthly-budget') ?? '';
    queueMicrotask(() => setBudget(saved ? money(saved) : ''));
  }, []);
  const numericAmount = new Decimal(amount.replace(/\D/g, '') || 0).div(100);
  const numericBudget = new Decimal(budget.replace(/\D/g, '') || 0).div(100);
  const cycle = cycles.find((item) => item.account === account);
  const projections =
    cycle && numericAmount.gt(0)
      ? simulatePurchaseInvoices({
          total: numericAmount,
          installments: Math.max(1, Math.min(36, Number(installments) || 1)),
          purchaseDate,
          cycle,
        })
      : [];
  const month = purchaseDate.slice(0, 7);
  const spentThisMonth = entries
    .filter(
      (item) =>
        item.entry_type === 'expense' &&
        saoDate(item.occurred_at).startsWith(month),
    )
    .reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
  const monthlySubscriptions = subscriptions.reduce(
    (sum, item) =>
      sum.plus(
        item.frequency === 'yearly'
          ? new Decimal(item.amount).div(12)
          : item.amount,
      ),
    new Decimal(0),
  );
  const firstInstallment = projections[0]
    ? new Decimal(projections[0].amount)
    : new Decimal(0);
  const estimatedMonth = spentThisMonth
    .plus(monthlySubscriptions)
    .plus(firstInstallment);
  const budgetRemaining = numericBudget.gt(0)
    ? numericBudget.minus(estimatedMonth)
    : null;

  const maskMoney = (value: string, setter: (value: string) => void) => {
    const digits = value.replace(/\D/g, '').slice(0, 16);
    const next = digits ? money(new Decimal(digits).div(100)) : '';
    setter(next);
    return digits ? new Decimal(digits).div(100).toFixed(2) : '';
  };

  return (
    <main className="min-h-dvh bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AppHeader onRefresh={() => router.refresh()} />
      <div className="app-container space-y-6 py-7 md:py-10">
        <NavigationBackButton />
        <section>
          <p className="text-xs uppercase tracking-[.18em] text-muted-foreground">
            Antes de comprar
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            Simulador de compra
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Veja como uma compra pesa no mês e em quais faturas cada parcela
            cairia. Nada é salvo.
          </p>
        </section>
        {initialError && (
          <p
            role="alert"
            className="rounded-2xl border border-destructive p-4 text-sm text-destructive"
          >
            Não foi possível carregar todos os dados do simulador.
          </p>
        )}
        <section className="grid gap-6 lg:grid-cols-[minmax(0,.8fr)_minmax(22rem,1.2fr)]">
          <div className="rounded-3xl border bg-card p-5 shadow-sm md:p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-muted">
                <Calculator className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold">Cenário</h2>
                <p className="text-xs text-muted-foreground">
                  Ajuste os valores para comparar
                </p>
              </div>
            </div>
            <div className="grid gap-5">
              <label htmlFor="simulation-amount" className="grid gap-2 text-sm">
                Valor da compra
                <Input
                  id="simulation-amount"
                  inputMode="numeric"
                  value={amount}
                  onChange={(event) => maskMoney(event.target.value, setAmount)}
                  placeholder="R$ 0,00"
                />
              </label>
              <label htmlFor="simulation-card" className="grid gap-2 text-sm">
                Cartão
                <Select
                  value={account}
                  onValueChange={(value) => value && setAccount(value)}
                >
                  <SelectTrigger
                    id="simulation-card"
                    className="w-full overflow-hidden"
                  >
                    <SelectValue placeholder="Escolha um cartão" />
                  </SelectTrigger>
                  <SelectContent>
                    {orderedCards.map((card) => (
                      <SelectItem key={card.account} value={card.account}>
                        <PaymentCardIcon bankId={card.bank_id} />
                        <span className="truncate">{card.account}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="grid gap-5 sm:grid-cols-2">
                <label
                  htmlFor="simulation-installments"
                  className="grid gap-2 text-sm"
                >
                  Parcelas
                  <Input
                    id="simulation-installments"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={36}
                    value={installments}
                    onChange={(event) => setInstallments(event.target.value)}
                  />
                </label>
                <div className="grid gap-2 text-sm">
                  Data da compra
                  <DateInput
                    id="simulation-date"
                    value={purchaseDate}
                    onValueChange={setPurchaseDate}
                  />
                </div>
              </div>
              <label htmlFor="simulation-budget" className="grid gap-2 text-sm">
                Orçamento mensal (opcional)
                <Input
                  id="simulation-budget"
                  inputMode="numeric"
                  value={budget}
                  onChange={(event) => {
                    const raw = maskMoney(event.target.value, setBudget);
                    window.localStorage.setItem('vetra:monthly-budget', raw);
                  }}
                  placeholder="R$ 0,00"
                />
                <span className="text-xs text-muted-foreground">
                  Fica salvo somente neste aparelho para novas simulações.
                </span>
              </label>
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                icon={<ReceiptText />}
                label="Já gasto no mês"
                value={money(spentThisMonth)}
              />
              <Metric
                icon={<Repeat2 />}
                label="Assinaturas previstas"
                value={money(monthlySubscriptions)}
              />
              <Metric
                icon={<Gauge />}
                label="Estimativa após compra"
                value={money(estimatedMonth)}
                tone={budgetRemaining?.isNegative() ? 'danger' : undefined}
              />
            </div>
            {budgetRemaining && (
              <div
                className={`rounded-2xl border p-4 text-sm ${budgetRemaining.isNegative() ? 'border-red-500/30 bg-red-500/5 text-red-500' : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-500'}`}
              >
                <strong>
                  {budgetRemaining.isNegative()
                    ? 'Ultrapassa o orçamento em '
                    : 'Sobra no orçamento: '}
                  <Private>{money(budgetRemaining.abs())}</Private>
                </strong>
              </div>
            )}
            <section className="rounded-3xl border bg-card p-5 shadow-sm md:p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-2xl bg-muted">
                  <CreditCard className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">Impacto nas faturas</h2>
                  <p className="text-xs text-muted-foreground">
                    Fechamento e vencimento do cartão selecionado
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-2">
                {projections.map((item) => (
                  <div
                    key={item.installment}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border bg-background/40 p-4"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-muted text-xs font-semibold">
                      {item.installment}/{projections.length}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium capitalize">
                        Fatura de {monthLabel(item.due)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <CalendarClock className="mr-1 inline size-3" /> vence
                        em {item.due.split('-').reverse().join('/')}
                      </p>
                    </div>
                    <strong className="tabular-nums">
                      {money(item.amount)}
                    </strong>
                  </div>
                ))}
                {!projections.length && (
                  <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Informe o valor e escolha um cartão configurado para
                    visualizar as próximas faturas.
                  </div>
                )}
              </div>
            </section>
            {cycle && numericAmount.gt(0) && (
              <InstallmentComparison
                installments={projections}
                singleDue={
                  simulatePurchaseInvoices({
                    total: numericAmount,
                    installments: 1,
                    purchaseDate,
                    cycle,
                  })[0]!.due
                }
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p
        data-private-value
        className={`mt-3 text-lg font-semibold tabular-nums ${tone === 'danger' ? 'text-red-500' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

const OPTION_LABEL: Record<PaymentOption, string> = {
  installments: 'Parcelado no cartão',
  single: '1x no cartão',
  cash: 'À vista no Pix',
};

const dayMonth = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

/** Quanto já está num cofrinho: o que entrou menos o que saiu. Ocupa o limite
 * promocional antes da compra. */
const principalOf = (bank: PiggyBank) =>
  bank.transactions.reduce(
    (sum, item) =>
      item.kind === 'withdrawal'
        ? sum - Number(item.amount)
        : item.kind === 'deposit'
          ? sum + Number(item.amount)
          : sum,
    0,
  );

/** O detalhe de cada caminho, para ler embaixo do nome. Fora do JSX: é
 * construção de texto, e quem pinta o valor é o <Private> da linha. */
const yieldNote = (amount: string, until: string) =>
  `rende ${money(amount)} até ${dayMonth(until)}`;
const discountNote = (percent: number, amount: string) =>
  `${percent}% de desconto · ${money(amount)} a menos`;

/** Parcelar sem juros ou pagar à vista, com o dinheiro rendendo no cofrinho
 * escolhido enquanto espera. A conta está em lib/installment-vs-cash.ts. */
function InstallmentComparison({
  installments,
  singleDue,
}: {
  installments: { due: string; amount: string }[];
  singleDue: string;
}) {
  const { banks, rates, loading } = useVaultData();
  const [vaultId, setVaultId] = useState('');
  const [discount, setDiscount] = useState('');
  const vault = banks.find((bank) => bank.id === vaultId) ?? banks[0];
  const lastRate = rates.at(-1)?.rate;
  const discountPercent = Math.min(
    100,
    Math.max(0, Number(discount.replace(',', '.')) || 0),
  );

  const result =
    vault && lastRate
      ? compareInstallmentsWithCash({
          installments,
          singleDue,
          today: saoDate(new Date()),
          dailyCdi: lastRate,
          cashDiscountPercent: discountPercent,
          vault: {
            cdiPercentage: Number(vault.cdi_percentage),
            excessRate: Number(vault.excess_rate),
            rateLimit:
              vault.rate_limit === null ? null : Number(vault.rate_limit),
            alreadyInVault: principalOf(vault),
            iofRegressive: !vault.iof_rule.toLowerCase().includes('isento'),
            taxExempt: vault.tax_rule === 'Isento',
          },
        })
      : null;
  const count = installments.length;
  const lastDue = installments.at(-1)?.due ?? singleDue;

  const rows: { option: PaymentOption; detail: string }[] = result
    ? [
        {
          option: 'installments',
          detail:
            count > 1
              ? `${count}x · ${yieldNote(result.installmentYield, lastDue)}`
              : 'Escolha mais de 1 parcela para comparar',
        },
        {
          option: 'single',
          detail: yieldNote(result.singleYield, singleDue),
        },
        {
          option: 'cash',
          detail: discountPercent
            ? discountNote(discountPercent, result.cashDiscount)
            : 'sem desconto, e o dinheiro sai hoje',
        },
      ]
    : [];

  return (
    <section className="rounded-3xl border bg-card p-5 shadow-sm md:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-muted">
          <Scale className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Parcelar ou pagar à vista?</h2>
          <p className="text-xs text-muted-foreground">
            Deixando o dinheiro no cofrinho até cada parcela vencer
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label htmlFor="simulation-vault" className="grid gap-2 text-sm">
          Cofrinho
          <Select
            value={vault?.id ?? ''}
            onValueChange={(value) => value && setVaultId(value)}
          >
            <SelectTrigger id="simulation-vault" className="w-full">
              <SelectValue placeholder={loading ? 'Carregando…' : 'Nenhum'} />
            </SelectTrigger>
            <SelectContent className="w-auto min-w-(--anchor-width)">
              {banks.map((bank) => (
                <SelectItem key={bank.id} value={bank.id}>
                  {bank.name} · {Number(bank.cdi_percentage)}% do CDI
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label htmlFor="simulation-discount" className="grid gap-2 text-sm">
          Desconto à vista no Pix (%)
          <Input
            id="simulation-discount"
            inputMode="decimal"
            value={discount}
            onChange={(event) =>
              setDiscount(
                event.target.value.replace(/[^\d,.]/g, '').slice(0, 5),
              )
            }
            placeholder="0"
          />
        </label>
      </div>

      {!result ? (
        <p className="mt-5 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {loading
            ? 'Carregando o cofrinho e o CDI…'
            : 'É preciso ter um cofrinho cadastrado e o CDI disponível para comparar.'}
        </p>
      ) : (
        <>
          <ul className="mt-5 space-y-2">
            {rows.map(({ option, detail }) => {
              const best = option === result.best;
              return (
                <li
                  key={option}
                  className={`flex items-center gap-3 rounded-2xl border p-4 ${
                    best
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'bg-background/40'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {OPTION_LABEL[option]}
                      {best && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          Melhor
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <Private>{detail}</Private>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-muted-foreground">
                      Custo real
                    </p>
                    <strong className="tabular-nums">
                      <Private>{money(result.costs[option])}</Private>
                    </strong>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-sm">
            <strong>{OPTION_LABEL[result.best]}</strong> sai{' '}
            <Private>{money(result.advantage)}</Private> mais barato que a
            segunda melhor opção.
          </p>
          {result.iofBites && (
            <p className="mt-2 text-xs text-muted-foreground">
              A primeira parcela vence antes de 30 dias: nesse período o{' '}
              {vault!.name} cobra IOF sobre o rendimento, e quase nada sobra
              dela.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Custo real é o que sai do bolso menos o que o dinheiro rende
            enquanto espera. Estimativa com o CDI de hoje, a taxa do{' '}
            {vault!.name} e o imposto de renda; se o CDI mudar, o rendimento
            muda junto.
          </p>
        </>
      )}
    </section>
  );
}
