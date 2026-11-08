/** O pedaço do construtor de consultas do Supabase que o filtro usa. */
type Filterable = {
  eq(column: string, value: string): Filterable;
  in(column: string, values: string[]): Filterable;
};

/**
 * Restringe uma consulta ao usuário e, se pedido, às contas. Com a sessão o
 * RLS já filtra e `userId` pode faltar; com service role, passe sempre.
 *
 * O tipo da consulta passa direto: descrever o construtor do Supabase como
 * restrição genérica estoura o verificador ("excessively deep"), então a
 * conversão fica só aqui.
 */
export function scopeQuery<Query>(
  query: Query,
  { userId, accounts }: { userId?: string; accounts?: string[] },
): Query {
  let result = query as unknown as Filterable;
  if (userId) result = result.eq('user_id', userId);
  if (accounts) result = result.in('account', accounts);
  return result as unknown as Query;
}
