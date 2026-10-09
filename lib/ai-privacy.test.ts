import { describe, expect, it } from 'vitest';
import {
  createRedactor,
  HIDDEN_EMAIL,
  HIDDEN_NUMBER,
  scrubIdentifiers,
} from './ai-privacy';

describe('o que não sai para o Gemini', () => {
  it('apaga cartão, CPF, telefone e e-mail', () => {
    expect(scrubIdentifiers('cartão 5162 9200 1234 5678')).toBe(
      `cartão ${HIDDEN_NUMBER}`,
    );
    expect(scrubIdentifiers('CPF 123.456.789-00')).toBe(`CPF ${HIDDEN_NUMBER}`);
    expect(scrubIdentifiers('liga 11 98765-4321')).toBe(
      `liga ${HIDDEN_NUMBER}`,
    );
    expect(scrubIdentifiers('manda pra bruno@exemplo.com')).toBe(
      `manda pra ${HIDDEN_EMAIL}`,
    );
  });

  it('não mexe em número curto de nome de loja', () => {
    expect(scrubIdentifiers('Paralelo 17')).toBe('Paralelo 17');
    expect(scrubIdentifiers('VMT* 579 - Bar')).toBe('VMT* 579 - Bar');
  });

  it('mantém nome de gente, que é o que identifica o gasto', () => {
    // Retirado em 28/09/2026 a pedido do Bruno: a regra de nome era ampla
    // demais e apagava a informação que a análise usa.
    for (const text of [
      'Pix Bia - Frete',
      'Dia ICL - Pix pro Léo',
      'Jose Ellio Vieira',
      'Giovanna Pizzaria',
      'Giuliana Flores',
    ])
      expect(scrubIdentifiers(text)).toBe(text);
  });
});

describe('createRedactor', () => {
  it('esconde do Gemini e devolve o dado real na resposta', () => {
    const redactor = createRedactor();
    const sent = redactor.scrub(
      'cartão 5162 9200 1234 5678, CPF 123.456.789-00, bruno@exemplo.com, de novo 5162 9200 1234 5678',
    );
    expect(sent).not.toMatch(/5162|123\.456|bruno@/);
    // Cada tipo de marcador tem a sua numeração.
    expect(sent).toBe(
      'cartão [número oculto 1], CPF [número oculto 2], [e-mail oculto 1], de novo [número oculto 1]',
    );
    expect(
      redactor.restore(
        'O [número oculto 1] é o cartão; e-mail [e-mail oculto 1].',
      ),
    ).toBe('O 5162 9200 1234 5678 é o cartão; e-mail bruno@exemplo.com.');
  });

  it('esconde pessoas, origens e o próprio nome, e devolve na resposta', () => {
    const redactor = createRedactor();
    redactor.self(['Fulano Beltrano', 'fulano.beltrano']);
    expect(redactor.alias('pessoa', 'Julia Souza')).toBe('[pessoa 1]');
    expect(redactor.alias('origem', 'Empresa Exemplo Ltda')).toBe('[origem 1]');
    // A pergunta do usuário também passa pelo filtro.
    const sent = redactor.scrub(
      'Quanto o Fulano mandou para julia souza? E o salário da Empresa Exemplo Ltda?',
    );
    expect(sent).toBe(
      'Quanto o [você] mandou para [pessoa 1]? E o salário da [origem 1]?',
    );
    expect(
      redactor.restore('[você] pagou [pessoa 1] com o de [origem 1].'),
    ).toBe('Fulano Beltrano pagou Julia Souza com o de Empresa Exemplo Ltda.');
  });

  it('não troca pedaço de outra palavra', () => {
    const redactor = createRedactor();
    redactor.self(['Ana']);
    expect(redactor.scrub('Banana e Ana')).toBe('Banana e [você]');
  });

  it('marcador que não existe fica como está', () => {
    expect(createRedactor().restore('[número oculto 9]')).toBe(
      '[número oculto 9]',
    );
  });
});
