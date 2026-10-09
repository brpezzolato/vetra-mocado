'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergePublishedRates } from '@/lib/cdi';
import type { DailyRate, PiggyBank } from '@/lib/domain';
import { loadingFetch } from '@/lib/loading-activity';
import { createClient } from '@/lib/supabase/client';
import { normalizedBank, type BankWithRelations } from '@/lib/vault-shape';

export { normalizedBank };

/**
 * Active vaults (Supabase) and the CDI series (/api/cdi merged over the
 * browser cache), loaded like the home does.
 */
export function useVaultData() {
  const client = useMemo(() => createClient(), []);
  const [banks, setBanks] = useState<PiggyBank[]>([]);
  const [rates, setRates] = useState<DailyRate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [bankResult, rateResult] = await Promise.allSettled([
      client
        .from('piggy_banks')
        .select(
          '*, transactions(*), balance_snapshots(*), bank_earning_credits(*)',
        )
        .is('archived_at', null)
        .order('created_at'),
      loadingFetch('/api/cdi').then(async (response) => {
        if (!response.ok) throw new Error('CDI indisponível');
        return ((await response.json()) as { rates?: DailyRate[] }).rates ?? [];
      }),
    ]);
    if (bankResult.status === 'fulfilled' && !bankResult.value.error)
      setBanks(
        ((bankResult.value.data ?? []) as BankWithRelations[]).map(
          normalizedBank,
        ),
      );
    let cached: DailyRate[] = [];
    try {
      const stored = JSON.parse(
        localStorage.getItem('vetra:rates-cache') ?? '[]',
      );
      if (Array.isArray(stored)) cached = stored;
    } catch {}
    const remote = rateResult.status === 'fulfilled' ? rateResult.value : [];
    const merged = mergePublishedRates(cached, remote);
    setRates(merged);
    try {
      if (remote.length)
        localStorage.setItem('vetra:rates-cache', JSON.stringify(merged));
    } catch {}
    setLoading(false);
  }, [client]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return { banks, rates, loading, reload: load };
}
