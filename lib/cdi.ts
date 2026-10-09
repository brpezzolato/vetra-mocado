import Decimal from 'decimal.js';
import type { DailyRate } from './domain';

export function mergePublishedRates(
  cached: DailyRate[],
  incoming: DailyRate[],
) {
  // A short-window fallback must not erase the existing historical series.
  const merged = new Map(cached.map((entry) => [entry.date, entry.rate]));
  for (const entry of incoming) merged.set(entry.date, entry.rate);
  return [...merged]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rate]) => ({ date, rate }));
}

export type BcbRate = { data: string; valor: string };

export function normalizeBcbRates(source: BcbRate[]) {
  const unique = new Map<string, string>();
  for (const item of source) {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(item.data))
      throw new Error('Data inválida na série CDI.');
    const [day, month, year] = item.data.split('/');
    const date = `${year}-${month}-${day}`;
    const parsed = new Date(`${date}T12:00:00Z`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    )
      throw new Error('Data inexistente na série CDI.');
    const dailyPercent = new Decimal(item.valor.replace(',', '.'));
    if (!dailyPercent.isFinite() || dailyPercent.isNegative())
      throw new Error('Taxa CDI inválida.');
    const rate = dailyPercent.toFixed(10);
    if (unique.has(date) && unique.get(date) !== rate)
      throw new Error('Taxas CDI conflitantes para a mesma data.');
    unique.set(date, rate);
  }
  return [...unique]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rate]) => ({ date, rate }));
}
