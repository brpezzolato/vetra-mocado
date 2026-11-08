'use client';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import { AppHeader } from '@/components/app-header';
import { loadingFetch } from '@/lib/loading-activity';
import { DashboardDataSkeleton } from '@/components/data-skeletons';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
} from 'react';
import Link from '@/components/navigation-link';
import { FinanceOverview } from '@/components/finance-overview';
import { VaultCards } from '@/components/vault-cards';
import Decimal from 'decimal.js';
import { ChevronRight, Landmark, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type {
  DailyRate,
  PiggyBank,
  PiggyBankRow,
  SnapshotRow,
  TransactionRow,
  BankEarningCredit,
} from '@/lib/domain';
import { snapshotEarnings } from '@/lib/snapshot-earnings';
import {
  closedSummaries,
  monthlyYields,
  type VaultEarnings,
} from '@/lib/vault-history';
import { bankPolicy } from '@/lib/domain';
import { calculate } from '@/lib/finance';
import {
  buildPortfolioSeries as portfolioSeries,
  calculatePortfolio,
  calculateRealized,
  portfolioEarnings,
  staleBankDate,
} from '@/lib/portfolio';
import { mergePublishedRates } from '@/lib/cdi';
import { VaultDetailsDialog } from '@/components/dashboard-tools';
import { Button } from '@/components/ui/button';
import { Private } from '@/components/private-value';
import { ScrollArea } from '@/components/ui/scroll-area';
import { money } from '@/lib/money';

import { saoDate } from '@/lib/expense-insights';
import { dateBR, vaultTextAccent } from '@/lib/vault-display';
import {
  YieldOverview,
  Empty,
  Metric,
  PeriodMetric,
  PortfolioChart,
  Summary,
} from '@/components/vault-overview';
import {
  EarningMovement,
  Movement,
  type StatementEntry,
} from '@/components/vault-statement';
import { DateInput } from '@/components/date-input';

const today = () => saoDate(new Date());
const calendarDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00-03:00`);

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
    () => portfolioSeries(scopedBanks, rates),
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
    return saoDate(date);
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
                <output className="mb-4 block space-y-1 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
                  {calculationWarnings.map((warning) => (
                    <span key={warning} className="block" data-private-value>
                      {warning}
                    </span>
                  ))}
                </output>
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
                  <output className="mt-2 block text-xs text-muted-foreground">
                    Sincronização automática do CDI. O saldo ainda não inclui os
                    dias com taxas pendentes.
                  </output>
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
                    <Metric
                      label={
                        current.taxesFromBank ? 'IR (banco)' : 'IR estimado'
                      }
                      value={
                        current.taxDetailsIncomplete
                          ? 'Não informado'
                          : `− ${money(current.incomeTax)}`
                      }
                    />
                    <Metric
                      label={
                        current.taxesFromBank ? 'IOF (banco)' : 'IOF estimado'
                      }
                      value={`− ${money(current.iof)}`}
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
                              <label
                                htmlFor="vault-period-start"
                                className="sr-only"
                              >
                                Início do período
                              </label>
                              <DateInput
                                id="vault-period-start"
                                max={customEnd}
                                value={customStart}
                                onValueChange={setCustomStart}
                              />
                              <label
                                htmlFor="vault-period-end"
                                className="sr-only"
                              >
                                Fim do período
                              </label>
                              <DateInput
                                id="vault-period-end"
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
