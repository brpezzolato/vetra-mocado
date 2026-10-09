import { describe, expect, it } from 'vitest';
import {
  adjustAllowances,
  allowanceForToday,
  allowanceStreak,
  bestStreakInMonth,
  provisionalSince,
  settlesOn,
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

describe('sequência no azul', () => {
  const allowances = [
    { day: '2026-10-01', allowance: 50 },
    { day: '2026-10-02', allowance: 50 },
    { day: '2026-10-03', allowance: 50 },
    // 04/10: o app não abriu — não conta nem quebra.
    { day: '2026-10-05', allowance: 50 },
    { day: '2026-10-06', allowance: 50 },
  ];

  it('conta os dias seguidos no azul e guarda o recorde', () => {
    const result = allowanceStreak({
      today: '2026-10-06',
      allowances,
      spentByDay: {
        '2026-10-01': 80, // estourou
        '2026-10-02': 10,
        '2026-10-03': 50, // no limite ainda é azul
        '2026-10-05': 0,
        '2026-10-06': 20,
      },
    });
    expect(result.current).toBe(4);
    expect(result.best).toBe(4);
  });

  it('hoje estourado ainda não quebra a sequência, mas também não soma', () => {
    const result = allowanceStreak({
      today: '2026-10-06',
      allowances,
      spentByDay: {
        '2026-10-02': 10,
        '2026-10-03': 10,
        '2026-10-05': 10,
        '2026-10-06': 90,
      },
    });
    expect(result.current).toBe(4); // 01, 02, 03, 05
  });

  it('um dia estourado gasta uma recuperação e não zera a sequência', () => {
    const result = allowanceStreak({
      today: '2026-10-06',
      allowances,
      spentByDay: { '2026-10-05': 70, '2026-10-06': 0 },
    });
    // 01, 02, 03 e 06 somam; 05 foi salvo e não soma.
    expect(result.current).toBe(4);
    expect(result.saved).toEqual(['2026-10-05']);
    // A semana de 04 a 10/10 tinha 2 e usou 1.
    expect(result.savesLeft).toBe(1);
  });

  it('o terceiro dia estourado na mesma semana zera', () => {
    const week = ['04', '05', '06', '07', '08'].map((day) => ({
      day: `2026-10-${day}`,
      allowance: 50,
    }));
    const result = allowanceStreak({
      today: '2026-10-08',
      allowances: [...allowances.slice(0, 3), ...week],
      spentByDay: { '2026-10-04': 90, '2026-10-05': 90, '2026-10-06': 90 },
    });
    // 04 e 05 salvos; 06 quebra; 07 e 08 recomeçam.
    expect(result.current).toBe(2);
    expect(result.best).toBe(3);
    expect(result.savesLeft).toBe(0);
  });

  it('as recuperações voltam a cada semana (de domingo a sábado)', () => {
    const result = allowanceStreak({
      today: '2026-10-05',
      allowances: [
        { day: '2026-10-02', allowance: 50 },
        { day: '2026-10-03', allowance: 50 },
        { day: '2026-10-04', allowance: 50 },
        { day: '2026-10-05', allowance: 50 },
      ],
      // 02 e 03 (semana de 27/09) usam as duas daquela semana; 04 é domingo,
      // semana nova.
      spentByDay: { '2026-10-02': 90, '2026-10-03': 90, '2026-10-04': 90 },
    });
    expect(result.savesLeft).toBe(1);
  });

  it('o melhor do mês para a retrospectiva, com a mesma regra', () => {
    // 03 estourou, mas foi salvo: 01, 02, 05 e 06 seguem juntos.
    expect(bestStreakInMonth('2026-10', allowances, { '2026-10-03': 99 })).toBe(
      4,
    );
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

  it('a sequência com dias recentes é provisória; a antiga, não', () => {
    const recent = allowanceStreak({
      today: '2026-10-07',
      allowances: [
        { day: '2026-10-05', allowance: 50 },
        { day: '2026-10-06', allowance: 50 },
      ],
      spentByDay: {},
    });
    expect(recent.current).toBe(2);
    expect(recent.provisional).toBe(true);
    const old = allowanceStreak({
      today: '2026-09-25',
      now: '2026-10-07',
      allowances: [
        { day: '2026-09-24', allowance: 50 },
        { day: '2026-09-25', allowance: 50 },
      ],
      spentByDay: {},
    });
    expect(old.current).toBe(2);
    expect(old.provisional).toBe(false);
  });
});
