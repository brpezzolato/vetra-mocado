'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import {
  CalendarDays,
  CircleDollarSign,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { DateInput } from '@/components/date-input';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { OTHER_PAYER_ACCOUNT } from '@/lib/financial-visualizations';
import type { RecurringExpense } from '@/lib/expense-insights';
import { nextMonth, saoDate } from '@/lib/expense-insights';
import type { FinancialEntry } from '@/lib/financial-tracker';
import {
  resolveCardBank,
  sortPaymentCardsByUsage,
  type PaymentCard,
} from '@/lib/payment-cards';
import { createClient } from '@/lib/supabase/client';

type Filter = 'all' | 'mine' | 'others';
type Frequency = 'monthly' | 'yearly';
// A mesma conta que os gráficos separam do que saiu do bolso.
const OTHER_ACCOUNT = OTHER_PAYER_ACCOUNT;
const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value).toNumber());
const displayDate = (value: string) => value.split('-').reverse().join('/');
const emptyForm = () => ({
  id: '',
  merchant: '',
  amount: '',
  account: '',
  nextDate: saoDate(new Date()),
  category: 'Assinaturas',
  notes: '',
  frequency: 'monthly' as Frequency,
  paidByMe: true,
  active: true,
});

export function SubscriptionsCenter({
  userId,
  initialSubscriptions,
  cards,
  entries,
  initialError,
}: {
  userId: string;
  initialSubscriptions: RecurringExpense[];
  cards: PaymentCard[];
  entries: FinancialEntry[];
  initialError: string;
}) {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const sortedCards = useMemo(
    () =>
      sortPaymentCardsByUsage(
        cards,
        entries.map((entry) => entry.account),
      ),
    [cards, entries],
  );
  const visible = subscriptions.filter((item) =>
    filter === 'all'
      ? true
      : filter === 'mine'
        ? item.paid_by_me !== false
        : item.paid_by_me === false,
  );
  const activeVisible = visible.filter((item) => item.active);
  const monthlyTotal = activeVisible.reduce(
    (sum, item) =>
      sum.plus(
        item.frequency === 'yearly'
          ? new Decimal(item.amount).div(12)
          : item.amount,
      ),
    new Decimal(0),
  );
  const annualTotal = activeVisible.reduce(
    (sum, item) =>
      sum.plus(
        item.frequency === 'yearly'
          ? item.amount
          : new Decimal(item.amount).times(12),
      ),
    new Decimal(0),
  );

  const edit = (item: RecurringExpense) => {
    setForm({
      id: item.id,
      merchant: item.merchant,
      amount: money(item.amount),
      account: item.paid_by_me === false ? '' : item.account,
      nextDate: item.next_date,
      category: item.category ?? 'Assinaturas',
      notes: item.notes ?? '',
      frequency: item.frequency ?? 'monthly',
      paidByMe: item.paid_by_me !== false,
      active: item.active,
    });
    setOpen(true);
  };
  const reload = async () => {
    const result = await createClient()
      .from('recurring_expenses')
      .select('*')
      .order('next_date');
    if (result.error) throw result.error;
    setSubscriptions((result.data ?? []) as RecurringExpense[]);
  };
  const save = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const numericAmount = new Decimal(
        form.amount.replace(/\D/g, '') || 0,
      ).div(100);
      if (!numericAmount.isPositive()) {
        setError('Informe um valor maior que zero.');
        return;
      }
      const amount = numericAmount.toFixed(2);
      const payload = {
        user_id: userId,
        merchant: form.merchant.trim(),
        account: form.paidByMe ? form.account : OTHER_ACCOUNT,
        amount,
        next_date: form.nextDate,
        billing_day: Number(form.nextDate.slice(-2)),
        paid_by_me: form.paidByMe,
        frequency: form.frequency,
        category: form.category.trim() || 'Assinaturas',
        notes: form.notes.trim() || null,
        active: form.active,
      };
      const db = createClient();
      const result = form.id
        ? await db
            .from('recurring_expenses')
            .update(payload)
            .eq('id', form.id)
            .eq('user_id', userId)
        : await db.from('recurring_expenses').insert(payload);
      if (result.error) throw result.error;
      await reload();
      setOpen(false);
      setForm(emptyForm());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar a assinatura. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  };
  const update = async (item: RecurringExpense, values: object) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await createClient()
        .from('recurring_expenses')
        .update(values)
        .eq('id', item.id)
        .eq('user_id', userId);
      if (result.error) throw result.error;
      await reload();
    } catch {
      setError('Não foi possível atualizar a assinatura.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AppHeader onRefresh={() => router.refresh()} />
      <div className="app-container space-y-6 py-7 md:py-10">
        <NavigationBackButton />
        <section className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[.18em] text-muted-foreground">
              Compromissos recorrentes
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Assinaturas
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Separe o que é pago por você do que pertence a outra pessoa, sem
              misturar previsões com gastos já lançados.
            </p>
          </div>
          <Button
            variant="glass"
            onClick={() => {
              setForm(emptyForm());
              setOpen(true);
            }}
          >
            <Plus /> <span className="hidden sm:inline">Nova assinatura</span>
          </Button>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric
            icon={<CircleDollarSign />}
            label="Compromisso mensal"
            value={money(monthlyTotal)}
          />
          <Metric
            icon={<CalendarDays />}
            label="Projeção anual"
            value={money(annualTotal)}
          />
          <Metric
            icon={<Repeat2 />}
            label={
              filter === 'all'
                ? 'Assinaturas ativas'
                : filter === 'mine'
                  ? 'Ativas pagas por você'
                  : 'Ativas pagas por outra pessoa'
            }
            value={String(activeVisible.length)}
          />
        </section>

        <section className="min-w-0 overflow-hidden rounded-3xl border bg-card p-4 shadow-sm md:p-6">
          <ScrollArea
            orientation="horizontal"
            className="scroll-bleed [--bleed:1rem] md:[--bleed:1.5rem]"
          >
            <div className="flex gap-2 pb-2">
              {(
                [
                  ['all', 'Todas', subscriptions.length],
                  [
                    'mine',
                    'Pago por mim',
                    subscriptions.filter((s) => s.paid_by_me !== false).length,
                  ],
                  [
                    'others',
                    'Outra pessoa',
                    subscriptions.filter((s) => s.paid_by_me === false).length,
                  ],
                ] as const
              ).map(([value, label, count]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={filter === value ? 'default' : 'outline'}
                  onClick={() => setFilter(value)}
                  className="shrink-0"
                >
                  {label} · {count}
                </Button>
              ))}
            </div>
          </ScrollArea>
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {visible.map((item) => (
              <article
                key={item.id}
                className="min-w-0 overflow-hidden rounded-2xl border bg-background/45 p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-10 w-12 shrink-0 place-items-center rounded-xl bg-muted [&>span]:!w-12 sm:h-11 sm:w-14 sm:[&>span]:!w-14">
                    {item.paid_by_me === false ? (
                      <UsersRound className="size-5" />
                    ) : (
                      <PaymentCardIcon
                        bankId={resolveCardBank(item.account, cards)}
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold capitalize sm:text-base">
                          {item.merchant}
                        </h2>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground sm:text-xs">
                          {item.category ?? 'Assinaturas'} ·{' '}
                          {item.paid_by_me === false
                            ? 'Não entra nas suas finanças'
                            : item.account}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[10px] sm:text-[11px] ${item.active ? 'bg-emerald-500/12 text-emerald-500' : 'bg-muted text-muted-foreground'}`}
                      >
                        {item.active ? 'Ativa' : 'Pausada'}
                      </span>
                    </div>
                    <p className="mt-4 text-xl font-semibold tabular-nums sm:text-2xl">
                      {money(item.amount)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        /{item.frequency === 'yearly' ? 'ano' : 'mês'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 rounded-xl bg-muted/45 p-3 text-xs text-muted-foreground">
                  <CalendarDays className="size-4" /> Próxima cobrança em{' '}
                  {displayDate(item.next_date)}
                </div>
                {item.notes && (
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {item.notes}
                  </p>
                )}
                <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-1 [&>button]:min-w-0 [&>button]:px-1 [&>button]:text-[11px] sm:gap-2 sm:[&>button]:text-sm">
                  <Button size="sm" variant="ghost" onClick={() => edit(item)}>
                    <Pencil /> Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void update(item, { active: !item.active })}
                  >
                    {item.active ? <Pause /> : <Play />}{' '}
                    {item.active ? 'Pausar' : 'Retomar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !item.active}
                    onClick={() =>
                      void update(item, {
                        next_date: nextMonth(item.next_date, item.billing_day),
                      })
                    }
                  >
                    <CalendarDays /> Avançar
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="justify-self-end text-destructive"
                    aria-label={`Excluir ${item.merchant}`}
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Excluir a assinatura ${item.merchant}?`,
                        )
                      )
                        return;
                      setBusy(true);
                      void createClient()
                        .from('recurring_expenses')
                        .delete()
                        .eq('id', item.id)
                        .eq('user_id', userId)
                        .then(async ({ error }) => {
                          if (error)
                            setError('Não foi possível excluir a assinatura.');
                          else await reload();
                          setBusy(false);
                        });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))}
            {!visible.length && (
              <div className="col-span-full rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                <Repeat2 className="mx-auto mb-3 size-6" /> Nenhuma assinatura
                neste filtro.
              </div>
            )}
          </div>
        </section>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[min(46rem,calc(100dvh-2rem))] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? 'Editar assinatura' : 'Nova assinatura'}
            </DialogTitle>
            <DialogDescription>
              Cadastre a previsão sem criar uma compra real.
            </DialogDescription>
          </DialogHeader>
          <form id="subscription-form" onSubmit={save} className="grid gap-5">
            <label htmlFor="subscription-name" className="grid gap-2 text-sm">
              Nome
              <Input
                id="subscription-name"
                required
                maxLength={160}
                value={form.merchant}
                onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                placeholder="Ex.: Netflix"
              />
            </label>
            <label htmlFor="subscription-amount" className="grid gap-2 text-sm">
              Valor
              <Input
                id="subscription-amount"
                required
                inputMode="numeric"
                value={form.amount}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 15);
                  setForm({
                    ...form,
                    amount: digits ? money(new Decimal(digits).div(100)) : '',
                  });
                }}
                placeholder="R$ 0,00"
              />
            </label>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm">Quem paga?</legend>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={form.paidByMe ? 'default' : 'outline'}
                  onClick={() => setForm({ ...form, paidByMe: true })}
                >
                  <UserRound /> Pago por mim
                </Button>
                <Button
                  type="button"
                  variant={!form.paidByMe ? 'default' : 'outline'}
                  onClick={() =>
                    setForm({ ...form, paidByMe: false, account: '' })
                  }
                >
                  <UsersRound /> Outra pessoa
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {form.paidByMe
                  ? 'Entra nas suas previsões, no simulador e no contexto da Vetra AI.'
                  : 'Fica visível somente nesta tela e não altera seus números.'}
              </p>
            </fieldset>
            {form.paidByMe && (
              <label
                htmlFor="subscription-account"
                className="grid gap-2 text-sm"
              >
                Cartão ou conta
                <Select
                  value={form.account}
                  onValueChange={(account) =>
                    account && setForm({ ...form, account })
                  }
                >
                  <SelectTrigger
                    id="subscription-account"
                    className="w-full overflow-hidden"
                  >
                    <SelectValue placeholder="Escolha o cartão" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedCards.map((card) => (
                      <SelectItem key={card.account} value={card.account}>
                        <PaymentCardIcon bankId={card.bank_id} />
                        <span className="truncate">{card.account}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <label
                htmlFor="subscription-frequency"
                className="grid gap-2 text-sm"
              >
                Frequência
                <Select
                  value={form.frequency}
                  onValueChange={(frequency) =>
                    frequency &&
                    setForm({ ...form, frequency: frequency as Frequency })
                  }
                >
                  <SelectTrigger id="subscription-frequency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="yearly">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <div className="grid gap-2 text-sm">
                Próxima cobrança
                <DateInput
                  id="subscription-next-date"
                  value={form.nextDate}
                  onValueChange={(nextDate) => setForm({ ...form, nextDate })}
                />
              </div>
            </div>
            <label
              htmlFor="subscription-category"
              className="grid gap-2 text-sm"
            >
              Categoria
              <Input
                id="subscription-category"
                required
                maxLength={80}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </label>
            <label htmlFor="subscription-notes" className="grid gap-2 text-sm">
              Observação (opcional)
              <Input
                id="subscription-notes"
                maxLength={500}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Plano, compartilhamento ou lembrete"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button
              type="submit"
              variant="glass"
              form="subscription-form"
              disabled={
                busy ||
                !form.merchant.trim() ||
                !form.amount ||
                (form.paidByMe && !form.account)
              }
            >
              {busy ? 'Salvando…' : 'Salvar assinatura'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label.toUpperCase()}
      </div>
      <p
        data-private-value
        className="mt-3 text-2xl font-semibold tabular-nums"
      >
        {value}
      </p>
    </div>
  );
}
