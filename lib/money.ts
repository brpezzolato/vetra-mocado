import Decimal from 'decimal.js';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Valor em reais ("R$ 1.234,56"), arredondado em centavos; vazio vira zero. */
export const money = (value: Decimal.Value | null | undefined) =>
  BRL.format(new Decimal(value || 0).toDecimalPlaces(2).toNumber());
