import { describe, expect, it } from 'vitest';
import {
  CARD_BANKS,
  cardAccounts,
  resolveCardBank,
  resolvePaymentMethod,
  sortPaymentCardsByUsage,
  suggestedCardBank,
  type PaymentCard,
} from './payment-cards';
const card = (
  account: string,
  bank_id: PaymentCard['bank_id'],
): PaymentCard => ({
  account,
  bank_id,
  user_id: 'user',
  created_at: '',
  updated_at: '',
});
describe('payment card icon bindings', () => {
  it.each([
    ['PicPay final 1234', 'picpay'],
    ['Nubank', 'nubank'],
    ['Itaú Visa', 'itau'],
    ['Flash Benefícios', 'flash'],
    ['Inter 1000', 'other'],
    ['Santander', 'other'],
    ['Mastercard', 'other'],
    ['Internet', 'other'],
  ])(
    'suggests a bank for %s without treating card networks as banks',
    (name, bank) => {
      expect(suggestedCardBank(name)).toBe(bank);
    },
  );
  it('keeps independent bindings for two cards from the same bank', () => {
    const cards = [
      card('Meu cartão 1234', 'nubank'),
      card('Meu cartão 5678', 'picpay'),
    ];
    expect(resolveCardBank('Meu cartão 1234', cards)).toBe('nubank');
    expect(resolveCardBank('Meu cartão 5678', cards)).toBe('picpay');
    expect(resolveCardBank('Meu cartão 9999', cards)).toBe('other');
  });
  it('recognizes Pix as a payment method without treating it as a card bank', () => {
    expect(resolvePaymentMethod('Pix', [])).toBe('pix');
    expect(resolveCardBank('Pix', [])).toBe('other');
  });
  it('respects explicit choices, including a generic icon', () => {
    expect(resolveCardBank(' Nubank ', [card('Nubank', 'other')])).toBe(
      'other',
    );
  });
  it('deduplicates received names and retains cards linked before a purchase', () => {
    expect(
      cardAccounts(
        ['Nubank', ' Nubank ', 'Não informada', ''],
        [card('PicPay', 'picpay')],
      ),
    ).toEqual(['Nubank', 'PicPay']);
  });
  it('orders cards by usage count and then by most recent appearance', () => {
    const cards = [
      card('Flash', 'flash'),
      card('Nubank', 'nubank'),
      card('PicPay', 'picpay'),
    ];
    expect(
      sortPaymentCardsByUsage(cards, [
        'PicPay',
        'Nubank',
        'Flash',
        'Nubank',
        'PicPay',
        'Nubank',
      ]).map((item) => item.account),
    ).toEqual(['Nubank', 'PicPay', 'Flash']);
  });
  it('keeps the latest-used card first when usage counts tie', () => {
    const cards = [card('Flash', 'flash'), card('Nubank', 'nubank')];
    expect(
      sortPaymentCardsByUsage(cards, ['Nubank', 'Flash']).map(
        (item) => item.account,
      ),
    ).toEqual(['Nubank', 'Flash']);
  });
  it('provides a distinct stable identifier for every supported icon', () => {
    expect(CARD_BANKS.map((bank) => bank.id)).toEqual([
      'flash',
      'itau',
      'nubank',
      'picpay',
      'mercado-pago',
    ]);
    expect(new Set(CARD_BANKS.map((bank) => bank.id)).size).toBe(
      CARD_BANKS.length,
    );
  });
});
