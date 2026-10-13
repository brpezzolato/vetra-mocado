import type { FinancialEntry } from './financial-tracker';
import { describe, expect, it } from 'vitest';
import {
  adjustAllowances,
  allowanceForToday,
  daysInTheBlue,
  provisionalSince,
  settlesOn,
  spentByDayOf,
} from './daily-allowance';

describe('valor do dia', () => {
  it('o gasto de hoje não encolhe o valor de hoje', () => {
    // Tinha 1.330 de manhã; gastou 30; a barra mostra 1.300.
    const morning = allowanceForToday({
      today: '2026-10-06',
      room: '1300.00',
      spentToday: '30.00',
      subscriptions: [],
    });
    expect(morning.perDay).toBe('53.20'); // 1.330 ÷ 25 (até sexta, 30/10)
  });

  it('a sobra de hoje reforça amanhã', () => {
    // Valor de 50 por dia com 1.300 em 26 dias; gastou só 30 hoje.
    const tomorrow = allowanceForToday({
      today: '2026-10-07',
      room: '1270.00',
      spentToday: '0.00',
      subscriptions: [],
    });
    expect(Number(tomorrow.perDay)).toBeGreaterThan(50);
    expect(tomorrow.perDay).toBe('52.91'); // 1.270 ÷ 24
  });
});

describe('dias no azul', () => {
  const allowances = [
    { day: '2026-10-01', allowance: 50 },
    { day: '2026-10-02', allowance: 50 },
    { day: '2026-10-03', allowance: 50 },
    // 04/10: o app não abriu — não conta.
    { day: '2026-10-05', allowance: 50 },
    { day: '2026-10-06', allowance: 50 },
  ];

  it('soma todos os dias dentro do valor, desde o começo', () => {
    const result = daysInTheBlue({
      today: '2026-10-06',
      allowances,
      spentByDay: { '2026-10-01': 30, '2026-10-02': 50, '2026-10-05': 10 },
    });
    expect(result.total).toBe(5);
  });

  it('um dia acima do valor só não soma; nada zera', () => {
    const result = daysInTheBlue({
      today: '2026-10-06',
      allowances,
      spentByDay: { '2026-10-02': 80, '2026-10-03': 51 },
    });
    expect(result.total).toBe(3);
  });

  it('hoje conta se, até agora, está no azul', () => {
    const base = { today: '2026-10-06', allowances };
    expect(
      daysInTheBlue({ ...base, spentByDay: { '2026-10-06': 20 } }).total,
    ).toBe(5);
    expect(
      daysInTheBlue({ ...base, spentByDay: { '2026-10-06': 70 } }).total,
    ).toBe(4);
  });

  it('no resumo, conta só até o dia escolhido', () => {
    expect(
      daysInTheBlue({
        today: '2026-10-02',
        now: '2026-10-06',
        allowances,
        spentByDay: {},
      }).total,
    ).toBe(2);
  });
});

describe('janela de 3 dias úteis', () => {
  it('um dia vira definitivo 3 dias úteis depois', () => {
    // Sexta 02/10 → seg 05, ter 06, qua 07.
    expect(settlesOn('2026-10-02')).toBe('2026-10-07');
  });

  it('conta 3 dias úteis para trás, pulando fim de semana', () => {
    // Quarta 07/10 → seg 05, sex 02, qui 01.
    expect(provisionalSince('2026-10-07')).toBe('2026-10-02');
    // Segunda 05/10 → sex 02, qui 01, qua 30/09.
    expect(provisionalSince('2026-10-05')).toBe('2026-09-30');
  });

  it('recalcula o valor do dia com a compra que chegou atrasada, só para baixo', () => {
    // Em 06/10 o valor foi 60 (ele tinha 1.500). Chega hoje, 07/10, uma
    // compra de 06/10 de 300: agora tem 1.200 e gastou 300 desde 06/10.
    const { adjusted, changed } = adjustAllowances({
      today: '2026-10-07',
      room: '1200.00',
      allowances: [
        { day: '2026-09-20', allowance: '99.00' }, // fora da janela
        { day: '2026-10-06', allowance: '60.00' },
      ],
      spentByDay: { '2026-10-06': '300.00' },
      subscriptions: [],
    });
    // 1.500 ÷ 25 dias (06/10 até 30/10) = 60: não muda.
    expect(adjusted[1].allowance).toBe('60.00');
    expect(changed).toHaveLength(0);
    expect(adjusted[0].allowance).toBe('99.00');

    // Se o valor guardado tinha ficado alto (calculado sem a compra), cai.
    const second = adjustAllowances({
      today: '2026-10-07',
      room: '900.00',
      allowances: [{ day: '2026-10-06', allowance: '60.00' }],
      spentByDay: { '2026-10-06': '300.00' },
      subscriptions: [],
    });
    expect(second.adjusted[0].allowance).toBe('48.00'); // 1.200 ÷ 25
    expect(second.changed).toEqual([{ day: '2026-10-06', allowance: '48.00' }]);
  });

  it('dias recentes deixam o total provisório; antigos, não', () => {
    const recent = daysInTheBlue({
      today: '2026-10-07',
      allowances: [
        { day: '2026-10-05', allowance: 50 },
        { day: '2026-10-06', allowance: 50 },
      ],
      spentByDay: {},
    });
    expect(recent.total).toBe(2);
    expect(recent.provisional).toBe(true);
    const old = daysInTheBlue({
      today: '2026-09-25',
      now: '2026-10-07',
      allowances: [
        { day: '2026-09-24', allowance: 50 },
        { day: '2026-09-25', allowance: 50 },
      ],
      spentByDay: {},
    });
    expect(old.total).toBe(2);
    expect(old.provisional).toBe(false);
  });
});

describe('gasto do dia', () => {
  const buy = (amount: string, extra: Partial<FinancialEntry> = {}) =>
    ({
      id: amount,
      user_id: 'u',
      entry_type: 'expense',
      amount,
      description: 'Compra',
      category: 'Compras',
      account: 'Nubank',
      occurred_at: '2026-10-12T15:00:00-03:00',
      source: 'manual',
      external_id: null,
      created_at: '2026-10-12T15:00:00-03:00',
      updated_at: '2026-10-12T15:00:00-03:00',
      ...extra,
    }) as FinancialEntry;

  it('presente marcado fica fora do valor do dia; o resto conta', () => {
    const spent = spentByDayOf(
      [buy('30.00'), buy('250.00', { excluded_from_daily: true })],
      Date.parse('2026-10-13T12:00:00-03:00'),
    );
    expect(spent['2026-10-12']?.toFixed(2)).toBe('30.00');
  });
});
