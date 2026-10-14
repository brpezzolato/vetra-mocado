// A previsão aprende com o banco: para cada saldo, `snapshotAudits` registra
// quanto o motor teria previsto desde o saldo anterior. A razão real/previsto
// nos últimos intervalos é um fator de correção que acompanha mudanças de
// taxa, convenção ou arredondamento.
import Decimal from 'decimal.js';
import type { SnapshotRow, TransactionRow } from './domain';

export type ForecastAudit = {
  snapshot: SnapshotRow;
  grossDifference: Decimal;
};

export type ForecastLearning = {
  /** Multiplica o rendimento projetado. 1 quando não há o que aprender. */
  factor: Decimal;
  /** Quantos intervalos do banco entraram na conta. */
  samples: number;
  /** Erro médio por intervalo sem e com correção (reais, bruto). */
  errorBefore: Decimal | null;
  errorAfter: Decimal | null;
  /** Acerto de 0 a 1: 1 − Σ erros ÷ Σ pago pelo banco (com a correção, se aplicada). */
  accuracy: Decimal | null;
};

const WINDOW = 20;
const MIN_SAMPLES = 3;
// Fora disto é saldo estranho (resgate não registrado), não ajuste de taxa.
const MIN_FACTOR = new Decimal('0.8');
const MAX_FACTOR = new Decimal('1.2');

const day = (iso: string) => iso.slice(0, 10);

export function learnForecast(
  audits: ForecastAudit[],
  snapshots: SnapshotRow[],
  transactions: TransactionRow[],
): ForecastLearning {
  const sorted = [...snapshots].sort((a, b) =>
    a.snapshot_date.localeCompare(b.snapshot_date),
  );
  const byId = new Map(audits.map((audit) => [audit.snapshot.id, audit]));
  const pairs: { actual: Decimal; predicted: Decimal }[] = [];
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const audit = byId.get(current.id);
    if (!audit) continue;
    const flows = transactions.reduce((sum, transaction) => {
      const when = day(transaction.occurred_at);
      if (when <= previous.snapshot_date || when > current.snapshot_date)
        return sum;
      if (transaction.kind === 'deposit') return sum.plus(transaction.amount);
      if (transaction.kind === 'withdrawal')
        return sum.minus(transaction.amount);
      return sum;
    }, new Decimal(0));
    const actual = new Decimal(current.gross_balance)
      .minus(previous.gross_balance)
      .minus(flows);
    const predicted = actual.plus(audit.grossDifference);
    // Intervalo sem rendimento não ensina nada.
    if (actual.lte(0) || predicted.lte(0)) continue;
    pairs.push({ actual, predicted });
  }
  const recent = pairs.slice(-WINDOW);
  if (recent.length < MIN_SAMPLES)
    return {
      factor: new Decimal(1),
      samples: recent.length,
      errorBefore: null,
      errorAfter: null,
      accuracy: null,
    };

  const actualTotal = recent.reduce((s, p) => s.plus(p.actual), new Decimal(0));
  const predictedTotal = recent.reduce(
    (s, p) => s.plus(p.predicted),
    new Decimal(0),
  );
  const raw = actualTotal.div(predictedTotal);
  const meanError = (scale: Decimal) =>
    recent
      .reduce(
        (sum, pair) =>
          sum.plus(pair.predicted.mul(scale).minus(pair.actual).abs()),
        new Decimal(0),
      )
      .div(recent.length);
  const errorBefore = meanError(new Decimal(1));
  // Só corrige se o fator for plausível e errar menos nos mesmos intervalos.
  const candidate = meanError(raw);
  const usable =
    raw.gte(MIN_FACTOR) && raw.lte(MAX_FACTOR) && candidate.lt(errorBefore);
  const factor = usable ? raw : new Decimal(1);
  const errorAfter = usable ? candidate : errorBefore;
  return {
    factor,
    samples: recent.length,
    errorBefore,
    errorAfter,
    accuracy: Decimal.max(
      0,
      new Decimal(1).minus(errorAfter.mul(recent.length).div(actualTotal)),
    ),
  };
}
