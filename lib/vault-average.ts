// Previsão dos cofrinhos pela média do que cada um rendeu de fato (pedido do
// Bruno, 16/11/2026): nenhuma regra do banco (% do CDI, teto de promoção,
// IOF, IR) entra. A taxa promocional mudou no Mercado Pago e o motor errava.
// Puro.
import Decimal from 'decimal.js';
import type { PiggyBank } from './domain';
import { calendarDays, isoDate, parseDate } from './finance';

/** Só os intervalos recentes: taxa que mudou (promoção) logo vale. */
export const AVERAGE_WINDOW_DAYS = 30;
/**
 * Acima de 0,1% ao dia (~44% ao ano, muito além de qualquer cofrinho) não é
 * rendimento: é dinheiro que entrou sem lançamento.
 */
export const MAX_DAILY_RATE = new Decimal('0.001');

const dayBefore = (date: string) =>
  isoDate(new Date(parseDate(date).getTime() - 86_400_000));

const day = (iso: string) => isoDate(parseDate(iso));

/** Depósitos menos retiradas com data em (from, to]. */
export function flowsBetween(bank: PiggyBank, from: string, to: string) {
  return bank.transactions.reduce((sum, transaction) => {
    const when = day(transaction.occurred_at);
    if (when <= from || when > to) return sum;
    if (transaction.kind === 'deposit') return sum.plus(transaction.amount);
    if (transaction.kind === 'withdrawal') return sum.minus(transaction.amount);
    return sum;
  }, new Decimal(0));
}

/**
 * Quanto cada real rendeu por dia corrido (fim de semana conta e não rende),
 * em média, entre os saldos líquidos do banco dos últimos 30 dias:
 * Σ rendimento ÷ Σ (saldo inicial × dias). Com um intervalo só, é ele.
 * O saldo do banco às vezes ainda não traz o depósito feito no próprio dia
 * (Itaú, 13/11/2026): sem sentido do jeito normal, tenta contando também as
 * movimentações daquele dia. Intervalo com queda ou acima de
 * `MAX_DAILY_RATE` (dinheiro sem lançamento) fica de fora. `null` sem nenhum
 * intervalo para medir ou sem rendimento algum ainda (aí fica o motor).
 */
export function averageDailyRate(
  bank: PiggyBank,
  now = new Date(),
): Decimal | null {
  const since = isoDate(
    new Date(now.getTime() - AVERAGE_WINDOW_DAYS * 86_400_000),
  );
  const snapshots = [...bank.snapshots].sort((a, b) =>
    a.snapshot_date.localeCompare(b.snapshot_date),
  );
  let gains = new Decimal(0);
  let exposure = new Decimal(0);
  for (let index = 1; index < snapshots.length; index++) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    if (current.snapshot_date < since) continue;
    const days = calendarDays(
      parseDate(previous.snapshot_date),
      parseDate(current.snapshot_date),
    );
    const opening = new Decimal(previous.net_balance);
    if (days <= 0) continue;
    const sameDay = flowsBetween(
      bank,
      dayBefore(previous.snapshot_date),
      previous.snapshot_date,
    );
    const later = flowsBetween(
      bank,
      previous.snapshot_date,
      current.snapshot_date,
    );
    const options = [
      { start: opening, flows: later },
      { start: opening.plus(sameDay), flows: later },
    ];
    const pick = options.find(({ start, flows }) => {
      if (start.lte(0)) return false;
      const gain = new Decimal(current.net_balance).minus(start).minus(flows);
      return gain.gte(0) && gain.lte(start.mul(days).mul(MAX_DAILY_RATE));
    });
    if (!pick) continue;
    gains = gains.plus(
      new Decimal(current.net_balance).minus(pick.start).minus(pick.flows),
    );
    exposure = exposure.plus(pick.start.mul(days));
  }
  // Nenhum centavo de rendimento ainda (cofrinho do MP com 3 saldos iguais)
  // é falta de histórico, não taxa zero.
  return gains.gt(0) && exposure.gt(0) ? gains.div(exposure) : null;
}

/**
 * Saldo líquido previsto em `date` (depois do último saldo do banco): o
 * último saldo mais o que entrou ou saiu desde então, rendendo a taxa média
 * por dia corrido. `null` sem saldo do banco ou sem taxa medida.
 */
export function averageProjectedBalance(
  bank: PiggyBank,
  rate: Decimal | null,
  date: string,
): Decimal | null {
  if (rate === null) return null;
  const last = [...bank.snapshots]
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
    .at(-1);
  if (!last || date <= last.snapshot_date) return null;
  const days = calendarDays(parseDate(last.snapshot_date), parseDate(date));
  const base = new Decimal(last.net_balance).plus(
    flowsBetween(bank, last.snapshot_date, date),
  );
  if (base.lte(0)) return new Decimal(0);
  return base.mul(rate.plus(1).pow(days)).toDecimalPlaces(2);
}
