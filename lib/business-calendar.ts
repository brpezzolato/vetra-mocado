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

export function nationalFinancialHolidays(year: number) {
  const saved = cache.get(year);
  if (saved) return saved;
  const holidays = new Set(
    [
      '01-01',
      '04-21',
      '05-01',
      '09-07',
      '10-12',
      '11-02',
      '11-15',
      '12-25',
    ].map((day) => `${year}-${day}`),
  );
  if (year >= 2024) holidays.add(`${year}-11-20`);
  for (const offset of [-48, -47, -2, 60]) {
    const date = easter(year);
    date.setUTCDate(date.getUTCDate() + offset);
    holidays.add(date.toISOString().slice(0, 10));
  }
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
