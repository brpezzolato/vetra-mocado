// Vencimento de cada fatura. Publicada: a data do banco. Não publicada: a
// regra inferida das faturas anteriores (dia contratado e se o banco empurra
// fim de semana/feriado para o próximo dia útil). Ex.: Nubank empurra, PicPay não.
import { isFinancialBusinessDay } from './business-calendar';

export type DueRule = { day: number; rollsForward: boolean };

const utc = (day: string) => new Date(`${day}T12:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** O dia `day` do mês `month` ("2026-10"), sem passar do fim do mês. */
export function monthDay(month: string, day: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** O próprio dia, se for útil; senão o próximo dia útil. */
export function nextBusinessDay(day: string) {
  const date = utc(day);
  while (!isFinancialBusinessDay(date)) date.setUTCDate(date.getUTCDate() + 1);
  return iso(date);
}

/** O vencimento que o banco daria à fatura do mês `month`. */
export function dueDateFor(month: string, rule: DueRule) {
  const nominal = monthDay(month, rule.day);
  return rule.rollsForward ? nextBusinessDay(nominal) : nominal;
}

/**
 * Regra pelas faturas publicadas: cruza os dias possíveis de cada uma até
 * sobrar um. Se esvaziar, o cartão mudou de dia e as mais antigas não contam.
 */
export function inferDueRule(dueDates: string[]): DueRule | null {
  const sorted = [...new Set(dueDates)].sort().reverse();
  if (!sorted.length) return null;
  // Um vencimento em dia não útil prova que o banco não empurra.
  const rollsForward = sorted.every((due) => isFinancialBusinessDay(utc(due)));
  let days: Set<number> | null = null;
  for (const due of sorted) {
    const month = due.slice(0, 7);
    const candidates = new Set<number>();
    for (let day = 1; day <= 31; day++) {
      const nominal = monthDay(month, day);
      const result = rollsForward ? nextBusinessDay(nominal) : nominal;
      if (result === due) candidates.add(day);
    }
    const next: Set<number> = days
      ? new Set([...days].filter((day) => candidates.has(day)))
      : candidates;
    if (!next.size) break;
    days = next;
    if (days.size === 1) break;
  }
  if (!days?.size) return null;
  return { day: Math.min(...days), rollsForward };
}
