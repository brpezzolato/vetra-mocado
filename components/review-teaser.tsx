'use client';

import { useEffect, useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import Link from '@/components/navigation-link';
import { ArrowRightSymbol } from '@/components/ui/glass-button';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { reviewQueue } from '@/lib/review-queue';
import { createClient } from '@/lib/supabase/client';

/** O convite da fila de revisão na home: só aparece quando há lojas para
 * revisar (lib/review-queue.ts). */
export function ReviewTeaser({ entries }: { entries: FinancialEntry[] }) {
  const supabase = useMemo(() => createClient(), []);
  // As lojas puladas ou resolvidas (`rv:`) e as que ele já categorizou
  // (`merchant_rules`): a mesma régua da página da fila.
  const [state, setState] = useState<{
    skipped: Set<string>;
    taught: Set<string>;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      supabase
        .from('expense_reviews')
        .select('pair_key')
        .like('pair_key', 'rv:%'),
      supabase.from('merchant_rules').select('merchant'),
    ]).then(([skipped, rules]) => {
      if (!alive) return;
      setState({
        skipped: new Set(
          (skipped.data ?? []).map((row) => row.pair_key as string),
        ),
        taught: new Set((rules.data ?? []).map((row) => String(row.merchant))),
      });
    });
    return () => {
      alive = false;
    };
  }, [supabase]);
  const count = useMemo(
    () =>
      state
        ? reviewQueue(entries, state.skipped, undefined, state.taught).length
        : 0,
    [entries, state],
  );
  if (!count) return null;
  return (
    <section className="flex items-center gap-3 rounded-3xl border bg-card px-5 py-4 shadow-sm md:px-6">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-400">
        <ListChecks aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">
          {count === 1 ? '1 loja para revisar' : `${count} lojas para revisar`}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Sem categoria ou com nome estranho. Cada uma ensina o app.
        </p>
      </div>
      <Link
        href="/revisao"
        className="vetra-glass inline-flex min-h-9 shrink-0 items-center gap-1.5 px-3 text-xs font-medium"
      >
        <span className="hidden min-[430px]:inline">Revisar</span>
        <ArrowRightSymbol className="size-3.5" />
      </Link>
    </section>
  );
}
