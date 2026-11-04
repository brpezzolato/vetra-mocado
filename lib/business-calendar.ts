// National financial-market holidays. 2026 checked against ANBIMA:
// https://www.anbima.com.br/feriados/fer_nacionais/2026.asp
// Published CDI dates remain authoritative in finance.makeCalendar.
const cache = new Map<number, Set<string>>();

function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

const names = new Map<number, Map<string, string>>();

/** Feriados nacionais do mercado financeiro, com o nome (calendário do Resumo). */
export function nationalHolidayNames(year: number) {
  const saved = names.get(year);
  if (saved) return saved;
  const holidays = new Map<string, string>(
    (
      [
        ['01-01', 'Confraternização Universal'],
        ['04-21', 'Tiradentes'],
        ['05-01', 'Dia do Trabalho'],
        ['09-07', 'Independência do Brasil'],
        ['10-12', 'Nossa Senhora Aparecida'],
        ['11-02', 'Finados'],
        ['11-15', 'Proclamação da República'],
        ['12-25', 'Natal'],
      ] as const
    ).map(([day, name]) => [`${year}-${day}`, name]),
  );
  if (year >= 2024) holidays.set(`${year}-11-20`, 'Consciência Negra');
  for (const [offset, name] of [
    [-48, 'Carnaval'],
    [-47, 'Carnaval'],
    [-2, 'Sexta-feira Santa'],
    [60, 'Corpus Christi'],
  ] as const) {
    const date = easter(year);
    date.setUTCDate(date.getUTCDate() + offset);
    holidays.set(date.toISOString().slice(0, 10), name);
  }
  names.set(year, holidays);
  return holidays;
}

export function nationalFinancialHolidays(year: number) {
  const saved = cache.get(year);
  if (saved) return saved;
  const holidays = new Set(nationalHolidayNames(year).keys());
  cache.set(year, holidays);
  return holidays;
}

export function isFinancialBusinessDay(date: Date) {
  if (!Number.isFinite(date.getTime())) return false;
  return (
    date.getUTCDay() !== 0 &&
    date.getUTCDay() !== 6 &&
    !nationalFinancialHolidays(date.getUTCFullYear()).has(
      date.toISOString().slice(0, 10),
    )
  );
}

export function isNationalFinancialHoliday(date: Date) {
  if (!Number.isFinite(date.getTime())) return false;
  return nationalFinancialHolidays(date.getUTCFullYear()).has(
    date.toISOString().slice(0, 10),
  );
}
