import { normalizeBcbRates, type BcbRate } from '@/lib/cdi';
import type { DailyRate } from '@/lib/domain';

const toBcbDate = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);

/**
 * CDI (SGS 12) direto do BC, no servidor (/api/cdi e Vetra AI). Dez anos com
 * cache longo + últimos 30 dias com cache curto. Lança se as duas falharem.
 */
export async function fetchCdiRates(): Promise<{
  rates: DailyRate[];
  historyComplete: boolean;
}> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 10);
  const recentStart = new Date(end);
  recentStart.setUTCDate(recentStart.getUTCDate() - 30);
  const fetchSeries = async (from: Date, revalidate: number) => {
    const url = new URL(
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados',
    );
    url.searchParams.set('formato', 'json');
    url.searchParams.set('dataInicial', toBcbDate(from));
    url.searchParams.set('dataFinal', toBcbDate(end));
    const response = await fetch(url, {
      next: { revalidate },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`BCB ${response.status}`);
    return normalizeBcbRates((await response.json()) as BcbRate[]);
  };
  // Refresh recent publications independently of the large historical cache.
  const [history, recent] = await Promise.allSettled([
    fetchSeries(start, 21600),
    fetchSeries(recentStart, 300),
  ]);
  const merged = new Map<string, string>();
  for (const result of [history, recent])
    if (result.status === 'fulfilled')
      for (const rate of result.value) merged.set(rate.date, rate.rate);
  const rates = [...merged]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rate]) => ({ date, rate }));
  if (!rates.length) throw new Error('BCB retornou uma série vazia.');
  return { rates, historyComplete: history.status === 'fulfilled' };
}
