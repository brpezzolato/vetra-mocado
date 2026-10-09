import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinancialEntry } from './financial-tracker';
import { toTotalsView } from './entry-share';

// Reads every page so totals never stop at 500 entries.
// Exclui por padrão os "fora das contas" (somem do resumo, gráficos,
// calendário, simulador e Vetra AI); fatura e lista pedem todos. Compra
// dividida vem com a parte em `amount` e o cheio em `full_amount`
// (lib/entry-share.ts); quem pede os de fora recebe o valor cheio.
export async function loadFinancialEntries(
  client: SupabaseClient,
  { includeExcluded = false }: { includeExcluded?: boolean } = {},
) {
  const entries: FinancialEntry[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from('financial_entries').select('*');
    if (!includeExcluded) query = query.eq('excluded_from_totals', false);
    const { data, error } = await query
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    const rows = (data ?? []) as FinancialEntry[];
    entries.push(...(includeExcluded ? rows : rows.map(toTotalsView)));
    if (!data || data.length < pageSize) return { data: entries, error: null };
  }
}
