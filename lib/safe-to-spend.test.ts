import { describe, expect, it } from 'vitest';
import { lastBusinessDay, safeToSpend } from './safe-to-spend';
import type { RecurringExpense } from './expense-insights';

const subscription = (
  merchant: string,
  next_date: string,
  amount = '20.00',
): RecurringExpense => ({
  id: merchant,
  merchant,
  account: 'Nubank',
  amount,
  next_date,
  billing_day: Number(next_date.slice(8)),
  active: true,
  paid_by_me: true,
  frequency: 'monthly',
});

describe('posso gastar hoje', () => {
  it('vai até o último dia útil e desconta só as assinaturas até lá', () => {
    const result = safeToSpend({
      today: '2026-10-06',
      room: '1500.00',
      subscriptions: [
        subscription('Spotify', '2026-10-20', '21.90'),
        // Já cobrada em outubro: a próxima é em novembro.
        subscription('Netflix', '2026-11-03', '44.90'),
      ],
    });
    // 31/10/2026 é sábado: o último dia útil é sexta, 30/10.
    expect(result.until).toBe('2026-10-30');
    expect(result.days).toBe(25);
    expect(result.subscriptionsTotal).toBe('21.90');
    expect(result.free).toBe('1478.10');
    expect(result.perDay).toBe('59.12');
  });

  it('no último dia útil, é um dia só', () => {
    const result = safeToSpend({
      today: '2026-11-30',
      room: '90.00',
      subscriptions: [],
    });
    expect(result.until).toBe('2026-11-30');
    expect(result.days).toBe(1);
    expect(result.perDay).toBe('90.00');
  });

  it('passado o último dia útil, conta só hoje', () => {
    const result = safeToSpend({
      today: '2026-10-31',
      room: '60.00',
      subscriptions: [],
    });
    expect(result.until).toBe('2026-10-31');
    expect(result.days).toBe(1);
  });

  it('pula feriado e fim de semana no fim do mês', () => {
    // 31/01/2027 é domingo, 30 é sábado: o último dia útil é 29/01.
    expect(lastBusinessDay('2027-01')).toBe('2027-01-29');
    // 31/12/2026 é quinta e não é feriado nacional bancário.
    expect(lastBusinessDay('2026-12')).toBe('2026-12-31');
  });

  it('nunca dá valor por dia negativo', () => {
    const result = safeToSpend({
      today: '2026-10-06',
      room: '100.00',
      subscriptions: [subscription('Academia', '2026-10-08', '300.00')],
    });
    expect(result.free).toBe('-200.00');
    expect(result.perDay).toBe('0.00');
  });
});
