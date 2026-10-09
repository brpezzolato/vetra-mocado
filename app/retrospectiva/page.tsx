import { redirect } from 'next/navigation';
import { MonthlyRecapView } from '@/components/monthly-recap-view';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { AllowanceDay } from '@/lib/daily-allowance';
import { createClient } from '@/lib/supabase/server';

export default async function RecapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const [entries, allowances] = await Promise.all([
    loadFinancialEntries(supabase),
    // Os valores do dia do "Hoje você pode", para a sequência no azul.
    supabase.from('daily_allowances').select('day, allowance'),
  ]);
  return (
    <MonthlyRecapView
      entries={(entries.data ?? []) as FinancialEntry[]}
      allowances={(allowances.data ?? []) as AllowanceDay[]}
    />
  );
}
