import { describe, expect, it } from 'vitest';
import {
  matchMerchantAlias,
  merchantText,
  type MerchantAlias,
} from './merchant-aliases';

const alias = (
  id: string,
  match: MerchantAlias['match'],
  pattern: string,
  name: string,
  category: string | null = null,
): MerchantAlias => ({ id, match, pattern: merchantText(pattern), name, category });

describe('regras de nome', () => {
  it('compara sem maiúsculas e com os espaços colapsados', () => {
    const rule = alias('a', 'prefix', '579 - bar', 'Lavanderia', 'Serviços');
    expect(matchMerchantAlias('  579   -  BAR centro', [rule])?.name).toBe(
      'Lavanderia',
    );
  });

  it('"começa com" não pega o meio do nome', () => {
    const rule = alias('a', 'prefix', 'loja', 'Loja');
    expect(matchMerchantAlias('Minha loja', [rule])).toBeNull();
    expect(
      matchMerchantAlias('Minha loja', [alias('b', 'contains', 'loja', 'Loja')])
        ?.name,
    ).toBe('Loja');
  });

  it('a exata vence, depois a mais específica', () => {
    const rules = [
      alias('curta', 'contains', 'uber', 'Uber'),
      alias('longa', 'prefix', 'uber eats', 'Uber Eats'),
      alias('exata', 'exact', 'uber eats sp', 'Uber Eats SP'),
    ];
    expect(matchMerchantAlias('Uber Eats SP', rules)?.id).toBe('exata');
    expect(matchMerchantAlias('Uber Eats RJ', rules)?.id).toBe('longa');
    expect(matchMerchantAlias('Dl*Uber', rules)?.id).toBe('curta');
  });
});
