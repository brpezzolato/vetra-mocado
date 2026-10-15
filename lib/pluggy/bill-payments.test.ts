import { describe, expect, it } from 'vitest';
import {
  checkingBillPayments,
  invoiceDueForPayment,
  paidCard,
  type LimitPoint,
} from './bill-payments';
import type { PluggyTransaction } from './types';

const transaction = (patch: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: 't',
  accountId: 'conta',
  date: '2026-10-14T13:19:00Z',
  amount: -42.65,
  type: 'DEBIT',
  status: 'POSTED',
  description: 'Pagamento de fatura',
  operationType: 'OUTROS',
  category: 'Credit card payment',
  merchantName: null,
  installment: null,
  ...patch,
});

// Caso de 14/10/2026: o Itaú pagou R$ 42,65 pela corrente e só o Platinum
// caiu esse valor; o Itaú Crédito subiu (compras).
const points: LimitPoint[] = [
  { account: 'Platinum', seen: '2026-10-13T17:17:00Z', used: 285.55 },
  { account: 'Platinum', seen: '2026-10-14T21:35:00Z', used: 242.9 },
  { account: 'Crédito', seen: '2026-10-13T17:17:00Z', used: 0 },
  { account: 'Crédito', seen: '2026-10-14T21:35:00Z', used: 136.13 },
];

describe('pagamento de fatura pela corrente', () => {
  it('pega só as saídas de pagamento de cartão', () => {
    expect(
      checkingBillPayments([
        transaction({ id: 'a' }),
        transaction({ id: 'b', category: 'Transfer - PIX' }),
        transaction({ id: 'c', type: 'CREDIT', amount: 42.65 }),
      ]),
    ).toEqual([{ id: 'a', date: '2026-10-14T13:19:00Z', amount: 42.65 }]);
  });

  it('o cartão pago é o que caiu o valor do pagamento', () => {
    const [payment] = checkingBillPayments([transaction({})]);
    expect(paidCard(payment!, ['Platinum', 'Crédito'], points)).toBe(
      'Platinum',
    );
  });

  it('sem queda do mesmo valor, não chuta um cartão', () => {
    const [payment] = checkingBillPayments([transaction({ amount: -100 })]);
    expect(paidCard(payment!, ['Platinum', 'Crédito'], points)).toBeNull();
    // Nem com um cartão só: a corrente pode ter pago outro banco.
    expect(paidCard(payment!, ['Crédito'], points)).toBeNull();
  });

  it('abate a fatura aberta, ou a fechada que ainda não venceu', () => {
    // Platinum: vence dia 6, fecha 6 dias antes.
    const cycle = {
      account: 'Platinum',
      kind: 'credit' as const,
      closing_day: 28,
      due_day: 6,
      closing_offset_days: 6,
    };
    expect(invoiceDueForPayment('2026-10-14', cycle)).toBe('2026-11-06');
    // 02/11: a de 06/11 já fechou (31/10) e não venceu.
    expect(invoiceDueForPayment('2026-11-02', cycle)).toBe('2026-11-06');
    expect(invoiceDueForPayment('2026-11-07', cycle)).toBe('2026-12-06');
  });
});
