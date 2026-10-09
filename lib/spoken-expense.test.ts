import { describe, expect, it } from 'vitest';
import { parseSpokenExpense } from './spoken-expense';

describe('registrar falando', () => {
  it('lê valor, lugar, meio e categoria', () => {
    expect(parseSpokenExpense('Gastei 32 no almoço com a Flash')).toEqual({
      amount: '32.00',
      description: 'Almoço',
      method: 'flash',
      mode: null,
      daysAgo: 0,
      category: 'Alimentação',
    });
  });

  it('entende centavos, R$, ontem e o crédito', () => {
    expect(
      parseSpokenExpense(
        'paguei R$ 18,50 na lavanderia ontem no crédito do nubank',
      ),
    ).toMatchObject({
      amount: '18.50',
      description: 'Lavanderia',
      method: 'nubank',
      mode: 'credit',
      daysAgo: 1,
      category: 'Serviços',
    });
    expect(
      parseSpokenExpense('comprei um fone de 1.250,00 no pix'),
    ).toMatchObject({
      amount: '1250.00',
      description: 'Fone',
      method: 'pix',
      category: 'Compras',
    });
  });

  it('sem meio nem categoria conhecidos, deixa para escolher', () => {
    expect(parseSpokenExpense('gastei 40 na Tio Gil')).toMatchObject({
      amount: '40.00',
      description: 'Tio Gil',
      method: null,
      category: null,
    });
  });

  it('pergunta e frase sem valor não são gasto', () => {
    expect(parseSpokenExpense('Quanto gastei com Uber este mês?')).toBeNull();
    expect(parseSpokenExpense('gastei muito no mercado')).toBeNull();
    expect(parseSpokenExpense('Onde mais gastei este mês')).toBeNull();
    expect(
      parseSpokenExpense('Estou gastando mais que no mês passado?'),
    ).toBeNull();
  });
});
