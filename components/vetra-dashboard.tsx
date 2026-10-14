'use client';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import { AppHeader } from '@/components/app-header';
import { loadingFetch } from '@/lib/loading-activity';
import { DashboardDataSkeleton } from '@/components/data-skeletons';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type ReactNode,
} from 'react';
import Link from '@/components/navigation-link';
import { FinanceOverview } from '@/components/finance-overview';
import { VaultCards } from '@/components/vault-cards';
import Decimal from 'decimal.js';
import {
  ArrowDownRight,
  CircleDollarSign,
  CalendarDays,
  ChevronRight,
  Landmark,
  PiggyBank as PiggyBankIcon,
  Settings2,
  Trash2,
} from 'lucide-react';
import { ptBR } from 'date-fns/locale';
import { createClient } from '@/lib/supabase/client';
import type {
  DailyRate,
  PiggyBank,
  PiggyBankRow,
  SnapshotRow,
  TransactionRow,
  BankEarningCredit,
} from '@/lib/domain';
import { type StatementEarning } from '@/lib/earning-statement';
import { snapshotEarnings } from '@/lib/snapshot-earnings';
import {
  closedSummaries,
  monthlyYields,
  type ClosedSummary,
  type MonthYield,
  type VaultEarnings,
} from '@/lib/vault-history';
import { bankPolicy } from '@/lib/domain';
import { calculate, iofExemptionAt } from '@/lib/finance';
import {
  buildBankSeries,
  calculatePortfolio,
  calculateRealized,
  portfolioEarnings,
  staleBankDate,
} from '@/lib/portfolio';
import { mergePublishedRates } from '@/lib/cdi';
import { VaultDetailsDialog } from '@/components/dashboard-tools';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Private } from '@/components/private-value';
import { ScrollArea } from '@/components/ui/scroll-area';

const money = (value: Decimal | string | number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value || 0).toDecimalPlaces(2).toNumber(),
  );
const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';
const dateBR = (date: string | Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: SAO_PAULO_TIME_ZONE }).format(
    typeof date === 'string'
      ? new Date(`${date.slice(0, 10)}T12:00:00-03:00`)
      : date,
  );
const shortDate = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: SAO_PAULO_TIME_ZONE,
  }).format(date);
const saoPauloDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
/** Cor de texto legível do banco do cofrinho (tokens por tema). */
const vaultTextAccent = (institution: string) => {
  if (/nubank/i.test(institution)) return 'var(--brand-nubank-text)';
  if (/mercado\s*pago/i.test(institution))
    return 'var(--brand-mercadopago-text)';
  return undefined;
};
const today = () => saoPauloDate();
const calendarDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00-03:00`);
type StatementEntry =
  | ({
      type: 'earning';
      id: string;
      bank: PiggyBank;
      date: string;
    } & StatementEarning)
  | {
      type: 'movement';
      id: string;
      bank: PiggyBank;
      transaction: TransactionRow;
    };

export default function VetraDashboard({
  overview = false,
  bankId = 'all',
}: {
  overview?: boolean;
  bankId?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [banks, setBanks] = useState<PiggyBank[]>([]);
  // Encerrados não aparecem nos cards, mas o rendimento conta no overview.
  const [archivedBanks, setArchivedBanks] = useState<PiggyBank[]>([]);
  const [rates, setRates] = useState<DailyRate[]>([]);
  const [activeId, setActiveId] = useState(bankId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      try {
        localStorage.removeItem('vetra:dashboard-cache');
        const cachedRates = JSON.parse(
          localStorage.getItem('vetra:rates-cache') ?? '[]',
        ) as DailyRate[];
        if (Array.isArray(cachedRates) && cachedRates.length)
          setRates(cachedRates);
      } catch {
        // Cache local corrompido é ignorado.
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Somente leitura: cofrinhos, saldo e movimentos vêm do banco pela Pluggy
  // (lib/pluggy/piggy-sync.ts).
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [statementFilter, setStatementFilter] = useState<
    'all' | 'earnings' | 'movements'
  >('all');
  const [dashboardPeriod, setDashboardPeriod] = useState<
    '7d' | '30d' | 'month' | 'custom' | 'all'
  >('30d');
  const [customStart, setCustomStart] = useState(`${today().slice(0, 7)}-01`);
  const [customEnd, setCustomEnd] = useState(today());

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError('');
      const requestData = () =>
        supabase
          .from('piggy_banks')
          .select(
            '*, transactions(*), balance_snapshots(*), bank_earning_credits(*)',
          )
          .order('created_at');

      let result = await requestData();
      for (let attempt = 1; attempt <= 2; attempt++) {
        const message = result.error?.message ?? '';
        if (!/jwt issued at future/i.test(message)) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        await supabase.auth.refreshSession();
        result = await requestData();
      }

      const requestError = result.error;
      if (requestError) {
        const isClockError = /jwt issued at future/i.test(requestError.message);
        setError(
          isClockError
            ? 'A sessão ainda está sincronizando. Toque em atualizar em alguns segundos.'
            : requestError.message || 'Não foi possível carregar os dados.',
        );
        setLoading(false);
        return;
      }
      type BankWithRelations = PiggyBankRow & {
        transactions: TransactionRow[];
        balance_snapshots: SnapshotRow[];
        bank_earning_credits: BankEarningCredit[];
      };
      const rows = (result.data ?? []) as BankWithRelations[];
      const allBanks = rows.map((bank) => ({
        ...bank,
        transactions: [...(bank.transactions ?? [])].sort((a, b) =>
          a.occurred_at.localeCompare(b.occurred_at),
        ),
        snapshots: [...(bank.balance_snapshots ?? [])].sort((a, b) =>
          a.snapshot_date.localeCompare(b.snapshot_date),
        ),
        earningCredits: [...(bank.bank_earning_credits ?? [])].sort((a, b) =>
          a.occurred_at.localeCompare(b.occurred_at),
        ),
      }));
      setBanks(allBanks.filter((bank) => !bank.archived_at));
      setArchivedBanks(allBanks.filter((bank) => bank.archived_at));
      setLoading(false);
    },
    [supabase],
  );

  const loadRates = useCallback(() => {
    return loadingFetch('/api/cdi')
      .then((r) => {
        if (!r.ok) throw new Error('CDI indisponível');
        return r.json();
      })
      .then((body) => {
        const nextRates = body.rates ?? [];
        if (!nextRates.length) throw new Error('CDI vazio');
        let cached: DailyRate[] = [];
        try {
          const stored = JSON.parse(
            localStorage.getItem('vetra:rates-cache') ?? '[]',
          );
          if (Array.isArray(stored)) cached = stored;
        } catch {}
        const merged = mergePublishedRates(cached, nextRates);
        setRates(merged);
        localStorage.setItem('vetra:rates-cache', JSON.stringify(merged));
      })
      .catch(() => {
        try {
          setRates(
            JSON.parse(localStorage.getItem('vetra:rates-cache') ?? '[]'),
          );
        } catch {
          setRates([]);
        }
      });
  }, []);

  const refreshAll = useCallback(
    async (silent = false) => {
      await Promise.all([load(silent), loadRates()]);
    },
    [load, loadRates],
  );

  useEffect(() => {
    void Promise.resolve().then(() => refreshAll());
  }, [refreshAll]);

  useResumeRefresh(() => refreshAll(true));

  const isGeneral = activeId === 'all';
  const active = isGeneral
    ? banks[0]
    : banks.find((bank) => bank.id === activeId);
  const scopedBanks = useMemo(
    () => (overview ? [] : isGeneral ? banks : active ? [active] : []),
    [overview, isGeneral, banks, active],
  );
  const viewName = isGeneral ? 'Dinheiro geral' : (active?.name ?? 'Cofrinho');
  const viewInstitution = isGeneral
    ? `${banks.length} cofrinhos`
    : (active?.bank ?? 'Carteira');
  const current = useMemo(
    () => calculatePortfolio(scopedBanks, rates),
    [scopedBanks, rates],
  );
  // Só o saldo do banco; sem o de hoje, o painel avisa em vez de estimar.
  const staleDate = staleBankDate(scopedBanks);
  const series = useMemo(
    () => buildBankSeries(scopedBanks, rates),
    [scopedBanks, rates],
  );
  const accent =
    isGeneral || !active ? 'var(--foreground)' : bankPolicy(active.bank).color;
  const calculationWarnings = useMemo(() => {
    const warnings = scopedBanks.flatMap((bank) => {
      const result = calculateRealized(bank, rates);
      const items: string[] = [];
      if (result.unfundedWithdrawals.length)
        items.push(
          `${bank.name}: há retirada maior que o saldo disponível na data. Revise os lançamentos.`,
        );
      if (bank.policy_ends_at && bank.policy_ends_at < today())
        items.push(
          `${bank.name}: a política cadastrada venceu. Confirme a renovação/taxa no banco; não simulamos resgate automático.`,
        );
      if (result.ignoredEarningCreditIds.length)
        for (const credit of bank.earningCredits?.filter((item) =>
          result.ignoredEarningCreditIds.includes(item.id),
        ) ?? [])
          items.push(
            `${bank.name}: o rendimento informado em ${dateBR(credit.occurred_at)} (${money(credit.net_amount)}) é alto demais para um único dia e não foi somado ao saldo.`,
          );
      return items;
    });
    // O teto promocional do MP é compartilhado; só avisa quando a soma passa
    // do menor teto.
    const mercadoPago = banks.filter((bank) => bank.bank === 'Mercado Pago');
    const sharedLimit = mercadoPago
      .filter((bank) => bank.rate_limit !== null)
      .map((bank) => new Decimal(bank.rate_limit!))
      .sort((a, b) => a.comparedTo(b))[0];
    const mercadoPagoTotal = mercadoPago.reduce(
      (sum, bank) => sum.plus(calculateRealized(bank, rates).grossBalance),
      new Decimal(0),
    );
    if (
      mercadoPago.length > 1 &&
      sharedLimit &&
      mercadoPagoTotal.gt(sharedLimit)
    )
      warnings.push(
        'Mercado Pago: confira o limite promocional compartilhado entre seus cofrinhos. A distribuição desse limite ainda precisa ser conciliada com o banco.',
      );
    return [...new Set(warnings)];
  }, [scopedBanks, banks, rates]);
  const awaitingRates = useMemo(() => {
    for (const bank of scopedBanks)
      if (calculateRealized(bank, rates).missingRateDates.length > 0)
        return true;
    return false;
  }, [scopedBanks, rates]);
  const statementItems = useMemo<StatementEntry[]>(() => {
    return scopedBanks
      .flatMap((bank) => {
        // Rendimento diário = saldo do banco − saldo anterior − movimentos (o que o
        // banco pagou, não o motor).
        const earnings: StatementEntry[] = snapshotEarnings(
          bank.snapshots,
          bank.transactions,
          rates,
        ).map((earning) => ({
          ...earning,
          type: 'earning',
          id: `earning-${bank.id}-${earning.id}`,
          bank,
          date: earning.date,
          grossAmount: earning.grossAmount,
          netAmount: earning.netAmount,
          taxes: earning.taxes,
        }));
        const bankMovements: StatementEntry[] = bank.transactions.map(
          (transaction) => ({
            type: 'movement',
            id: `movement-${transaction.id}`,
            bank,
            transaction,
          }),
        );
        return [...earnings, ...bankMovements];
      })
      .sort((a, b) => {
        const aDate = a.type === 'earning' ? a.date : a.transaction.occurred_at;
        const bDate = b.type === 'earning' ? b.date : b.transaction.occurred_at;
        return bDate.localeCompare(aDate) || b.type.localeCompare(a.type);
      });
  }, [scopedBanks, rates]);
  // Rendimento por mês, atuais e encerrados (estes até o dia em que saíram).
  const yieldOverview = useMemo(() => {
    if (!isGeneral) return null;
    const vaults: VaultEarnings[] = [
      ...current.results.map(({ bank, result }) => ({
        name: bank.name,
        bank: bank.bank,
        earnings: result.earnings,
      })),
      ...archivedBanks.map((bank) => ({
        name: bank.name,
        bank: bank.bank,
        archivedAt: bank.archived_at ?? undefined,
        earnings: calculate(bank, rates, new Date(bank.archived_at as string))
          .earnings,
      })),
    ];
    const months = monthlyYields(vaults);
    return {
      months,
      total: months.reduce((sum, item) => sum.plus(item.total), new Decimal(0)),
      closed: closedSummaries(vaults.filter((vault) => vault.archivedAt)),
    };
  }, [isGeneral, current, archivedBanks, rates]);
  const periodStart = useMemo(() => {
    if (dashboardPeriod === 'all') return '';
    if (dashboardPeriod === 'custom') return customStart;
    const date = calendarDate(today());
    if (dashboardPeriod === 'month') date.setDate(1);
    else date.setDate(date.getDate() - (dashboardPeriod === '7d' ? 6 : 29));
    return saoPauloDate(date);
  }, [dashboardPeriod, customStart]);
  const periodEnd = dashboardPeriod === 'custom' ? customEnd : today();
  const filteredStatement = statementItems.filter((item) => {
    const itemDate =
      item.type === 'earning' ? item.date : item.transaction.occurred_at;
    if (periodStart && itemDate.slice(0, 10) < periodStart) return false;
    if (periodEnd && itemDate.slice(0, 10) > periodEnd) return false;
    if (statementFilter === 'earnings') return item.type === 'earning';
    if (statementFilter === 'movements') return item.type === 'movement';
    return true;
  });
  const calculatedPortfolio = current;
  const earningsByDate = (start: string) =>
    portfolioEarnings(calculatedPortfolio, start, today());
  const todayEarnings = earningsByDate(today());
  const monthEarnings = earningsByDate(`${today().slice(0, 7)}-01`);
  const periodEarnings = portfolioEarnings(
    calculatedPortfolio,
    periodStart,
    periodEnd,
  );
  const totalNetEarnings = calculatedPortfolio.lifetimeNetGain;

  async function signOut() {
    await supabase.auth.signOut();
    localStorage.removeItem('vetra:dashboard-cache');
    window.location.href = '/auth';
  }
  async function archiveBank() {
    if (
      !active ||
      !window.confirm(
        `Arquivar ${active.name}? Os lançamentos serão preservados.`,
      )
    )
      return;
    await supabase
      .from('piggy_banks')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', active.id);
    setActiveId('all');
    await load();
  }
  return (
    <main
      className="min-h-screen bg-background text-foreground"
      style={{ '--brand': accent } as React.CSSProperties}
    >
      <AppHeader onRefresh={() => refreshAll(true)} onSignOut={signOut} />
      <div className="app-container min-w-0 pt-6 pb-10 md:pt-9">
        {error && (
          <div
            data-private-value
            className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm"
          >
            {error}
          </div>
        )}
        {overview ? (
          <FinanceOverview banks={banks} rates={rates} banksLoading={loading} />
        ) : loading ? (
          <DashboardDataSkeleton overview={false} />
        ) : !isGeneral && !active ? (
          <section className="rounded-3xl border bg-card p-8">
            <h1 className="text-xl font-semibold">Cofrinho não encontrado</h1>
            <p className="my-3 text-muted-foreground">
              Ele pode ter sido arquivado ou não estar disponível nesta conta.
            </p>
            <Button render={<Link href="/cofrinhos" />}>
              Voltar aos cofrinhos
            </Button>
          </section>
        ) : (
          <>
            <nav
              aria-label="Caminho da página"
              className="mb-5 flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Link href="/">Início</Link>
              <ChevronRight className="size-3" />
              <Link href="/cofrinhos">Cofrinhos</Link>
              {!isGeneral && (
                <>
                  <ChevronRight className="size-3" />
                  <span className="truncate text-foreground">
                    {active?.name}
                  </span>
                </>
              )}
            </nav>
            <section
              key={`summary-${activeId}`}
              className="mb-7 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
            >
              {calculationWarnings.length > 0 && (
                <div
                  className="mb-4 space-y-1 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground"
                  role="status"
                >
                  {calculationWarnings.map((warning) => (
                    <p key={warning} data-private-value>
                      {warning}
                    </p>
                  ))}
                </div>
              )}
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-brand" />
                  {isGeneral
                    ? `PATRIMÔNIO EM ${banks.length} COFRINHOS`
                    : `${viewInstitution.toUpperCase()} · ${viewName.toUpperCase()}`}
                </p>
                {/* Saldo líquido na cor legível do banco; a visão combinada não tem banco. */}
                <h1
                  className="text-3xl font-semibold tracking-[-0.04em] md:text-4xl"
                  style={{
                    color: isGeneral
                      ? undefined
                      : vaultTextAccent(viewInstitution),
                  }}
                >
                  <Private>{money(current.netBalance)}</Private>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Líquido ·{' '}
                  <Private>
                    {current.grossBalanceKnown
                      ? `bruto ${money(current.grossBalance)}`
                      : 'bruto não informado pelo banco'}
                  </Private>
                </p>
                {staleDate && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Valor desatualizado: o banco ainda não informou o saldo de
                    hoje. Mostrando o de {staleDate.slice(8)}/
                    {staleDate.slice(5, 7)}.
                  </p>
                )}
                {awaitingRates && (
                  <p
                    role="status"
                    className="mt-2 text-xs text-muted-foreground"
                  >
                    Sincronização automática do CDI. O saldo ainda não inclui os
                    dias com taxas pendentes.
                  </p>
                )}
              </div>
            </section>
            <div className="mb-7">
              <VaultCards
                banks={banks}
                rates={rates}
                activeId={activeId}
                onSelect={setActiveId}
              />
            </div>
            <div
              key={`vault-view-${activeId}`}
              className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
            >
              <PortfolioChart
                label={
                  isGeneral
                    ? 'EVOLUÇÃO UNIFICADA'
                    : `EVOLUÇÃO · ${active!.bank.toUpperCase()}`
                }
                total={current.netBalance}
                series={series}
                accent={isGeneral ? 'var(--hero-foreground)' : 'var(--brand)'}
              />
              {yieldOverview && yieldOverview.months.length > 0 && (
                <YieldOverview {...yieldOverview} />
              )}
              {banks.length === 0 ? (
                <Empty />
              ) : (
                <>
                  <section className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {isGeneral
                          ? 'VISÃO CONSOLIDADA'
                          : viewInstitution.toUpperCase()}
                      </p>
                      <h2 className="mt-1 text-2xl font-semibold">
                        {viewName}
                      </h2>
                    </div>
                    {/* Sem botão de sincronizar: a atualização é a da barra do topo. */}
                    <div className="flex flex-wrap gap-2">
                      {!isGeneral && (
                        <>
                          <Button
                            variant="glass-quiet"
                            onClick={() => setDetailsOpen(true)}
                          >
                            <Landmark />
                            Detalhes
                          </Button>
                          <Button variant="glass-quiet" onClick={archiveBank}>
                            <Trash2 />
                            Arquivar
                          </Button>
                        </>
                      )}
                    </div>
                  </section>
                  <section className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <PeriodMetric label="Hoje" value={money(todayEarnings)} />
                    <PeriodMetric label="No mês" value={money(monthEarnings)} />
                    <PeriodMetric
                      label="No período"
                      value={money(periodEarnings)}
                    />
                    <PeriodMetric
                      label="Desde o início"
                      value={money(totalNetEarnings)}
                    />
                  </section>
                  <section className="mb-7 grid overflow-hidden rounded-3xl border bg-border sm:grid-cols-2 lg:grid-cols-5">
                    <Metric
                      label="Investido atual"
                      value={money(current.principal)}
                    />
                    <Metric
                      label="Rendimento bruto"
                      value={
                        current.grossBalanceKnown
                          ? money(current.grossProfit)
                          : 'Não informado'
                      }
                    />
                    {/* Imposto só o que o banco informou; sem ele, nada de
                        estimativa. */}
                    <Metric
                      label="IR"
                      value={
                        current.taxesFromBank && !current.taxDetailsIncomplete
                          ? `− ${money(current.incomeTax)}`
                          : 'Não informado'
                      }
                    />
                    <Metric
                      label="IOF"
                      value={
                        current.taxesFromBank
                          ? `− ${money(current.iof)}`
                          : 'Não informado'
                      }
                    />
                    <Metric
                      label="Saldo líquido"
                      value={money(current.netBalance)}
                    />
                  </section>
                  <section className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.55fr)]">
                    <div className="min-w-0">
                      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                        <div>
                          <h2 className="text-xl font-semibold tracking-tight">
                            Movimentações
                          </h2>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Extrato de {viewName}, com o que veio do banco. O
                            rendimento de cada dia é o saldo daquele dia menos o
                            do dia anterior.
                          </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:items-end">
                          <ScrollArea
                            orientation="horizontal"
                            className="rounded-xl bg-muted"
                          >
                            <div className="flex gap-1 p-1">
                              {(
                                [
                                  ['7d', '7 dias'],
                                  ['30d', '30 dias'],
                                  ['month', 'Mês'],
                                  ['custom', 'Personalizado'],
                                  ['all', 'Tudo'],
                                ] as const
                              ).map(([value, label]) => (
                                <Button
                                  key={value}
                                  type="button"
                                  size="sm"
                                  variant={
                                    dashboardPeriod === value
                                      ? 'secondary'
                                      : 'ghost'
                                  }
                                  className="h-8 shrink-0 px-2 text-[11px]"
                                  onClick={() => setDashboardPeriod(value)}
                                >
                                  {label}
                                </Button>
                              ))}
                            </div>
                          </ScrollArea>
                          {dashboardPeriod === 'custom' && (
                            <div className="grid w-full grid-cols-2 gap-2 sm:w-[320px]">
                              <DateField
                                max={customEnd}
                                value={customStart}
                                onValueChange={setCustomStart}
                              />
                              <DateField
                                max={today()}
                                value={customEnd}
                                onValueChange={setCustomEnd}
                              />
                            </div>
                          )}
                          <div className="flex gap-1 rounded-xl bg-muted p-1">
                            {(
                              [
                                ['all', 'Tudo'],
                                ['earnings', 'Rendimentos'],
                                ['movements', 'Movimentações'],
                              ] as const
                            ).map(([value, label]) => (
                              <Button
                                key={value}
                                type="button"
                                size="sm"
                                variant={
                                  statementFilter === value
                                    ? 'secondary'
                                    : 'ghost'
                                }
                                className="h-8 px-2 text-[11px]"
                                onClick={() => setStatementFilter(value)}
                              >
                                {label}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {/* Limite no viewport (quem rola), não na raiz. */}
                      <ScrollArea
                        className="overflow-hidden rounded-2xl bg-card"
                        viewportClassName="max-h-[640px] p-1 sm:p-2"
                      >
                        {filteredStatement.length === 0 ? (
                          <p className="p-8 text-center text-sm text-muted-foreground">
                            Nenhum lançamento neste filtro.
                          </p>
                        ) : (
                          filteredStatement.map((item) =>
                            item.type === 'earning' ? (
                              <EarningMovement key={item.id} entry={item} />
                            ) : (
                              <Movement
                                key={item.id}
                                bank={item.bank}
                                transaction={item.transaction}
                              />
                            ),
                          )
                        )}
                      </ScrollArea>
                    </div>
                    <Summary
                      banks={scopedBanks}
                      rates={rates}
                      viewName={viewName}
                    />
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {active && !isGeneral && (
        <>
          <VaultDetailsDialog
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            bank={active}
            rates={rates}
          />
        </>
      )}
    </main>
  );
}

const monthLabel = (month: string) => {
  const label = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: SAO_PAULO_TIME_ZONE,
  }).format(new Date(`${month}-15T12:00:00-03:00`));
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/** "Quanto você já ganhou" por mês, discreto: é consulta. */
function YieldOverview({
  months,
  total,
  closed,
}: {
  months: MonthYield[];
  total: Decimal;
  closed: ClosedSummary[];
}) {
  return (
    <section className="mb-6 rounded-2xl border border-border/60 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium text-muted-foreground">
          QUANTO VOCÊ JÁ GANHOU
        </h2>
        <p className="text-sm font-medium tabular-nums">
          <Private>+ {money(total)}</Private>
        </p>
      </div>
      <dl className="mt-1 divide-y divide-border/40 text-xs">
        {months.map((item) => (
          <div
            key={item.month}
            className="flex items-center justify-between gap-3 py-1.5"
          >
            <dt className="text-muted-foreground">{monthLabel(item.month)}</dt>
            <dd className="tabular-nums">
              <Private>+ {money(item.total)}</Private>
            </dd>
          </div>
        ))}
      </dl>
      {closed.length > 0 && (
        <div className="mt-2 border-t border-border/40 pt-2">
          <h3 className="text-[11px] font-medium text-muted-foreground">
            ENCERRADOS
          </h3>
          <ul className="divide-y divide-border/40 text-xs">
            {closed.map((item) => (
              <li
                key={item.key}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {item.label} · {item.detail.toLowerCase()}
                </span>
                <span className="shrink-0 tabular-nums">
                  <Private>+ {money(item.total)}</Private>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Empty() {
  return (
    <section className="grid min-h-[360px] place-items-center rounded-3xl border bg-card p-8 text-center">
      <div>
        <Landmark className="mx-auto size-7" />
        <h2 className="mt-4 text-xl font-semibold">Nenhum cofrinho ainda</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Os cofrinhos vêm do banco: aparecem aqui sozinhos na próxima
          sincronização.
        </p>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-5 md:p-6">
      <p className="text-xs font-medium text-muted-foreground">
        {label.toUpperCase()}
      </p>
      <p data-private-value className="mt-3 text-lg font-semibold">
        {value}
      </p>
    </div>
  );
}

function PeriodMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-3 sm:p-4">
      <p className="truncate text-[9px] font-medium text-muted-foreground sm:text-[10px]">
        {label.toUpperCase()}
      </p>
      <p
        data-private-value
        className="mt-2 truncate text-xs font-semibold sm:text-base"
      >
        +{value}
      </p>
    </div>
  );
}

/**
 * Gráfico de rendimento dos cofrinhos: o rendimento líquido do último dia que
 * o banco informou, o saldo e colunas por dia útil (o último em cor). Só dado
 * do banco, nada previsto. Tocar mostra o valor. 7 colunas no celular, 14 no
 * computador.
 */
function PortfolioChart({
  label,
  total,
  series,
  accent,
}: {
  label: string;
  total: Decimal;
  series: ReturnType<typeof buildBankSeries>;
  /** Coluna do último dia: o card é escuro nos dois temas, então a cor tem de ler no escuro. */
  accent: string;
}) {
  const LAST = series.points.length - 1;
  // Só dias úteis: o IOF do fim de semana cai na segunda.
  const rows = series.points.map((point, index) => {
    const previous = series.points[index - 1];
    const gapDays = previous
      ? Math.round(
          (point.date.getTime() - previous.date.getTime()) / 86_400_000,
        )
      : 1;
    return {
      label: point.today ? 'Hoje' : shortDate(point.date),
      gain: point.dailyNetGain.toNumber(),
      last: index === LAST,
      weekend: gapDays > 1,
    };
  });
  const lastPoint = series.points[LAST];
  // Every column starts at zero; a small floor keeps a zero day visible.
  const peak = Math.max(...rows.map((row) => row.gain), 0);

  return (
    <section className="mb-7 overflow-hidden rounded-3xl bg-hero p-5 text-hero-foreground sm:p-6 md:p-8">
      <p className="text-xs text-hero-foreground/55">{label}</p>
      <p className="mt-2 text-3xl font-semibold">
        <Private>+{money(lastPoint.dailyNetGain)}</Private>
      </p>
      <p className="mt-1 text-sm text-hero-foreground/55">
        {lastPoint.today
          ? 'Rendeu hoje'
          : `Rendeu em ${shortDate(lastPoint.date)}`}{' '}
        · saldo <Private>{money(total)}</Private>
      </p>

      <div className="mt-6 grid grid-cols-7 items-end gap-2 md:grid-cols-14 md:gap-3">
        {rows.map((row, index) => {
          const height = peak ? Math.max(6, (row.gain / peak) * 100) : 6;
          return (
            <div
              key={index}
              className={`${index < LAST - 6 ? 'hidden md:grid' : 'grid'} min-w-0 gap-2`}
            >
              <div className="flex h-28 items-end md:h-40">
                {/* Popover, não Tooltip: o tooltip do Base UI não abre no toque. */}
                <Popover>
                  <PopoverTrigger
                    openOnHover
                    delay={0}
                    render={
                      <button
                        aria-label={`${row.label}: ${money(row.gain)}`}
                        className={`w-full rounded-t-md ${row.last ? '' : 'bg-hero-foreground/25'}`}
                        style={{
                          height: `${height}%`,
                          background: row.last ? accent : undefined,
                        }}
                      />
                    }
                  />
                  <PopoverContent
                    side="top"
                    className="w-auto gap-0.5 p-2 text-xs"
                  >
                    <span className="font-medium">{row.label}</span>
                    <span>
                      <Private>+{money(row.gain)}</Private>
                      {row.weekend && ' (com o fim de semana)'}
                    </span>
                  </PopoverContent>
                </Popover>
              </div>
              <span
                className={`block truncate text-center text-[10px] tabular-nums ${row.last ? 'font-semibold text-hero-foreground' : 'text-hero-foreground/50'}`}
              >
                {row.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EarningMovement({
  entry,
}: {
  entry: Extract<StatementEntry, { type: 'earning' }>;
}) {
  return (
    <StatementItem
      title="Rendimentos"
      icon={<CircleDollarSign />}
      bank={entry.bank}
      amount={entry.netAmount}
      date={entry.date}
      status={
        entry.distributed
          ? 'Saldo do banco, dividido por dia'
          : 'Saldo do banco'
      }
    >
      <dl className="divide-y divide-border/60">
        <StatementDetail
          label="Origem"
          value={
            entry.distributed
              ? 'Parte do rendimento entre dois saldos do banco, dividida pelos dias úteis'
              : 'Saldo do dia menos o do dia anterior'
          }
        />
        <StatementDetail
          label="Rendimento líquido"
          value={money(entry.netAmount)}
        />
        <StatementDetail
          label="Rendimento bruto"
          value={
            entry.grossAmount === null
              ? 'Não informado'
              : money(entry.grossAmount)
          }
        />
        <StatementDetail
          label="Imposto de Renda (IR)"
          value={
            entry.incomeTax === undefined
              ? 'Não informado'
              : money(entry.incomeTax)
          }
        />
        <StatementDetail
          label="IOF"
          value={entry.iof === undefined ? 'Não informado' : money(entry.iof)}
        />
        <StatementDetail
          label="Variação total de impostos"
          value={entry.taxes === null ? 'Não informada' : money(entry.taxes)}
        />
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Diferença entre o saldo que o banco informou neste dia e o saldo
        anterior, descontando o que entrou e saiu no intervalo. Se entre os dois
        houve fim de semana ou um dia sem sincronizar, o rendimento do intervalo
        inteiro aparece aqui. IR e IOF são a variação dos impostos que o banco
        reteria num resgate.
      </p>
    </StatementItem>
  );
}

function Movement({
  bank,
  transaction,
}: {
  bank: PiggyBank;
  transaction: TransactionRow;
}) {
  const meta =
    transaction.kind === 'deposit'
      ? { label: 'Dinheiro reservado', icon: <PiggyBankIcon /> }
      : transaction.kind === 'withdrawal'
        ? { label: 'Retirada', icon: <ArrowDownRight /> }
        : { label: 'Ajuste de saldo', icon: <Settings2 /> };
  const amount = new Decimal(transaction.amount);
  return (
    <StatementItem
      title={meta.label}
      icon={meta.icon}
      bank={bank}
      amount={
        transaction.kind === 'withdrawal' ? amount.abs().negated() : amount
      }
      date={transaction.occurred_at}
      occurredAt={transaction.occurred_at}
      preview={
        transaction.kind === 'deposit' ? (
          <IofCountdown bank={bank} occurredAt={transaction.occurred_at} />
        ) : undefined
      }
    >
      <dl className="divide-y divide-border/60">
        <StatementDetail
          label="Tipo"
          value={transaction.kind === 'deposit' ? 'Aporte' : meta.label}
        />
        <StatementDetail label="Valor registrado" value={money(amount.abs())} />
        <StatementDetail
          label="Registrado em"
          value={statementDate(transaction.created_at, true, true)}
        />
      </dl>
      {transaction.kind === 'deposit' && (
        <section className="rounded-2xl border bg-muted/30 p-4">
          <h3 className="text-sm font-medium">Prazo do IOF deste aporte</h3>
          <IofCountdown bank={bank} occurredAt={transaction.occurred_at} />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {bank.iof_rule}
          </p>
        </section>
      )}
      {transaction.note && (
        <section>
          <h3 className="text-sm font-medium">Observação</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {transaction.note}
          </p>
        </section>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Movimentação lida do banco. Não movimenta dinheiro na sua conta.
      </p>
    </StatementItem>
  );
}

function statementDate(value: string, withTime = false, full = false) {
  const date = new Date(
    value.length === 10 ? `${value}T12:00:00-03:00` : value,
  );
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    ...(full ? { year: 'numeric' as const } : {}),
  })
    .format(date)
    .replaceAll(' de ', ' ')
    .replace('.', '');
  if (!withTime) return day;
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(':', 'h');
  return `${day}, ${time}`;
}

function StatementDetail({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        data-private-value
        className="min-w-0 break-words text-right font-medium tabular-nums"
      >
        {value}
      </dd>
    </div>
  );
}

function StatementItem({
  title,
  icon,
  bank,
  amount,
  date,
  occurredAt,
  status,
  preview,
  onActivate,
  children,
}: {
  title: string;
  icon: ReactNode;
  bank: PiggyBank;
  amount: Decimal;
  date: string;
  occurredAt?: string;
  status?: string;
  preview?: ReactNode;
  onActivate?: () => void;
  children: ReactNode;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formattedAmount = `${amount.isNegative() ? '−' : '+'} ${money(amount.abs())}`;
  const amountColor = amount.gt(0)
    ? 'text-green-700 dark:text-green-400'
    : 'text-foreground';
  const triggerClassName =
    'group grid min-h-24 w-full grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl px-2 py-5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:gap-x-4 sm:px-4 sm:py-6';
  const triggerLabel = `${title}, ${formattedAmount}, ${bank.name}, ${statementDate(occurredAt ?? date, !!occurredAt, true)}. ${onActivate ? 'Editar rendimento' : 'Ver detalhes'}`;
  const triggerContent = (
    <>
      <span className="row-span-2 grid size-10 place-items-center rounded-full border-2 border-foreground/15 text-foreground sm:size-14 [&_svg]:size-5 [&_svg]:stroke-[1.5] sm:[&_svg]:size-7">
        {icon}
      </span>
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-start gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-sm font-semibold leading-snug sm:text-base">
          {title}
        </span>
        <span
          className={`min-w-0 break-all text-right text-sm font-semibold leading-snug tabular-nums sm:text-base ${amountColor}`}
        >
          <Private>{formattedAmount}</Private>
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground sm:text-xs">
          {bank.name}
        </span>
        <span className="text-right text-[11px] text-muted-foreground sm:text-xs">
          {statementDate(occurredAt ?? date, !!occurredAt)}
        </span>
      </span>
      {(status || preview) && (
        <span className="col-start-2 min-w-0">
          {status && (
            <span className="text-[10px] text-muted-foreground">{status}</span>
          )}
          {preview}
        </span>
      )}
    </>
  );
  if (onActivate)
    return (
      <button
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        onClick={onActivate}
      >
        {triggerContent}
      </button>
    );
  return (
    <Dialog>
      <DialogTrigger
        render={<button type="button" aria-label={triggerLabel} />}
        className={triggerClassName}
        aria-label={triggerLabel}
      >
        {triggerContent}
      </DialogTrigger>
      <DialogContent
        initialFocus={titleRef}
        className="rounded-3xl p-5 sm:max-w-xl sm:p-6"
      >
        <DialogHeader>
          <span
            aria-hidden="true"
            className="mb-2 grid size-12 place-items-center rounded-full border-2 border-foreground/15 [&_svg]:size-6 [&_svg]:stroke-[1.5]"
          >
            {icon}
          </span>
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="text-xl outline-none"
          >
            {title}
          </DialogTitle>
          <DialogDescription>
            {bank.bank} · {bank.name}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">
            {status ?? 'Movimentação registrada'}
          </p>
          <p
            className={`mt-1 break-all text-3xl font-semibold tracking-tight tabular-nums ${amountColor}`}
          >
            <Private>{formattedAmount}</Private>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {statementDate(occurredAt ?? date, !!occurredAt, true)}
            {occurredAt ? ' · São Paulo' : ''}
          </p>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function IofCountdown({
  bank,
  occurredAt,
}: {
  bank: PiggyBank;
  occurredAt: string;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const frame = window.requestAnimationFrame(update);
    const timer = window.setInterval(update, 60_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);
  const exempt = bank.iof_rule.toLowerCase().includes('isento');
  const deadline = iofExemptionAt(occurredAt).getTime();
  const remaining = now ? Math.max(0, deadline - now) : 0;
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const finished = exempt || (now > 0 && remaining === 0);
  return (
    <span className="mt-2 inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-[10px] font-medium text-muted-foreground">
      <CalendarDays className="size-3" />
      {finished
        ? 'IOF zerado'
        : now
          ? `IOF zero em ${days}d ${hours}h ${minutes}min`
          : 'Calculando IOF…'}
    </span>
  );
}

function Summary({
  banks,
  rates,
  viewName,
}: {
  banks: PiggyBank[];
  rates: DailyRate[];
  viewName: string;
}) {
  const total = banks.reduce(
    (sum, bank) => sum.plus(calculateRealized(bank, rates).netBalance),
    new Decimal(0),
  );
  return (
    <aside className="space-y-4">
      <div className="rounded-3xl border bg-card p-5">
        <p className="text-xs text-muted-foreground">
          COMPOSIÇÃO · {viewName.toUpperCase()}
        </p>
        <div className="mt-5 space-y-5">
          {banks.map((bank) => {
            const value = calculateRealized(bank, rates).netBalance;
            const share = total.gt(0)
              ? value.div(total).mul(100)
              : new Decimal(0);
            return (
              <div key={bank.id}>
                <div className="flex justify-between text-sm">
                  <span>{bank.bank}</span>
                  <strong>{share.toDecimalPlaces(0).toString()}%</strong>
                </div>
                <div className="mt-2 h-1 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${share.toNumber()}%`,
                      background: bankPolicy(bank.bank).color,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {bank.name} · <Private>{money(value)}</Private>
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function DateField({
  value,
  onValueChange,
  max,
}: {
  value: string;
  onValueChange: (value: string) => void;
  max?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-between bg-transparent px-3 font-normal"
          />
        }
      >
        <span>{value ? dateBR(value) : 'Selecione uma data'}</span>
        <CalendarDays className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={ptBR}
          timeZone={SAO_PAULO_TIME_ZONE}
          selected={value ? calendarDate(value) : undefined}
          disabled={max ? { after: calendarDate(max) } : undefined}
          onSelect={(date) => {
            if (!date) return;
            onValueChange(saoPauloDate(date));
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
