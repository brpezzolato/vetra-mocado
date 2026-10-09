'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { FinanceOverview } from '@/components/finance-overview';
import { createClient } from '@/lib/supabase/client';
import { loadingFetch } from '@/lib/loading-activity';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import { useEntriesPulse } from '@/lib/use-entries-pulse';
import { mergePublishedRates } from '@/lib/cdi';
import type {
  BankEarningCredit,
  DailyRate,
  PiggyBank,
  PiggyBankRow,
  SnapshotRow,
  TransactionRow,
} from '@/lib/domain';

type BankWithRelations = PiggyBankRow & {
  transactions: TransactionRow[];
  balance_snapshots: SnapshotRow[];
  bank_earning_credits: BankEarningCredit[];
};

function normalizedBank(bank: BankWithRelations): PiggyBank {
  const { balance_snapshots, bank_earning_credits, ...row } = bank;
  return {
    ...row,
    transactions: [...(row.transactions ?? [])].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at),
    ),
    snapshots: [...(balance_snapshots ?? [])].sort((a, b) =>
      a.snapshot_date.localeCompare(b.snapshot_date),
    ),
    earningCredits: [...(bank_earning_credits ?? [])].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at),
    ),
  };
}

export function HomeDashboard() {
  const client = useMemo(() => createClient(), []);
  const [banks, setBanks] = useState<PiggyBank[]>([]);
  const [rates, setRates] = useState<DailyRate[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);
  const [error, setError] = useState('');
  // O "Novo lançamento", aberto pelo "+" da barra.
  const [entryOpen, setEntryOpen] = useState(false);

  const loadBanks = useCallback(async () => {
    const request = () =>
      client
        .from('piggy_banks')
        .select(
          '*, transactions(*), balance_snapshots(*), bank_earning_credits(*)',
        )
        .is('archived_at', null)
        .order('created_at');
    let result = await request();
    if (/jwt issued at future/i.test(result.error?.message ?? '')) {
      await client.auth.refreshSession();
      result = await request();
    }
    if (result.error) throw result.error;
    setBanks(((result.data ?? []) as BankWithRelations[]).map(normalizedBank));
  }, [client]);

  const loadRates = useCallback(async () => {
    const response = await loadingFetch('/api/cdi');
    if (!response.ok) throw new Error('CDI indisponível');
    const body = (await response.json()) as { rates?: DailyRate[] };
    const remote = body.rates ?? [];
    if (!remote.length) throw new Error('CDI vazio');
    let cached: DailyRate[] = [];
    try {
      const stored = JSON.parse(
        localStorage.getItem('vetra:rates-cache') ?? '[]',
      );
      if (Array.isArray(stored)) cached = stored;
    } catch {}
    const merged = mergePublishedRates(cached, remote);
    setRates(merged);
    localStorage.setItem('vetra:rates-cache', JSON.stringify(merged));
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    const [bankResult] = await Promise.allSettled([loadBanks(), loadRates()]);
    if (bankResult.status === 'rejected')
      setError('Não foi possível carregar seus cofrinhos.');
    setBanksLoading(false);
  }, [loadBanks, loadRates]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const cached = JSON.parse(
          localStorage.getItem('vetra:rates-cache') ?? '[]',
        );
        if (Array.isArray(cached)) setRates(cached);
      } catch {}
      void refresh();
    });
  }, [refresh]);
  useResumeRefresh(refresh);
  // A home se atualiza sozinha quando chega lançamento novo (lib/use-
  // entries-pulse.ts).
  useEntriesPulse();

  // overflow-x-clip: rede de segurança para nada na home a fazer arrastar
  // de lado. `clip`, e não `hidden`, para não virar container de rolagem e
  // não quebrar o cabeçalho sticky.
  return (
    <main className="min-h-screen overflow-x-clip bg-background text-foreground">
      <AppHeader onRefresh={refresh} onAdd={() => setEntryOpen(true)} />
      <div className="app-container min-w-0 pt-6 pb-10 md:pt-9">
        {error && (
          <div className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            {error}
          </div>
        )}
        <FinanceOverview
          entryOpen={entryOpen}
          onEntryOpenChange={setEntryOpen}
          banks={banks}
          rates={rates}
          banksLoading={banksLoading}
        />
      </div>
    </main>
  );
}
