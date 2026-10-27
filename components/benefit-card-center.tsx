'use client';

import { useCallback, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import {
  Bus,
  CalendarCheck,
  CalendarX,
  Plus,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { AppHeader } from '@/components/app-header';
import { DateInput } from '@/components/date-input';
import { EntryDetails } from '@/components/entry-details';
import { ExpenseDayList } from '@/components/expense-line';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Private } from '@/components/private-value';
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
  benefitAllowance,
  benefitBalanceView,
  benefitCycles,
  benefitForecast,
  type BenefitForecast,
  FLASH_WALLETS,
  walletEntries,
  walletForEntry,
  type BenefitCycle,
  latestBenefitBalance,
  type BenefitCardBalance,
  type FlashWallet,
} from '@/lib/benefit-cards';
import { saoDate } from '@/lib/expense-insights';
import { FLASH_ACCOUNT } from '@/lib/flash-statement';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard } from '@/lib/payment-cards';
import { createClient } from '@/lib/supabase/client';

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value || 0).toDecimalPlaces(2).toNumber());

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  );

/** Dia e mês: a previsão nunca passa de algumas semanas à frente. */
const shortDay = (day: string) => dayLabel(day).slice(0, 5);

const dayBefore = (day: string) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

/** Ciclo aberto não tem data final: só o próximo depósito a define. */
const cycleLabel = (cycle: BenefitCycle) => {
  if (!cycle.start) return 'Todos os lançamentos';
  if (!cycle.next) return `Ciclo atual · desde ${dayLabel(cycle.start)}`;
  return `${dayLabel(cycle.start)} a ${dayLabel(dayBefore(cycle.next))}`;
};

/** Campo de dinheiro mascarado: dígitos lidos como centavos. */
const moneyInput = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 15);
  return digits ? money(new Decimal(digits).div(100)) : '';
};

const moneyValue = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits ? new Decimal(digits).div(100) : new Decimal(0);
};

// Ícone por carteira (ônibus = VT, talheres = VR), também no diálogo, para
// não lançar depósito no card trocado. Indexado pelas chaves reais: carteira
// nova quebra o build até ganhar ícone.
const WALLET_ICON: Record<FlashWallet['key'], LucideIcon> = {
  transporte: Bus,
  alimentacao: UtensilsCrossed,
};

/** Mesmo desenho do card no diálogo. */
function WalletMark({ wallet }: { wallet: FlashWallet | null }) {
  if (!wallet) return null;
  const Icon = WALLET_ICON[wallet.key];
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-foreground">
      <Icon className="size-3.5" />
    </span>
  );
}

/** Chip de filtro com o gasto do ciclo naquela carteira. */
function WalletChip({
  label,
  icon: Icon,
  value,
  active,
  onClick,
}: {
  label: string;
  icon?: LucideIcon;
  value: Decimal;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'vetra-glass flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2',
        // Ligado = vidro preenchido, como no resto do app.
        active && 'vetra-glass-primary',
      )}
    >
      {Icon && (
        <Icon className={cn('size-4 shrink-0', !active && 'opacity-70')} />
      )}
      <span className="text-xs font-medium">{label}</span>
      <span className={cn('text-xs tabular-nums', !active && 'opacity-70')}>
        <Private>{money(value)}</Private>
      </span>
    </button>
  );
}

/** Janela que o saldo cobre: 30 dias corridos desde o último depósito ou
 * leitura de saldo (o benefício tem ciclo próprio, não vira no dia 1º). */
const BUDGET_DAYS = 30;

/** Noon UTC on both ends, so a day is a day regardless of time zone. */
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86400000,
  );

/**
 * Quanto o saldo permite por dia no que resta da janela. Arredonda para
 * baixo: arredondar para cima esgota antes.
 */
const perDay = (balance: Decimal.Value, daysLeft: number) =>
  daysLeft > 0
    ? new Decimal(balance).div(daysLeft).toDecimalPlaces(2, Decimal.ROUND_DOWN)
    : new Decimal(0);

/**
 * Previsão do ritmo de gasto: frase, barra até o próximo depósito e números.
 * Vermelho só quando não aguenta.
 */
function ForecastPanel({
  forecast,
  today,
}: {
  forecast: BenefitForecast;
  today: string;
}) {
  const short = !forecast.lasts;
  const Icon = short ? CalendarX : CalendarCheck;
  const toDeposit = forecast.nextDeposit
    ? daysBetween(today, forecast.nextDeposit)
    : null;
  const reach = daysBetween(today, forecast.runsOutOn);
  const covered =
    toDeposit && toDeposit > 0
      ? Math.min(100, Math.max(4, (reach / toDeposit) * 100))
      : null;
  const gap =
    short && forecast.nextDeposit
      ? daysBetween(forecast.runsOutOn, forecast.nextDeposit)
      : null;
  return (
    <div
      className={`mt-4 rounded-2xl p-4 ${short ? 'bg-destructive/10' : 'bg-muted/60'}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-full ${short ? 'bg-destructive/15 text-destructive' : 'bg-background text-foreground'}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p
            className={`text-sm font-medium ${short ? 'text-destructive' : ''}`}
          >
            {short
              ? `Acaba por volta de ${shortDay(forecast.runsOutOn)}`
              : 'Dura até o próximo depósito'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {short ? (
              gap !== null ? (
                <>
                  {gap} dia{gap === 1 ? '' : 's'} antes do próximo depósito
                </>
              ) : (
                <>no ritmo de gasto deste ciclo</>
              )
            ) : (
              <>
                sobra cerca de <Private>{money(forecast.leftover!)}</Private> em{' '}
                {shortDay(forecast.nextDeposit!)}
              </>
            )}
          </p>
        </div>
      </div>
      {covered !== null && (
        <div className="mt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
            aria-hidden="true"
          >
            <div
              className={`h-full rounded-full ${short ? 'bg-destructive' : 'bg-foreground/60'}`}
              style={{ width: `${covered}%` }}
            />
          </div>
          <span className="sr-only">
            O saldo cobre {Math.round(covered)}% do caminho até o próximo
            depósito.
          </span>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>Hoje</span>
            <span>Depósito · {shortDay(forecast.nextDeposit!)}</span>
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Ritmo do ciclo: <Private>{money(forecast.perDay)}</Private> por dia
      </p>
    </div>
  );
}

export function BenefitCardCenter({
  userId,
  initialEntries,
  initialBalances,
  cards,
}: {
  userId: string;
  initialEntries: FinancialEntry[];
  initialBalances: BenefitCardBalance[];
  cards: PaymentCard[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [balances, setBalances] = useState(initialBalances);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceWallet, setBalanceWallet] = useState<FlashWallet | null>(null);
  const [balanceValue, setBalanceValue] = useState('');
  const [balanceDay, setBalanceDay] = useState(() => saoDate(new Date()));

  const [cycleIndex, setCycleIndex] = useState(0);
  const [walletFilter, setWalletFilter] = useState<string | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositWallet, setDepositWallet] = useState<FlashWallet | null>(null);
  const [depositValue, setDepositValue] = useState('');
  const [depositDescription, setDepositDescription] = useState('');
  const [depositDay, setDepositDay] = useState(() => saoDate(new Date()));

  const [selected, setSelected] = useState<FinancialEntry | null>(null);
  // Fixo durante a montagem, para a contagem não depender de re-renders.
  const [today] = useState(() => saoDate(new Date()));

  const cardEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.account === FLASH_ACCOUNT)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    [entries],
  );

  // Cada lançamento pertence a exatamente uma carteira (`walletForEntry`).
  const wallets = useMemo(
    () =>
      FLASH_WALLETS.map((wallet) => {
        const snapshot = latestBenefitBalance(balances, wallet.account);
        const ownEntries = walletEntries(wallet, cardEntries);
        // A janela recomeça no último depósito ou na última leitura de saldo.
        const lastDeposit = ownEntries
          .filter((entry) => entry.entry_type === 'income')
          .map((entry) => saoDate(entry.occurred_at))
          .sort()
          .at(-1);
        const anchorDay = [snapshot?.measured_at, lastDeposit]
          .filter((day): day is string => Boolean(day))
          .sort()
          .at(-1);
        const daysLeft = anchorDay
          ? Math.max(0, BUDGET_DAYS - daysBetween(anchorDay, today))
          : 0;
        const view = benefitBalanceView(snapshot, ownEntries);
        return {
          wallet,
          snapshot,
          anchorDay,
          daysLeft,
          view,
          allowance: view
            ? benefitAllowance(
                view.current,
                ownEntries,
                today,
                daysLeft || BUDGET_DAYS,
              )
            : null,
          forecast: view
            ? benefitForecast(view.current, ownEntries, today)
            : null,
        };
      }),
    [balances, cardEntries, today],
  );

  // "Hoje dá para gastar" só da Flash: a soma das carteiras, cada uma
  // repartida até a véspera do próprio depósito (lib/benefit-cards.ts).
  const todayParts = wallets.flatMap(({ wallet, allowance }) =>
    allowance ? [{ wallet, ...allowance }] : [],
  );
  const todayTotal = todayParts.reduce(
    (sum, part) => ({
      allowance: sum.allowance.plus(part.allowance),
      spent: sum.spent.plus(part.spent),
      left: sum.left.plus(part.left),
    }),
    { allowance: new Decimal(0), spent: new Decimal(0), left: new Decimal(0) },
  );
  const todayOver = todayTotal.spent.gt(todayTotal.allowance);
  const todayPercent = todayTotal.allowance.gt(0)
    ? Math.min(
        100,
        todayTotal.spent.div(todayTotal.allowance).times(100).toNumber(),
      )
    : todayTotal.spent.gt(0)
      ? 100
      : 0;

  const cycles = useMemo(() => benefitCycles(cardEntries), [cardEntries]);
  // Índice preso ao que existe: recarregar pode encurtar a lista.
  const cycle = cycles[Math.min(cycleIndex, cycles.length - 1)];
  const cycleTotals = useMemo(() => {
    const totals = new Map<string, Decimal>(
      FLASH_WALLETS.map((wallet) => [wallet.key, new Decimal(0)]),
    );
    for (const item of cycle?.entries ?? []) {
      if (item.entry_type !== 'expense') continue;
      const key = walletForEntry(item).key;
      totals.set(key, (totals.get(key) ?? new Decimal(0)).plus(item.amount));
    }
    return totals;
  }, [cycle]);
  const visible = (cycle?.entries ?? []).filter(
    (item) => !walletFilter || walletForEntry(item).key === walletFilter,
  );

  const reload = useCallback(async () => {
    const supabase = createClient();
    const [fresh, freshBalances] = await Promise.all([
      supabase
        .from('financial_entries')
        .select('*')
        .eq('account', FLASH_ACCOUNT)
        .order('occurred_at', { ascending: false })
        .limit(500),
      supabase
        .from('benefit_card_balances')
        .select('*')
        .order('measured_at', { ascending: false }),
    ]);
    if (fresh.data) setEntries(fresh.data as FinancialEntry[]);
    if (freshBalances.data)
      setBalances(freshBalances.data as BenefitCardBalance[]);
  }, []);

  const saveBalance = async (
    amount: string,
    day: string,
    source: BenefitCardBalance['source'],
    account: string,
  ) => {
    const value = moneyValue(amount);
    if (value.isNegative()) throw new Error('Informe um saldo válido.');
    const supabase = createClient();
    const { error: failure } = await supabase
      .from('benefit_card_balances')
      .upsert(
        {
          user_id: userId,
          account,
          balance: value.toFixed(2),
          measured_at: day,
          source,
        },
        { onConflict: 'user_id,account,measured_at' },
      );
    if (failure) throw new Error(failure.message);
  };

  const saveDeposit = async (
    wallet: FlashWallet,
    amount: string,
    day: string,
    description: string,
  ) => {
    const value = moneyValue(amount);
    if (value.lte(0)) throw new Error('Informe um valor de depósito válido.');
    const supabase = createClient();
    const { error: failure } = await supabase.from('financial_entries').insert({
      user_id: userId,
      entry_type: 'income',
      amount: value.toFixed(2),
      description:
        description.trim().slice(0, 160) || `Depósito Flash · ${wallet.label}`,
      category: wallet.category,
      account: FLASH_ACCOUNT,
      occurred_at: new Date(`${day}T12:00:00-03:00`).toISOString(),
      source: 'manual',
    });
    if (failure) throw new Error(failure.message);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader onRefresh={reload} />
      <div className="app-container py-6 md:py-9">
        <NavigationBackButton fallback="/financeiro" className="mb-5" />
        <h1 className="text-xl font-semibold">Cartão de benefícios</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Os saldos da sua Flash, acompanhados junto com o resto das suas
          contas.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm"
          >
            {error}
          </p>
        )}
        {notice && (
          <output className="mt-5 block rounded-xl border bg-card p-3 text-sm">
            {notice}
          </output>
        )}

        {todayParts.length > 0 && (
          <section className="mt-6 rounded-3xl border bg-card p-6">
            <p className="text-xs text-muted-foreground">
              {todayOver ? 'Hoje você passou' : 'Hoje ainda dá para gastar'}
            </p>
            <p
              className={cn(
                'mt-1 text-3xl font-semibold tracking-tight tabular-nums',
                todayOver && 'text-destructive',
              )}
            >
              <Private>
                {money(
                  todayOver
                    ? todayTotal.spent.minus(todayTotal.allowance)
                    : todayTotal.left,
                )}
              </Private>
            </p>
            {/* Termômetro: verde até o valor do dia, vermelho além. */}
            <div
              aria-hidden="true"
              className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10"
            >
              <span
                className={`block h-full rounded-full transition-[width] duration-500 ${todayOver ? 'bg-destructive' : 'bg-emerald-500'}`}
                style={{ width: `${todayPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              de <Private>{money(todayTotal.allowance)}</Private> do dia
            </p>
            {/* Cada carteira só paga o que é dela: o número de cada uma. */}
            <ul className="mt-4 grid gap-2">
              {todayParts.map((part) => {
                const Icon = WALLET_ICON[part.wallet.key];
                return (
                  <li
                    key={part.wallet.key}
                    className="flex items-center gap-2.5 text-sm"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted">
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {part.wallet.label}
                    </span>
                    <span className="text-right tabular-nums">
                      <span
                        className={cn(
                          'font-medium',
                          part.over && 'text-destructive',
                        )}
                      >
                        <Private>{money(part.left)}</Private>
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        até {shortDay(part.until)} ·{' '}
                        {part.days === 1
                          ? 'último dia'
                          : `faltam ${part.days} dias`}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {wallets.map(({ wallet, view, daysLeft, forecast }) => {
            const Icon = WALLET_ICON[wallet.key];
            return (
              <section
                key={wallet.key}
                className="rounded-3xl border bg-card p-6"
              >
                <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-foreground">
                    <Icon className="size-4" />
                  </span>
                  {wallet.label}
                </div>
                <p className="mt-2 text-3xl font-semibold tabular-nums">
                  <Private>{view ? money(view.current) : '—'}</Private>
                </p>
                {view && new Decimal(view.current).gt(0) && (
                  <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                    {daysLeft === 0 ? (
                      // Trinta dias sem depósito nem leitura: não há janela a repartir.
                      <>ciclo de {BUDGET_DAYS} dias encerrado</>
                    ) : perDay(view.current, daysLeft).gt(0) ? (
                      <>
                        <Private>
                          {money(perDay(view.current, daysLeft))}
                        </Private>{' '}
                        por dia pelos {daysLeft} dia
                        {daysLeft === 1 ? '' : 's'} que faltam
                      </>
                    ) : (
                      // Menos de um centavo por dia.
                      <>
                        não dá um centavo por dia nos {daysLeft} dia
                        {daysLeft === 1 ? '' : 's'} que faltam
                      </>
                    )}
                  </p>
                )}
                {forecast && view && new Decimal(view.current).gt(0) && (
                  <ForecastPanel forecast={forecast} today={today} />
                )}
                {!view && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Informe quanto você tem em {wallet.label} para começar a
                    acompanhar.
                  </p>
                )}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    variant="glass"
                    onClick={() => {
                      setBalanceWallet(wallet);
                      // Começa com o saldo atual (confirmar é um toque). Negativo: vazio.
                      setBalanceValue(
                        view && !view.current.startsWith('-')
                          ? moneyInput(view.current)
                          : '',
                      );
                      setBalanceDay(saoDate(new Date()));
                      setBalanceOpen(true);
                    }}
                  >
                    Informar saldo
                  </Button>
                  <Button
                    variant="glass-quiet"
                    onClick={() => {
                      setDepositWallet(wallet);
                      setDepositValue('');
                      setDepositDescription('');
                      setDepositDay(saoDate(new Date()));
                      setDepositOpen(true);
                    }}
                  >
                    <Plus />
                    Registrar depósito
                  </Button>
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Extrato do ciclo</h2>
          {cycles.length > 1 && (
            <Select
              value={String(Math.min(cycleIndex, cycles.length - 1))}
              onValueChange={(value) => value && setCycleIndex(Number(value))}
            >
              <SelectTrigger size="sm" aria-label="Ciclo">
                <span>{cycle ? cycleLabel(cycle) : 'Ciclo'}</span>
              </SelectTrigger>
              {/* Largura do gatilho como piso, não teto: o rótulo era cortado. */}
              <SelectContent className="w-auto min-w-(--anchor-width)">
                {cycles.map((item, index) => (
                  <SelectItem
                    key={item.start || 'inicio'}
                    value={String(index)}
                  >
                    {cycleLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <ScrollArea orientation="horizontal" className="scroll-bleed mb-3">
          <div className="flex gap-2 pb-2">
            <WalletChip
              label="Tudo"
              value={FLASH_WALLETS.reduce(
                (sum, wallet) =>
                  sum.plus(cycleTotals.get(wallet.key) ?? new Decimal(0)),
                new Decimal(0),
              )}
              active={!walletFilter}
              onClick={() => setWalletFilter(null)}
            />
            {FLASH_WALLETS.map((wallet) => (
              <WalletChip
                key={wallet.key}
                label={wallet.label}
                icon={WALLET_ICON[wallet.key]}
                value={cycleTotals.get(wallet.key) ?? new Decimal(0)}
                active={walletFilter === wallet.key}
                onClick={() =>
                  setWalletFilter(
                    walletFilter === wallet.key ? null : wallet.key,
                  )
                }
              />
            ))}
          </div>
        </ScrollArea>

        <section>
          {visible.length ? (
            <div className="rounded-3xl border bg-card px-3 pt-1 pb-3 md:px-4">
              <ExpenseDayList
                entries={visible}
                cards={cards}
                onOpen={setSelected}
              />
            </div>
          ) : (
            <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
              Nenhum lançamento neste ciclo.
            </p>
          )}
        </section>
      </div>

      {selected && (
        <EntryDetails
          key={selected.id}
          entry={selected}
          cards={cards}
          onClose={() => setSelected(null)}
          onSaved={() => void reload()}
          onRuleApplied={reload}
          onDelete={async (id) => {
            const supabase = createClient();
            const { error: failure } = await supabase
              .from('financial_entries')
              .delete()
              .eq('id', id)
              .eq('user_id', userId);
            if (failure) throw new Error(failure.message);
            setSelected(null);
            await reload();
          }}
        />
      )}

      <Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!balanceWallet) return;
              setBusy(true);
              setError('');
              saveBalance(
                balanceValue,
                balanceDay,
                'manual',
                balanceWallet.account,
              )
                .then(reload)
                .then(() => {
                  setBalanceOpen(false);
                  setNotice('Saldo atualizado.');
                })
                .catch((failure: unknown) =>
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'Não consegui salvar.',
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <WalletMark wallet={balanceWallet} />
                Informar saldo · {balanceWallet?.label}
              </DialogTitle>
              <DialogDescription>
                Quanto essa carteira mostra hoje na Flash. Os gastos e depósitos
                lançados depois desta data entram sozinhos na conta.
              </DialogDescription>
            </DialogHeader>
            <div className="my-5 grid gap-4">
              <label className="text-sm" htmlFor="flash-saldo">
                <span className="mb-1.5 block text-muted-foreground">
                  Saldo
                </span>
                <Input
                  id="flash-saldo"
                  inputMode="numeric"
                  placeholder="R$ 0,00"
                  value={balanceValue}
                  onChange={(event) =>
                    setBalanceValue(moneyInput(event.target.value))
                  }
                />
              </label>
              <label className="text-sm" htmlFor="flash-saldo-data">
                <span className="mb-1.5 block text-muted-foreground">
                  Data da consulta
                </span>
                <DateInput
                  id="flash-saldo-data"
                  value={balanceDay}
                  onValueChange={setBalanceDay}
                  max={saoDate(new Date())}
                />
              </label>
            </div>
            <DialogFooter>
              <Button type="submit" variant="glass" disabled={busy}>
                {busy ? 'Salvando…' : 'Salvar saldo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!depositWallet) return;
              setBusy(true);
              setError('');
              saveDeposit(
                depositWallet,
                depositValue,
                depositDay,
                depositDescription,
              )
                .then(reload)
                .then(() => {
                  setDepositOpen(false);
                  setNotice('Depósito lançado.');
                })
                .catch((failure: unknown) =>
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'Não consegui lançar o depósito.',
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <WalletMark wallet={depositWallet} />
                Registrar depósito · {depositWallet?.label}
              </DialogTitle>
              <DialogDescription>
                O crédito que a Flash pôs nessa carteira. Entra como recebido a
                partir desta data.
              </DialogDescription>
            </DialogHeader>
            <div className="my-5 grid gap-4">
              <label className="text-sm" htmlFor="flash-deposito-valor">
                <span className="mb-1.5 block text-muted-foreground">
                  Valor
                </span>
                <Input
                  id="flash-deposito-valor"
                  inputMode="numeric"
                  placeholder="R$ 0,00"
                  value={depositValue}
                  onChange={(event) =>
                    setDepositValue(moneyInput(event.target.value))
                  }
                />
              </label>
              <label className="text-sm" htmlFor="flash-deposito-data">
                <span className="mb-1.5 block text-muted-foreground">
                  Data do crédito
                </span>
                <DateInput
                  id="flash-deposito-data"
                  value={depositDay}
                  onValueChange={setDepositDay}
                  max={saoDate(new Date())}
                />
              </label>
              <label className="text-sm" htmlFor="flash-deposito-descricao">
                <span className="mb-1.5 block text-muted-foreground">
                  Descrição (opcional)
                </span>
                <Input
                  id="flash-deposito-descricao"
                  placeholder={`Depósito Flash · ${depositWallet?.label ?? ''}`}
                  value={depositDescription}
                  onChange={(event) =>
                    setDepositDescription(event.target.value)
                  }
                />
              </label>
            </div>
            <DialogFooter>
              <Button type="submit" variant="glass" disabled={busy}>
                {busy ? 'Lançando…' : 'Lançar depósito'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
