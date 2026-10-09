import type { FinancialEntry } from './financial-tracker';

/** Categoria do estorno (card-entries.ts é só do servidor). */
const REFUND = 'Estorno';

/**
 * O que conta no "Entrou": renda (lib/pluggy/income-entries.ts), depósitos
 * do Flash e lançamentos manuais. Estorno fica de fora.
 */
export const countsAsIncome = (
  entry: Pick<
    FinancialEntry,
    'entry_type' | 'category' | 'excluded_from_totals'
  >,
) =>
  entry.entry_type === 'income' &&
  !entry.excluded_from_totals &&
  entry.category !== REFUND;

const saoMonth = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date(iso));

const previousMonth = (month: string) => {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Categorias de renda. Adiantamento tem a sua para não virar segundo salário. */
export const INCOME_CATEGORIES = [
  'Salário',
  'Adiantamento',
  'Receita',
  'Renda extra',
  'Reembolso',
] as const;

/** Salário pela categoria, não pelo nome. */
const isSalary = (entry: Pick<FinancialEntry, 'category'>) =>
  entry.category.trim().toLocaleLowerCase('pt-BR') === 'salário';

/**
 * Mês em que cada entrada conta no "Entrou", por id. Um mês não recebe dois
 * salários: o que caiu antes volta para o mês anterior (salário do último dia
 * útil que escorrega para o dia 1º). A data do lançamento não muda.
 */
export function incomeMonths(entries: FinancialEntry[]) {
  const months = new Map<string, string>();
  const salaries = new Map<string, FinancialEntry[]>();
  for (const entry of entries) {
    if (!countsAsIncome(entry)) continue;
    const month = saoMonth(entry.occurred_at);
    months.set(entry.id, month);
    if (isSalary(entry))
      salaries.set(month, [...(salaries.get(month) ?? []), entry]);
  }
  for (const [month, group] of salaries) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at),
    );
    // Todos menos o último do mês voltam um mês.
    for (const entry of sorted.slice(0, -1))
      months.set(entry.id, previousMonth(month));
  }
  return months;
}

/** O que entrou num mês (yyyy-mm), com a regra do salário. */
export function incomeIn(entries: FinancialEntry[], month: string) {
  const months = incomeMonths(entries);
  return entries.filter((entry) => months.get(entry.id) === month);
}
