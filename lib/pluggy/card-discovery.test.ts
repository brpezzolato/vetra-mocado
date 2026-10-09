import { describe, expect, it } from 'vitest';
import { creditCardName } from './card-discovery';

describe('nome do cartão achado sozinho', () => {
  it('põe o banco na frente quando o nome do produto não diz', () => {
    expect(creditCardName('nubank', 'gold', new Set())).toBe('Nubank Gold');
  });

  it('não repete o banco que o produto já tem, e o escreve certo', () => {
    expect(creditCardName('picpay', 'PIC PAY MASTERCARD GOLD', new Set())).toBe(
      'PicPay Mastercard Gold',
    );
    expect(creditCardName('itau', 'ITAU MASTERCARD PLATINUM', new Set())).toBe(
      'Itaú Mastercard Platinum',
    );
  });

  it('o débito com acento e o crédito sem acento são o mesmo nome', () => {
    expect(
      creditCardName(
        'itau',
        'ITAU MASTERCARD PLATINUM',
        new Set(['Itaú Mastercard Platinum']),
      ),
    ).toBe('Itaú Mastercard Platinum Crédito');
  });

  it('o crédito do cartão múltiplo não colide com o débito', () => {
    expect(
      creditCardName(
        'itau',
        'Mastercard Platinum',
        new Set(['Itaú Mastercard Platinum']),
      ),
    ).toBe('Itaú Mastercard Platinum Crédito');
  });

  it('sem banco nem nome, um nome genérico', () => {
    expect(creditCardName(null, '', new Set())).toBe('Cartão de crédito');
  });
});
