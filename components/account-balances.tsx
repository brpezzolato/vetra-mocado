'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Decimal from 'decimal.js';
import Link from '@/components/navigation-link';
import { Private } from '@/components/private-value';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { SlidersHorizontal } from 'lucide-react';
import { BlueDaysCounter } from '@/components/streak-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { saoDate, type RecurringExpense } from '@/lib/expense-insights';
import {
  adjustAllowances,
  allowanceForToday,
  daysInTheBlue,
  type AllowanceDay,
} from '@/lib/daily-allowance';
import { barColour } from '@/lib/bank-colors';
import { cardBankName, suggestedCardBank } from '@/lib/payment-cards';
import { BANK_FOLLOW_UPS, subscribeManualRefresh } from '@/lib/manual-refresh';
import { cn } from '@/lib/utils';

/* Saldos das contas correntes (Pluggy, /api/pluggy/balances). Sem conta
   ligada ou com a Pluggy fora, não aparece. */

type Account = {
  bank: 'nubank' | 'itau' | 'picpay' | 'mercado-pago';
  balance: number;
};

/** Limite escolhido no app do banco e quanto dele está livre. */
type CardLimit = { key: string; limit: number; available: number };

/** Saldo ou limite tirado da conta da barra. */
type Exclusion = { kind: 'account' | 'card'; key: string };

/** Carteira da Flash e o saldo atual. */
type Benefit = { key: string; label: string; balance: number };

/** O que o "Posso gastar hoje?" precisa além da barra (lib/safe-to-spend). */
type Plan = {
  subscriptions: RecurringExpense[];
  /** yyyy-mm-dd → gasto do dia. */
  spentByDay: Record<string, string>;
  /** Os valores do dia já guardados (`daily_allowances`). */
  allowances: AllowanceDay[];
  /**
   * Gasto no cartão já refletido no limite, compra ainda não chegou (já em
   * `spentByDay`; lib/unidentified-spend.ts).
   */
  unidentified?: { day: string; account: string; amount: string }[];
};

type Balances = {
  accounts: Account[];
  cards: CardLimit[];
  benefits: Benefit[];
  excluded: Exclusion[];
  plan: Plan | null;
};

const BANKS: Record<Account['bank'], { name: string; logo: string }> = {
  nubank: { name: 'Nubank', logo: '/logos/nubank-ui.webp' },
  itau: { name: 'Itaú', logo: '/logos/itau-app.webp' },
  picpay: { name: 'PicPay', logo: '/logos/picpay-ui.webp' },
  'mercado-pago': { name: 'Mercado Pago', logo: '/logos/mercado-pago-ui.webp' },
};

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value).toNumber());

async function fetchBalances(): Promise<Balances> {
  const response = await fetch('/api/pluggy/balances', { cache: 'no-store' });
  if (!response.ok) throw new Error('saldos indisponíveis');
  const body = (await response.json()) as Partial<Balances>;
  return {
    accounts: body.accounts ?? [],
    cards: body.cards ?? [],
    benefits: body.benefits ?? [],
    excluded: body.excluded ?? [],
    plan: body.plan ?? null,
  };
}

/* Última lista vista, só em memória: a home volta sem esqueleto e só
   redesenha quando algum saldo muda. */
let lastBalances: Balances | null = null;
const sameBalances = (a: Balances | null, b: Balances) =>
  a !== null && JSON.stringify(a) === JSON.stringify(b);

export function AccountBalances() {
  const [balances, setBalances] = useState<Balances | null>(() => lastBalances);
  const accounts = balances?.accounts ?? null;
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchBalances()
        .then((next) => {
          if (!alive || sameBalances(lastBalances, next)) return;
          lastBalances = next;
          setBalances(next);
        })
        // Falhou: fica o que já estava na tela. Só some se nunca houve nada.
        .catch(() => {
          if (alive && lastBalances === null)
            setBalances({
              accounts: [],
              cards: [],
              benefits: [],
              excluded: [],
              plan: null,
            });
        });
    void load();
    // Reconfere por ~1 min: o banco pode atualizar a Pluggy depois.
    const unsubscribe = subscribeManualRefresh(load, {
      followUps: BANK_FOLLOW_UPS,
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  /**
   * Congela o valor de hoje no primeiro cálculo. Se outro aparelho já gravou,
   * o banco mantém o primeiro.
   */
  async function freezeAllowance(day: string, allowance: string) {
    if (!balances?.plan) return;
    if (balances.plan.allowances.some((item) => item.day === day)) return;
    const next = {
      ...balances,
      plan: {
        ...balances.plan,
        allowances: [...balances.plan.allowances, { day, allowance }],
      },
    };
    lastBalances = next;
    setBalances(next);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('daily_allowances')
      .upsert(
        { user_id: user.id, day, allowance },
        { onConflict: 'user_id,day', ignoreDuplicates: true },
      );
  }

  /** Grava os valores que a janela de 3 dias úteis baixou (lib/daily-allowance.ts). */
  async function saveAdjusted(changed: AllowanceDay[]) {
    if (!balances?.plan || !changed.length) return;
    const lowered = new Map(changed.map((item) => [item.day, item.allowance]));
    const next = {
      ...balances,
      plan: {
        ...balances.plan,
        allowances: balances.plan.allowances.map((item) =>
          lowered.has(item.day)
            ? { day: item.day, allowance: lowered.get(item.day)! }
            : item,
        ),
      },
    };
    lastBalances = next;
    setBalances(next);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    for (const item of changed)
      await supabase
        .from('daily_allowances')
        .update({ allowance: item.allowance })
        .eq('user_id', user.id)
        .eq('day', item.day);
  }

  /** Marca/desmarca na hora e grava; se falhar, desfaz. */
  async function toggle(item: Exclusion, include: boolean) {
    if (!balances) return;
    const previous = balances;
    const excluded = include
      ? balances.excluded.filter(
          (other) => !(other.kind === item.kind && other.key === item.key),
        )
      : [...balances.excluded, item];
    const next = { ...balances, excluded };
    lastBalances = next;
    setBalances(next);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = !user
      ? { error: new Error('sem sessão') }
      : include
        ? await supabase
            .from('spending_room_exclusions')
            .delete()
            .eq('kind', item.kind)
            .eq('key', item.key)
        : await supabase
            .from('spending_room_exclusions')
            .upsert(
              { user_id: user.id, kind: item.kind, key: item.key },
              { onConflict: 'user_id,kind,key' },
            );
    if (error) {
      lastBalances = previous;
      setBalances(previous);
    }
  }

  if (accounts === null)
    return (
      // Esqueleto com o mesmo desenho do cartão, para a home não pular.
      <div
        aria-hidden="true"
        className="min-w-0 rounded-3xl border bg-card px-5 py-4 shadow-xs"
      >
        <div className="flex h-8 items-center justify-between">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="size-5 rounded-md" />
        </div>
        <Skeleton className="h-9 w-44" />
        <Skeleton className="mt-3 h-1.5 w-full rounded-full" />
        <div className="mt-2.5 flex gap-4">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-2.5 w-24" />
        </div>
        <div className="mt-4 flex w-0 min-w-full gap-2 overflow-hidden py-0.5">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-12 w-36 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="mt-4 border-t border-border/70 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-2 h-6 w-28" />
            </div>
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-2 w-full rounded-full" />
          <div className="mt-2 flex justify-between gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      </div>
    );
  if (!accounts.length) return null;

  // Pílulas dos bancos no ScrollArea, sem scroll-snap (fazia a home arrastar
  // de lado no iPhone).
  const pills = (
    <ScrollArea orientation="horizontal" hideScrollbar className="w-full">
      <ul className="flex gap-2 py-0.5 lg:flex-wrap">
        {accounts.map((account, index) => {
          const bank = BANKS[account.bank];
          return (
            <li key={`${account.bank}-${index}`} className="shrink-0">
              {/* Cada saldo abre a página do banco. */}
              <Link
                href={`/bancos/${account.bank}`}
                aria-label={`${bank.name}: abrir extrato`}
                className="flex h-12 items-center gap-2.5 rounded-full border bg-card py-1.5 pr-4 pl-1.5 shadow-xs transition-[background-color,transform] hover:bg-muted/50 active:scale-[0.97]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-background">
                  <Image
                    src={bank.logo}
                    alt=""
                    width={20}
                    height={20}
                    unoptimized
                    className="size-5 object-contain"
                  />
                </span>
                <span className="text-base font-semibold tracking-tight tabular-nums">
                  <Private>{money(account.balance)}</Private>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );

  return (
    <section aria-label="Saldo das contas" className="min-w-0">
      <SpendingRoom
        accounts={accounts}
        cards={balances?.cards ?? []}
        benefits={balances?.benefits ?? []}
        excluded={balances?.excluded ?? []}
        plan={balances?.plan ?? null}
        onToggle={(item, include) => void toggle(item, include)}
        onFreeze={(day, allowance) => void freezeAllowance(day, allowance)}
        onAdjust={(changed) => void saveAdjusted(changed)}
        pills={pills}
      />
    </section>
  );
}

/**
 * Quanto ainda dá para gastar: saldo das contas + limite livre dos cartões.
 * A barra é saldo + limite total; a parte cheia é o que sobra, o vazio é o
 * limite usado. O que fica de fora é guardado em `spending_room_exclusions`
 * (conta ou cartão novo entra marcado).
 */
function SpendingRoom({
  accounts,
  cards,
  benefits,
  excluded,
  plan,
  onToggle,
  onFreeze,
  onAdjust,
  pills,
}: {
  accounts: Account[];
  cards: CardLimit[];
  benefits: Benefit[];
  excluded: Exclusion[];
  plan: Plan | null;
  onToggle: (item: Exclusion, include: boolean) => void;
  onFreeze: (day: string, allowance: string) => void;
  onAdjust: (changed: AllowanceDay[]) => void;
  /** Fileira de bancos, dentro do cartão. */
  pills: ReactNode;
}) {
  const [configuring, setConfiguring] = useState(false);
  const out = (kind: Exclusion['kind'], key: string) =>
    excluded.some((item) => item.kind === kind && item.key === key);
  const chosenAccounts = accounts.filter(
    (account) => !out('account', account.bank),
  );
  const chosenCards = cards.filter((card) => !out('card', card.key));
  // Carteiras da Flash entram com a chave "flash-<carteira>".
  const benefitKey = (benefit: Benefit) => `flash-${benefit.key}`;
  const chosenBenefits = benefits.filter(
    (benefit) => !out('account', benefitKey(benefit)),
  );
  const sum = (values: number[]) =>
    values.reduce((total, value) => total.plus(value), new Decimal(0));
  const balance = sum(chosenAccounts.map((account) => account.balance));
  const free = sum(chosenCards.map((card) => card.available));
  const flash = sum(chosenBenefits.map((benefit) => benefit.balance));
  const room = balance.plus(free).plus(flash);
  // Um pedaço por item na cor do banco; limite livre num tom mais claro. O
  // nome aparece no hover e no toque (`limit`: o total do cartão).
  const allParts: {
    id: string;
    label: string;
    colour: string;
    value: Decimal;
    limit?: number;
  }[] = [
    ...chosenAccounts.map((account) => ({
      id: `account-${account.bank}`,
      label: `Conta ${BANKS[account.bank].name}`,
      colour: barColour(account.bank, 'balance'),
      value: new Decimal(account.balance),
    })),
    ...chosenBenefits.map((benefit) => ({
      id: `benefit-${benefit.key}`,
      label: `Flash · ${benefit.label}`,
      colour: barColour('flash', 'balance'),
      value: new Decimal(benefit.balance),
    })),
    ...chosenCards.map((card) => ({
      id: `card-${card.key}`,
      label: card.key,
      colour: barColour(suggestedCardBank(card.key), 'limit'),
      value: new Decimal(card.available),
      limit: card.limit,
    })),
  ];
  // A barra é a divisão do que dá para gastar (a barra inteira = a soma),
  // no celular e no computador. Contra o limite total, com muito limite usado
  // os pedaços sumiam. Saldo negativo não ocupa barra; entra só no número.
  const available = allParts.reduce(
    (sum, part) => sum.plus(Decimal.max(part.value, 0)),
    new Decimal(0),
  );
  const barShare = (value: Decimal) =>
    available.gt(0)
      ? Decimal.max(value, 0).div(available).times(100).toNumber()
      : 0;
  // Pedaço abaixo de 1% não aparece.
  const barParts = allParts.filter((part) => barShare(part.value) >= 1);
  // Linha de baixo: só os grupos que estão na conta.
  const summary = [
    chosenAccounts.length ? { value: balance, label: 'Contas' } : null,
    chosenBenefits.length ? { value: flash, label: 'Flash' } : null,
    chosenCards.length ? { value: free, label: 'Limite livre' } : null,
  ].filter((item) => item !== null);
  const nothing = !summary.length;
  // "Hoje você pode" (lib/daily-allowance.ts): valor do dia congelado,
  // termômetro do gasto e dias no azul.
  const todayKey = saoDate(new Date());
  const spentToday = new Decimal(plan?.spentByDay[todayKey] ?? 0);
  const computed = plan
    ? allowanceForToday({
        today: todayKey,
        room,
        spentToday,
        subscriptions: plan.subscriptions,
      })
    : null;
  // Últimos 3 dias úteis recalculados com compras atrasadas, só para baixo.
  const { adjusted, changed } = plan
    ? adjustAllowances({
        today: todayKey,
        room,
        allowances: plan.allowances,
        spentByDay: plan.spentByDay,
        subscriptions: plan.subscriptions,
      })
    : { adjusted: [] as AllowanceDay[], changed: [] as AllowanceDay[] };
  const changedKey = changed
    .map((item) => `${item.day}:${item.allowance}`)
    .join('|');
  useEffect(() => {
    if (!changedKey || nothing) return;
    // Refeito a partir da chave: `changed` muda de referência a cada render.
    onAdjust(
      changedKey.split('|').map((item) => {
        const [day, allowance] = item.split(':');
        return { day, allowance };
      }),
    );
  }, [changedKey, nothing, onAdjust]);
  const stored = adjusted.find((item) => item.day === todayKey);
  const allowance = stored
    ? new Decimal(stored.allowance)
    : computed
      ? new Decimal(computed.perDay)
      : null;
  const today =
    computed && allowance
      ? {
          allowance,
          spent: spentToday,
          left: Decimal.max(allowance.minus(spentToday), 0),
          over: spentToday.gt(allowance),
          overBy: spentToday.minus(allowance),
          percent: allowance.gt(0)
            ? Math.min(100, spentToday.div(allowance).times(100).toNumber())
            : spentToday.gt(0)
              ? 100
              : 0,
          until: computed.until,
          days: computed.days,
          // O que falta para cobrir as assinaturas, se o mês não fecha.
          short: Decimal.max(new Decimal(computed.free).negated(), 0),
        }
      : null;
  // Dias no azul desde o começo (não é sequência: dia ruim só não soma).
  const blueDays = plan
    ? daysInTheBlue({
        today: todayKey,
        allowances: stored
          ? adjusted
          : allowance
            ? [...adjusted, { day: todayKey, allowance: allowance.toFixed(2) }]
            : adjusted,
        spentByDay: plan.spentByDay,
      })
    : { total: 0, provisional: false };
  // Primeira vez no dia: guarda o valor de hoje.
  const freezeValue = !stored && computed ? computed.perDay : null;
  useEffect(() => {
    if (freezeValue && !nothing) onFreeze(todayKey, freezeValue);
  }, [freezeValue, nothing, onFreeze, todayKey]);
  const pendingToday = (plan?.unidentified ?? []).filter(
    (item) => item.day === todayKey,
  );
  const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  const configButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Escolher saldos e limites da conta"
      className="-mr-2 text-muted-foreground"
      onClick={() => setConfiguring(true)}
    >
      <SlidersHorizontal />
    </Button>
  );
  /* A linha embaixo repete os números em texto. Cada pedaço mostra o nome e o
     valor: no hover (mouse) e no toque. Popover, não Tooltip: o tooltip do
     Base UI não abre no toque. O botão tem 24 px de altura para o dedo; só o
     miolo de 8 px é pintado. */
  const roomBar = (
    <div className="relative -my-2 flex h-6 items-center gap-0.5">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-foreground/10"
      />
      {barParts.map((part, index) => (
        <Popover key={part.id}>
          <PopoverTrigger
            openOnHover
            delay={0}
            aria-label={`${part.label}: ${money(part.value.toNumber())}`}
            className="group relative flex h-6 min-w-0 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            style={{ width: `${barShare(part.value)}%` }}
          >
            <span
              className={cn(
                'block h-2 w-full transition-[filter] group-hover:brightness-125 group-data-[popup-open]:brightness-125',
                index === 0 && 'rounded-l-full',
                index === barParts.length - 1 && 'rounded-r-full',
              )}
              style={{ background: part.colour }}
            />
          </PopoverTrigger>
          <PopoverContent side="top" className="w-auto gap-0.5 p-2 text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: part.colour }}
              />
              {part.label}
            </span>
            <span className="tabular-nums">
              <Private>{money(part.value.toNumber())}</Private>
              {part.limit !== undefined && (
                <span className="text-muted-foreground">
                  {' '}
                  livres de <Private>{money(part.limit)}</Private>
                </span>
              )}
            </span>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  );
  const roomValue = <Private>{money(room.toNumber())}</Private>;
  /** "Hoje ainda dá para gastar": número, fogo, termômetro e notas. */
  const todayBlock = today && (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Número grande = o que ainda dá hoje; o valor do dia vai abaixo do
              termômetro. Passou: o excesso em vermelho. */}
          <p className="text-xs text-muted-foreground">
            {today.over ? 'Hoje você passou' : 'Hoje ainda dá para gastar'}
          </p>
          <p
            className={cn(
              'mt-1 text-xl font-semibold tracking-tight tabular-nums',
              today.over && 'text-destructive',
            )}
          >
            <Private>
              {money((today.over ? today.overBy : today.left).toNumber())}
            </Private>
          </p>
        </div>
        {/* Fogo e o total de dias no azul; "provisório" no title. */}
        {blueDays.total > 0 && (
          <BlueDaysCounter
            total={blueDays.total}
            provisional={blueDays.provisional}
          />
        )}
      </div>
      {/* Termômetro: verde até o valor do dia, vermelho além. */}
      <div
        aria-hidden="true"
        className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10"
      >
        <span
          className={`block h-full rounded-full transition-[width] duration-500 ${today.over ? 'bg-destructive' : 'bg-emerald-500'}`}
          style={{ width: `${today.percent}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          de <Private>{money(today.allowance.toNumber())}</Private> do dia
        </span>
        <span>
          até {shortDay(today.until)} ·{' '}
          {today.days === 1 ? 'último dia' : `faltam ${today.days} dias`}
        </span>
      </div>
      {/* Asterisco: o limite já caiu, a compra ainda não chegou pela Pluggy. */}
      {pendingToday.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          * Inclui{' '}
          {pendingToday.map((item, index) => (
            <span key={item.account}>
              {index > 0 && ' e '}
              <Private>{money(Number(item.amount))}</Private> no{' '}
              {cardBankName(suggestedCardBank(item.account))}
            </span>
          ))}{' '}
          que o limite já mostra, mas a compra ainda não chegou.
        </p>
      )}
      {today.short.gt(0) && (
        <p className="mt-2 text-xs text-destructive">
          Faltam <Private>{money(today.short.toNumber())}</Private> para cobrir
          as assinaturas do mês.
        </p>
      )}
    </>
  );
  return (
    <>
      {/* Mês, bancos e dia num cartão só. */}
      <div className="rounded-3xl border bg-card px-5 py-4 shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Ainda dá para gastar no mês
          </p>
          {configButton}
        </div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {roomValue}
        </p>
        <div className="mt-3">{roomBar}</div>
        {nothing ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Nenhum saldo nem limite escolhido.
          </p>
        ) : (
          /* Origem do número, discreta embaixo da barra. */
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
            {summary.map((item) => (
              <div key={item.label} className="flex items-baseline gap-1">
                <dt>{item.label}</dt>
                <dd className="font-medium tabular-nums text-foreground/75">
                  <Private>{money(item.value.toNumber())}</Private>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-4">{pills}</div>
        {todayBlock && !nothing && (
          <div className="mt-4 border-t border-border/70 pt-4">
            {todayBlock}
          </div>
        )}
      </div>
      <Dialog open={configuring} onOpenChange={setConfiguring}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>O que entra na conta</DialogTitle>
            <DialogDescription>
              Marque os saldos e os limites que contam em “Ainda dá para
              gastar”. Conta ou cartão novo entra marcado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5">
            {accounts.length > 0 && (
              <fieldset className="grid gap-1">
                <legend className="mb-2 text-xs font-medium uppercase tracking-[.1em] text-muted-foreground">
                  Saldos
                </legend>
                {accounts.map((account) => {
                  const id = `room-account-${account.bank}`;
                  return (
                    <div
                      key={account.bank}
                      className="flex items-center gap-3 rounded-xl px-1 py-2"
                    >
                      <Checkbox
                        id={id}
                        checked={!out('account', account.bank)}
                        onCheckedChange={(checked) =>
                          onToggle(
                            { kind: 'account', key: account.bank },
                            checked,
                          )
                        }
                      />
                      <label
                        htmlFor={id}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Image
                            src={BANKS[account.bank].logo}
                            alt=""
                            width={16}
                            height={16}
                            unoptimized
                            className="size-4 object-contain"
                          />
                          <span className="truncate">
                            {BANKS[account.bank].name}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          <Private>{money(account.balance)}</Private>
                        </span>
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            )}
            {benefits.length > 0 && (
              <fieldset className="grid gap-1">
                <legend className="mb-2 text-xs font-medium uppercase tracking-[.1em] text-muted-foreground">
                  Flash
                </legend>
                {benefits.map((benefit) => {
                  const id = `room-benefit-${benefit.key}`;
                  return (
                    <div
                      key={benefit.key}
                      className="flex items-center gap-3 rounded-xl px-1 py-2"
                    >
                      <Checkbox
                        id={id}
                        checked={!out('account', benefitKey(benefit))}
                        onCheckedChange={(checked) =>
                          onToggle(
                            { kind: 'account', key: benefitKey(benefit) },
                            checked,
                          )
                        }
                      />
                      <label
                        htmlFor={id}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm"
                      >
                        <span className="truncate">{benefit.label}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          <Private>{money(benefit.balance)}</Private>
                        </span>
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            )}
            {cards.length > 0 && (
              <fieldset className="grid gap-1">
                <legend className="mb-2 text-xs font-medium uppercase tracking-[.1em] text-muted-foreground">
                  Limites
                </legend>
                {cards.map((card, index) => {
                  const id = `room-card-${index}`;
                  return (
                    <div
                      key={card.key}
                      className="flex items-center gap-3 rounded-xl px-1 py-2"
                    >
                      <Checkbox
                        id={id}
                        checked={!out('card', card.key)}
                        onCheckedChange={(checked) =>
                          onToggle({ kind: 'card', key: card.key }, checked)
                        }
                      />
                      <label
                        htmlFor={id}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm"
                      >
                        <span className="truncate">{card.key}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          <Private>{money(card.available)}</Private> de{' '}
                          <Private>{money(card.limit)}</Private>
                        </span>
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
