export const EXPENSE_CATEGORIES = [
  'Alimentação',
  'Transporte',
  'Moradia',
  'Saúde',
  'Educação',
  'Lazer',
  'Compras',
  'Assinaturas',
  'Serviços',
  // Outros fica por último: é o genérico, e `isGenericCategory` trata só ele.
  'Outros',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return (
    typeof value === 'string' &&
    EXPENSE_CATEGORIES.includes(value as ExpenseCategory)
  );
}

export function isGenericCategory(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR') === 'outros';
}
