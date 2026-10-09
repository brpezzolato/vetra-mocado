// Extrato de rendimentos pelo saldo do banco: rendimento do dia = saldo −
// saldo anterior − movimentos. Sem estimativa do motor.
// A Pluggy só entrega a posição do dia; com mais de um dia útil entre dois
// saldos, o rendimento é dividido pelos dias úteis, proporcional ao CDI
// (o total não muda; a linha avisa que a divisão é estimada).
import Decimal from 'decimal.js';
import type { DailyRate, SnapshotRow, TransactionRow } from './domain';
import type { StatementEarning } from './earning-statement';

const TIME_ZONE = 'America/Sao_Paulo';

const day = (iso: string) =>
  iso.length === 10
    ? iso
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));

const nextDay = (value: string) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

const optional = (value: number | string | null | undefined) =>
  value === null || value === undefined ? null : new Decimal(value);

/**
 * Dias úteis em (depois, até] com peso. Após o último CDI publicado, dia de
 * semana com a última taxa.
 */
function businessDays(after: string, until: string, rates: DailyRate[]) {
  const byDate = new Map(rates.map((rate) => [rate.date, rate.rate]));
  const lastPublished = rates.at(-1)?.date ?? '';
  const lastRate = rates.at(-1)?.rate ?? '1';
  const days: { date: string; weight: Decimal }[] = [];
  for (let date = nextDay(after); date <= until; date = nextDay(date)) {
    const published = byDate.get(date);
    if (published !== undefined) {
      if (new Decimal(published).gt(0))
        days.push({ date, weight: new Decimal(published) });
      continue;
    }
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (date > lastPublished && weekday !== 0 && weekday !== 6)
      days.push({ date, weight: new Decimal(lastRate) });
  }
  return days;
}

/** Divide em centavos; a sobra vai para o último dia. */
function split(amount: Decimal, weights: Decimal[]) {
  const total = weights.reduce(
    (sum, weight) => sum.plus(weight),
    new Decimal(0),
  );
  let assigned = new Decimal(0);
  return weights.map((weight, index) => {
    const share =
      index === weights.length - 1
        ? amount.minus(assigned)
        : amount
            .times(weight)
            .dividedBy(total)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    assigned = assigned.plus(share);
    return share;
  });
}

type Point = {
  id: string;
  date: string;
  gross: Decimal;
  net: Decimal;
  iof: Decimal | null;
  incomeTax: Decimal | null;
};

/**
 * Um rendimento por dia útil coberto. O primeiro saldo compara com zero
 * antes do primeiro aporte.
 */
export function snapshotEarnings(
  snapshots: SnapshotRow[],
  transactions: TransactionRow[],
  rates: DailyRate[] = [],
): StatementEarning[] {
  const sorted = [...snapshots].sort((a, b) =>
    a.snapshot_date.localeCompare(b.snapshot_date),
  );
  if (!sorted.length) return [];
  const points: Point[] = sorted.map((snapshot) => ({
    id: snapshot.id,
    date: snapshot.snapshot_date,
    gross: new Decimal(snapshot.gross_balance),
    net: new Decimal(snapshot.net_balance),
    iof: optional(snapshot.iof),
    incomeTax: optional(snapshot.income_tax),
  }));
  // No dia do primeiro aporte o saldo era zero; o aporte é fluxo do intervalo
  // seguinte e o dia não rende.
  const firstMovement = transactions
    .map((transaction) => day(transaction.occurred_at))
    .sort()[0];
  if (firstMovement && firstMovement < points[0].date) {
    const before = new Date(
      Date.parse(`${firstMovement}T00:00:00Z`) - 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    points.unshift({
      id: 'inicio',
      date: before,
      gross: new Decimal(0),
      net: new Decimal(0),
      iof: new Decimal(0),
      incomeTax: new Decimal(0),
    });
  }

  const earnings: StatementEarning[] = [];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    // Aporte entra no saldo sem ser rendimento; retirada sai sem ser perda.
    const flows = transactions.reduce((sum, transaction) => {
      const when = day(transaction.occurred_at);
      if (when <= previous.date || when > current.date) return sum;
      if (transaction.kind === 'deposit') return sum.plus(transaction.amount);
      if (transaction.kind === 'withdrawal')
        return sum.minus(transaction.amount);
      return sum;
    }, new Decimal(0));
    const netAmount = current.net.minus(previous.net).minus(flows);
    const grossAmount = current.gross.minus(previous.gross).minus(flows);
    const iof =
      previous.iof && current.iof ? current.iof.minus(previous.iof) : undefined;
    const incomeTax =
      previous.incomeTax && current.incomeTax
        ? current.incomeTax.minus(previous.incomeTax)
        : undefined;

    // O dia do primeiro aporte não rende.
    const after =
      previous.id === 'inicio' && firstMovement ? firstMovement : previous.date;
    const days = businessDays(after, current.date, rates);
    if (days.length <= 1) {
      earnings.push({
        id: `saldo-${current.id}`,
        date: current.date,
        confirmed: true,
        reconciled: true,
        netAmount,
        grossAmount,
        taxes: grossAmount.minus(netAmount),
        iof,
        incomeTax,
      });
      continue;
    }
    const weights = days.map((item) => item.weight);
    const nets = split(netAmount, weights);
    const grosses = split(grossAmount, weights);
    days.forEach((item, position) => {
      earnings.push({
        id: `saldo-${current.id}-${item.date}`,
        date: item.date,
        confirmed: true,
        reconciled: true,
        distributed: true,
        netAmount: nets[position],
        grossAmount: grosses[position],
        taxes: grosses[position].minus(nets[position]),
      });
    });
  }
  return earnings;
}
