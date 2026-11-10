import { describe, expect, it } from 'vitest';
import {
  matchSubscription,
  matchSubscriptions,
  subscriptionPatch,
  type ChargeEntry,
  type SubscriptionLike,
} from './subscription-charges';

const sub = (over: Partial<SubscriptionLike>): SubscriptionLike => ({
  id: 's1',
  merchant: 'Netflix',
  account: 'Itaú Crédito',
  amount: 20,
  next_date: '2026-11-05',
  billing_day: 5,
  frequency: 'monthly',
  paid_by_me: true,
  ...over,
});

let seq = 0;
const entry = (over: Partial<ChargeEntry>): ChargeEntry => ({
  id: `e${++seq}`,
  entry_type: 'expense',
  amount: 20,
  description: 'Netflix',
  account: 'Itaú Crédito',
  // Meio-dia em São Paulo.
  occurred_at: '2026-11-05T15:00:00Z',
  ...over,
});

describe('matchSubscription', () => {
  it('reconhece nome com uma letra trocada e em outro cartão', () => {
    const amazon = sub({
      merchant: 'Amazom Prime',
      amount: 19.9,
      next_date: '2026-12-05',
    });
    const charge = entry({
      description: 'Amazon Prime',
      amount: 19.9,
      account: 'Nubank Mastercard Gold',
    });
    const match = matchSubscription(amazon, [charge], '2026-11-10');
    expect(match.last?.id).toBe(charge.id);
    expect(match.status).toBe('paid');
    expect(match.nextDate).toBe('2026-12-05');
    expect(match.newLinks).toEqual([charge.id]);
    expect(subscriptionPatch(amazon, match)).toEqual({
      account: 'Nubank Mastercard Gold',
      bank_label: 'Amazon Prime',
    });
  });

  it('acha pelo nome do banco e ignora palavras genéricas', () => {
    const hbo = sub({
      merchant: 'HBO Max - Anuncios',
      amount: 20.93,
      billing_day: 9,
      next_date: '2026-11-09',
    });
    const charge = entry({
      description: 'Hbo Max',
      bank_description: 'MP *HBOMAXASSINOsascoBRA',
      amount: 20.93,
      occurred_at: '2026-11-09T20:26:00Z',
    });
    const match = matchSubscription(hbo, [charge], '2026-11-10');
    expect(match.status).toBe('paid');
    expect(match.nextDate).toBe('2026-12-09');
  });

  it('usa o apelido do serviço (iCloud vem como Apple)', () => {
    const icloud = sub({
      merchant: 'Icloud +',
      amount: 19.9,
      billing_day: 17,
      next_date: '2026-11-17',
    });
    const charge = entry({
      description: 'Apple',
      amount: 19.9,
      occurred_at: '2026-10-17T15:00:00Z',
    });
    const match = matchSubscription(icloud, [charge], '2026-11-10');
    expect(match.last?.id).toBe(charge.id);
    expect(match.nextDate).toBe('2026-11-17');
  });

  it('separa a mensalidade das outras compras na mesma loja', () => {
    const cinemark = sub({
      merchant: 'Cinemark - Club Black',
      amount: 42.9,
      billing_day: 2,
      next_date: '2026-12-02',
    });
    const entries = [
      entry({
        description: 'Cinemark',
        amount: 42.9,
        occurred_at: '2026-09-02T16:00:00Z',
      }),
      entry({
        description: 'Cinemark',
        amount: 59.28,
        occurred_at: '2026-09-07T21:00:00Z',
      }),
      entry({
        description: 'Cinemark',
        amount: 45.9,
        occurred_at: '2026-08-23T18:00:00Z',
      }),
      entry({
        description: 'Cinemark',
        amount: 42.9,
        occurred_at: '2026-10-02T15:00:00Z',
      }),
      entry({
        description: 'Cinemark',
        amount: 32.16,
        occurred_at: '2026-10-16T19:00:00Z',
      }),
      entry({
        description: 'Cinemark',
        amount: 42.9,
        occurred_at: '2026-11-02T16:00:00Z',
      }),
    ];
    const match = matchSubscription(cinemark, entries, '2026-11-10');
    expect(
      match.charges.map((charge) => charge.occurred_at.slice(0, 10)),
    ).toEqual(['2026-11-02', '2026-10-02', '2026-09-02']);
    expect(match.nextDate).toBe('2026-12-02');
  });

  it('o dia em que caiu de fato vira o dia de cobrança', () => {
    const item = sub({ billing_day: 5, next_date: '2026-11-05' });
    const charge = entry({ occurred_at: '2026-11-08T15:00:00Z' });
    const match = matchSubscription(item, [charge], '2026-11-10');
    expect(match.billingDay).toBe(8);
    expect(match.nextDate).toBe('2026-12-08');
  });

  it('não liga valor muito diferente nem dia longe', () => {
    const item = sub({});
    const match = matchSubscription(
      item,
      [entry({ amount: 45 }), entry({ occurred_at: '2026-11-20T15:00:00Z' })],
      '2026-11-25',
    );
    expect(match.charges).toEqual([]);
  });

  it('atrasada: passou do dia e nada caiu', () => {
    const item = sub({ next_date: '2026-11-05' });
    const match = matchSubscription(item, [], '2026-11-10');
    expect(match.status).toBe('late');
    expect(match.nextDate).toBe('2026-11-05');
  });

  it('dentro da folga ainda não é atrasada', () => {
    const match = matchSubscription(sub({}), [], '2026-11-07');
    expect(match.status).toBe('upcoming');
  });

  it('vínculo gravado vale e desfeito nunca volta', () => {
    const item = sub({});
    const manual = entry({ description: 'Pagamento qualquer', amount: 99 });
    const dismissed = entry({
      occurred_at: '2026-10-05T15:00:00Z',
      recurring_dismissed: true,
    });
    manual.recurring_expense_id = 's1';
    const match = matchSubscription(item, [manual, dismissed], '2026-11-10');
    expect(match.charges.map((charge) => charge.id)).toEqual([manual.id]);
    expect(match.newLinks).toEqual([]);
  });

  it('paga por outra pessoa não procura nada e só rola a data', () => {
    const item = sub({
      paid_by_me: false,
      next_date: '2026-09-29',
      billing_day: 29,
    });
    const match = matchSubscription(item, [entry({})], '2026-11-10');
    expect(match.status).toBe('untracked');
    expect(match.nextDate).toBe('2026-11-29');
  });

  it('um lançamento não serve a duas assinaturas', () => {
    const a = sub({ id: 'a' });
    const b = sub({ id: 'b' });
    const charge = entry({});
    const result = matchSubscriptions([a, b], [charge], '2026-11-10');
    expect(result.get('a')?.charges).toHaveLength(1);
    expect(result.get('b')?.charges).toHaveLength(0);
  });

  it('anual: casa no mesmo mês e a próxima é no ano seguinte', () => {
    const item = sub({
      frequency: 'yearly',
      amount: 199,
      next_date: '2026-03-10',
      billing_day: 10,
    });
    const charge = entry({ amount: 199, occurred_at: '2026-03-12T15:00:00Z' });
    const match = matchSubscription(item, [charge], '2026-11-10');
    expect(match.status).toBe('paid');
    expect(match.nextDate).toBe('2027-03-12');
  });
});
