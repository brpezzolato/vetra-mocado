/**
 * Regras de nome do usuário (`merchant_aliases`): "quando o nome for/começar
 * com/contiver X, chame de Y e ponha na categoria Z". Quem aplica é o gatilho
 * do banco (202610040001_merchant_aliases.sql); esta cópia serve à
 * sincronização decidir a categoria sem gastar IA. As duas têm de casar igual.
 */

export type MerchantAliasMatch = 'exact' | 'prefix' | 'contains';

export type MerchantAlias = {
  id: string;
  match: MerchantAliasMatch;
  /** Já em `merchantText`. */
  pattern: string;
  name: string;
  category: string | null;
};

export const MATCH_LABEL: Record<MerchantAliasMatch, string> = {
  exact: 'é igual a',
  prefix: 'começa com',
  contains: 'contém',
};

/** Minúsculas, sem espaço nas pontas, internos colapsados (`merchant_text` do banco). */
export const merchantText = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const matches = (text: string, alias: MerchantAlias) =>
  alias.match === 'exact'
    ? text === alias.pattern
    : alias.match === 'prefix'
      ? text.startsWith(alias.pattern)
      : text.includes(alias.pattern);

/** Exata primeiro, depois o padrão mais longo. */
export function matchMerchantAlias(
  description: string,
  aliases: MerchantAlias[],
): MerchantAlias | null {
  const text = merchantText(description);
  return (
    aliases
      .filter((alias) => matches(text, alias))
      .sort(
        (a, b) =>
          Number(b.match === 'exact') - Number(a.match === 'exact') ||
          b.pattern.length - a.pattern.length,
      )[0] ?? null
  );
}
