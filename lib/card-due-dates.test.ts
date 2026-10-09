import { describe, expect, it } from 'vitest';
import { dueDateFor, inferDueRule, nextBusinessDay } from './card-due-dates';

describe('vencimento de cada fatura', () => {
  it('Nubank: dia 6, empurrado para o próximo dia útil', () => {
    // As faturas reais: a de setembro caiu em 08/09 porque 06/09 foi
    // domingo e 07/09 feriado; antes de agosto o dia contratado era outro.
    const rule = inferDueRule([
      '2026-09-08',
      '2026-08-06',
      '2026-07-10',
      '2026-06-09',
      '2026-04-27',
    ]);
    expect(rule).toEqual({ day: 6, rollsForward: true });
    expect(dueDateFor('2026-10', rule!)).toBe('2026-10-06');
    expect(dueDateFor('2026-12', rule!)).toBe('2026-12-07');
  });

  it('PicPay: dia 5, mesmo em fim de semana', () => {
    const rule = inferDueRule(['2026-09-05', '2026-08-05', '2026-07-05']);
    expect(rule).toEqual({ day: 5, rollsForward: false });
    expect(dueDateFor('2026-12', rule!)).toBe('2026-12-05');
  });

  it('sem faturas, sem regra', () => {
    expect(inferDueRule([])).toBeNull();
  });

  it('dia útil fica; feriado e fim de semana vão para o próximo útil', () => {
    expect(nextBusinessDay('2026-10-06')).toBe('2026-10-06');
    expect(nextBusinessDay('2026-09-06')).toBe('2026-09-08');
  });
});
