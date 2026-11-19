import { describe, expect, it } from 'vitest';
import type { CardInvoice } from './card-invoices';
import { ownBalance } from './card-invoices';
import type { FinancialEntry } from './financial-tracker';

const entry = (
  day: string,
  amount: number,
  excluded = false,
  type: 'expense' | 'income' = 'expense',
) =>
  ({
    occurred_at: `${day}T15:00:00Z`,
    amount,
    entry_type: type,
    excluded_from_totals: excluded,
  }) as unknown as FinancialEntry;

const invoice = (extra: Partial<CardInvoice>): CardInvoice =>
  ({
    account: 'Cartão',
    paid: '0',
    carried: null,
    balance: '0',
    entries: [],
    paidOn: [],
    ...extra,
  }) as CardInvoice;

describe('o que falta pagar sem as compras fora das contas', () => {
  it('nada pago: desconta a compra fora das contas', () => {
    expect(
      ownBalance(
        invoice({
          balance: '200.00',
          entries: [entry('2026-11-01', 150), entry('2026-11-02', 50, true)],
        }),
      ).toFixed(2),
    ).toBe('150.00');
  });

  it('fora das contas já paga com antecipação não sai de novo (Nubank, 19/11)', () => {
    // Debora + Uber + Cinemark + Prime pagos antes (crédito da anterior);
    // falta só o que chegou depois.
    const nubank = invoice({
      carried: '-239.64',
      balance: '282.77',
      entries: [
        entry('2026-10-31', 159.9, true),
        entry('2026-11-02', 16.94),
        entry('2026-11-02', 42.9),
        entry('2026-11-05', 19.9),
        entry('2026-11-19', 282.77),
      ],
    });
    expect(ownBalance(nubank).toFixed(2)).toBe('282.77');
  });

  it('pagamento cobre as compras que já existiam no dia dele (PicPay, 03/11)', () => {
    // Pagou as suas duas compras de 29/10; depois só vieram compras de
    // outra pessoa.
    const picpay = invoice({
      paid: '167.50',
      paidOn: [{ date: '2026-11-03', amount: '167.50' }],
      balance: '312.50',
      entries: [
        entry('2026-10-29', 67.5),
        entry('2026-10-29', 100),
        entry('2026-11-05', 200, true),
        entry('2026-11-10', 112.5, true),
      ],
    });
    expect(ownBalance(picpay).toFixed(2)).toBe('0.00');
  });

  it('pagamento maior que as compras do dia segue para as seguintes', () => {
    // Pagou 80 com só 50 de compra própria até ali: os 30 que sobram cobrem
    // a compra de outra pessoa que veio depois.
    expect(
      ownBalance(
        invoice({
          paid: '80.00',
          paidOn: [{ date: '2026-11-03', amount: '80.00' }],
          balance: '70.00',
          entries: [entry('2026-11-01', 50), entry('2026-11-05', 100, true)],
        }),
      ).toFixed(2),
    ).toBe('0.00');
  });

  it('pagamento lançado sem data cobre as mais antigas', () => {
    expect(
      ownBalance(
        invoice({
          paid: '50.00',
          balance: '150.00',
          entries: [entry('2026-11-01', 50, true), entry('2026-11-05', 150)],
        }),
      ).toFixed(2),
    ).toBe('150.00');
  });

  it('estorno fora das contas devolve e nunca fica negativo', () => {
    expect(
      ownBalance(
        invoice({
          balance: '40.00',
          entries: [
            entry('2026-11-01', 100),
            entry('2026-11-02', 60, false, 'income'),
            entry('2026-11-03', 80, true),
          ],
        }),
      ).toFixed(2),
    ).toBe('0.00');
  });
});
