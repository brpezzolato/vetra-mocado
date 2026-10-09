import { describe, expect, it } from 'vitest';
import { leftoverByDay, wishProgress } from './wishlist';

describe('lista de desejos', () => {
  const leftover = leftoverByDay({
    today: '2026-10-07',
    allowances: [
      { day: '2026-10-03', allowance: 50 },
      { day: '2026-10-04', allowance: 50 },
      { day: '2026-10-05', allowance: 50 },
      { day: '2026-10-06', allowance: 50 },
      { day: '2026-10-07', allowance: 50 }, // hoje: ainda não acabou
    ],
    spentByDay: { '2026-10-03': 80, '2026-10-04': 10, '2026-10-06': 30 },
  });

  it('a sobra é o valor do dia menos o gasto, nunca negativa, só dias acabados', () => {
    expect(leftover['2026-10-03'].toFixed(2)).toBe('0.00');
    expect(leftover['2026-10-04'].toFixed(2)).toBe('40.00');
    expect(leftover['2026-10-05'].toFixed(2)).toBe('50.00');
    expect(leftover['2026-10-07']).toBeUndefined();
  });

  it('soma a sobra desde que o desejo entrou e estima os dias que faltam', () => {
    const progress = wishProgress({
      item: { price: 400, created_at: '2026-10-04T10:00:00Z' },
      today: '2026-10-07',
      leftover,
    });
    // 40 + 50 + 20 desde 04/10.
    expect(progress.saved.toFixed(2)).toBe('110.00');
    expect(progress.missing.toFixed(2)).toBe('290.00');
    // Média dos dias com valor: (0 + 40 + 50 + 20) ÷ 4 = 27,50.
    expect(progress.daysLeft).toBe(11);
    expect(progress.ready).toBe(false);
  });

  it('pronto quando a sobra cobre o preço', () => {
    const progress = wishProgress({
      item: { price: 60, created_at: '2026-10-01T10:00:00Z' },
      today: '2026-10-07',
      leftover,
    });
    expect(progress.ready).toBe(true);
    expect(progress.percent).toBe(100);
    expect(progress.daysLeft).toBe(0);
  });
});
