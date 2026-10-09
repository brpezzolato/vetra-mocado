import { describe, expect, it } from 'vitest';
import { parseShortcutEntry, stripEmoji } from './financial-tracker';

describe('Apple Shortcuts financial entry API', () => {
  it('accepts the Portuguese dictionary used by Shortcuts', () => {
    expect(
      parseShortcutEntry({
        tipo: 'Despesa',
        valor: 'R$ 1.234,56',
        descricao: 'Mercado',
        categoria: 'Alimentação',
        conta: 'Nubank',
        data: '2026-09-09T12:30:00-03:00',
        id_externo: 'wallet-123',
      }),
    ).toEqual({
      entryType: 'expense',
      amount: '1234.56',
      description: 'Mercado',
      category: 'Alimentação',
      account: 'Nubank',
      occurredAt: '2026-09-09T15:30:00.000Z',
      externalId: 'wallet-123',
    });
  });

  it('uses safe defaults and rejects malformed money', () => {
    expect(
      parseShortcutEntry({ tipo: 'receita', valor: 25, descricao: 'Pix' }),
    ).toMatchObject({
      entryType: 'income',
      amount: '25.00',
      category: 'Outros',
      account: 'Não informada',
    });
    for (const valor of [
      '0',
      '-1',
      '1,001',
      'abc',
      '12.34,56',
      '100000000000000',
      [25],
      {},
    ])
      expect(() =>
        parseShortcutEntry({ tipo: 'despesa', valor, descricao: 'Teste' }),
      ).toThrow('Valor monetário inválido.');
  });

  it('rejects non-text fields and invalid or ambiguous dates', () => {
    const base = { tipo: 'despesa', valor: '12.00', descricao: 'Café' };
    expect(() => parseShortcutEntry({ ...base, descricao: {} })).toThrow();
    for (const data of [
      '2026-09-09',
      '2026-09-09T10:00:00',
      '2026-02-30T10:00:00-03:00',
    ]) {
      expect(() => parseShortcutEntry({ ...base, data })).toThrow();
    }
    expect(parseShortcutEntry(base).occurredAt).toBeNull();
  });
});

describe('emoji no nome do estabelecimento', () => {
  const entry = (descricao: string) =>
    parseShortcutEntry({
      tipo: 'Despesa',
      valor: '10,00',
      descricao,
      conta: 'Nubank',
    }).description;

  it('tira o emoji que só existe para achar o item na lista do Atalho', () => {
    // A lista do Atalho é rotulada com emoji para ser rápida de achar no
    // celular; o enfeite é da lista, não do lançamento.
    expect(entry('🚙 Uber')).toBe('Uber');
    expect(entry('🍿 Cinemark')).toBe('Cinemark');
    expect(entry('🛒 Tik Tok Shop')).toBe('TikTok Shop');
    expect(entry('💳 Mercado Livre')).toBe('Mercado Livre');
  });

  it('não encosta nos dígitos', () => {
    // A classe Emoji_Component contém 0–9, # e *, porque formam sequências de
    // keycap. Usá-la apagaria o 99 de "99" e o número de "Drogasil 4060".
    // Direto no stripEmoji: pelo parser, "Drogasil 4060" agora vira
    // "Drogasil" de propósito (lib/merchant-names.ts), e isso esconderia se
    // foi o emoji que comeu o número.
    expect(entry('🏍 99')).toBe('99');
    expect(stripEmoji('Drogasil 4060')).toBe('Drogasil 4060');
    expect(stripEmoji('METRO*1T260910-37BV')).toBe('METRO*1T260910-37BV');
    expect(stripEmoji('#12 Bar')).toBe('#12 Bar');
  });

  it('lida com emoji composto, bandeira e tom de pele', () => {
    expect(entry('👨‍👩‍👧 Família Padaria')).toBe('Família Padaria');
    expect(entry('🇧🇷 Posto Brasil')).toBe('Posto Brasil');
    expect(entry('👋🏽 Bar do Zé')).toBe('Bar do Zé');
  });

  it('preserva acento e pontuação do nome', () => {
    expect(entry('🍔 Boteco Capitão')).toBe('Boteco Capitão');
    expect(entry('☕ Café & Cia.')).toBe('Café & Cia.');
  });

  it('não deixa o lançamento sem descrição quando o nome era só emoji', () => {
    // Apagar tudo faria a API recusar a compra por descrição vazia. Um nome
    // estranho é melhor que um gasto perdido.
    expect(entry('🍕')).toBe('🍕');
  });
});

describe('o cartão da Flash sob dois nomes', () => {
  const account = (conta: string) =>
    parseShortcutEntry({
      tipo: 'Despesa',
      valor: '5,40',
      descricao: 'Metrô SP',
      conta,
    }).account;

  it('traduz o nome técnico do cartão para o nome do app', () => {
    // "Benefits Virtual Card" é o nome no cartão; "Flash" é como o app chama,
    // e é sob esse nome que o extrato importa. Sem traduzir, a mesma compra
    // entra duas vezes — uma no caixa, outra na importação — e nenhuma das
    // duas enxerga a outra, porque estão em contas diferentes.
    expect(account('Benefits Virtual Card')).toBe('Flash');
  });

  it('não depende da caixa nem de espaço sobrando', () => {
    expect(account('  benefits virtual card ')).toBe('Flash');
    expect(account('BENEFITS VIRTUAL CARD')).toBe('Flash');
  });

  it('o cartão físico novo também é a Flash, e só de alimentação', () => {
    // "Card used for Meal and Voucher" só passa em alimentação e refeição:
    // até o Metrô, que pela loja seria transporte, sai do saldo de comida.
    const parsed = parseShortcutEntry({
      tipo: 'Despesa',
      valor: '10',
      descricao: 'Metrô SP',
      categoria: 'Transporte',
      conta: 'Card used for Meal and Voucher',
    });
    expect(parsed.account).toBe('Flash');
    expect(parsed.category).toBe('Alimentação');
  });

  it('deixa os outros cartões em paz', () => {
    expect(account('Nubank Mastercard Gold')).toBe('Nubank Mastercard Gold');
    expect(account('Flash')).toBe('Flash');
    expect(account('Pix')).toBe('Pix');
  });
});

describe('o nome do estabelecimento que chega pelo Atalho', () => {
  const entry = (descricao: string, tipo = 'Despesa') =>
    parseShortcutEntry({ tipo, valor: '5,40', descricao, conta: 'Nubank' })
      .description;

  it('chega com o nome único do lugar, não com o da maquininha', () => {
    expect(entry('METRO*1T260918-Whhv')).toBe('Metrô de São Paulo');
    expect(entry('🚇 Emv Cptm*145277044')).toBe('CPTM');
    expect(entry('Drogasil 4060')).toBe('Drogasil');
  });

  it('deixa receita como foi digitada', () => {
    expect(entry('Drogasil 4060', 'Receita')).toBe('Drogasil 4060');
  });
});
