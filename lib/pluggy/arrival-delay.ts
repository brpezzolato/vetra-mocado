// Quanto as compras de cada banco costumam levar para chegar ao Vetra (o
// PicPay publica no Open Finance com 2–3 dias de atraso; o Itaú, em horas).
// Medido nos próprios lançamentos: `created_at − occurred_at`. Puro.

const HOUR_MS = 3_600_000;
/** Acima disso não é atraso do banco: é lançamento antigo que veio depois. */
const MAX_DELAY_MS = 10 * 24 * HOUR_MS;
/** Com menos que isso, a mediana ainda não diz nada. */
export const MIN_SAMPLES = 3;

export type ArrivalRow = { occurred_at: string; created_at: string };

/**
 * Mediana, em horas, do tempo entre a compra e a chegada ao Vetra. Só conta
 * compra feita depois da primeira chegada do cartão (a importação inicial
 * traz semanas de uma vez e não é atraso). `null` com poucas amostras.
 */
export function typicalDelayHours(rows: ArrivalRow[]): number | null {
  if (!rows.length) return null;
  const firstArrival = Math.min(
    ...rows.map((row) => Date.parse(row.created_at)),
  );
  const delays = rows
    .filter((row) => Date.parse(row.occurred_at) > firstArrival)
    .map((row) => Date.parse(row.created_at) - Date.parse(row.occurred_at))
    .filter((delay) => delay >= 0 && delay <= MAX_DELAY_MS)
    .sort((a, b) => a - b);
  if (delays.length < MIN_SAMPLES) return null;
  const middle = Math.floor(delays.length / 2);
  const median =
    delays.length % 2
      ? delays[middle]!
      : (delays[middle - 1]! + delays[middle]!) / 2;
  return Math.round(median / HOUR_MS);
}

/** "Compras chegam em ~2 dias", para o selo de Conexões. */
export function delayLabel(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 2) return 'Compras chegam quase na hora';
  if (hours < 24) return `Compras chegam em ~${hours} h`;
  const days = Math.round(hours / 24);
  return `Compras chegam em ~${days} ${days === 1 ? 'dia' : 'dias'}`;
}
