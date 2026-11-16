import { describe, expect, it } from 'vitest';
import { roundVerdict, usedToday, type LocalRound } from './local-rounds';

// 16/11/2026 15h em São Paulo.
const now = new Date('2026-11-16T18:00:00Z');
let seq = 0;
const round = (extra: Partial<LocalRound>): LocalRound => ({
  id: `r${seq++}`,
  trigger: 'schedule',
  status: 'ok',
  result: 'ok',
  detail: '4/4',
  requested_at: '2026-11-16T10:00:00Z',
  started_at: '2026-11-16T10:00:00Z',
  finished_at: '2026-11-16T10:01:00Z',
  ...extra,
});

describe('limites da atualização pelo notebook', () => {
  it('libera sem rodadas no dia', () => {
    expect(roundVerdict([], 'button', now)).toBe('ok');
  });

  it('conta só as aceitas de hoje, por origem', () => {
    const rounds = [
      round({}),
      round({ trigger: 'button' }),
      round({ status: 'failed' }),
      // 23h30 de ontem em São Paulo.
      round({ started_at: '2026-11-16T02:30:00Z' }),
    ];
    expect(usedToday(rounds, now)).toEqual({ schedule: 1, button: 1 });
  });

  it('o botão tem 2 por dia, separado do agendado', () => {
    const two = [round({ trigger: 'button' }), round({ trigger: 'button' })];
    expect(roundVerdict(two, 'button', now)).toBe('daily_cap');
    expect(roundVerdict(two, 'schedule', now)).toBe('ok');
  });

  it('espera 10 min depois de uma aceita', () => {
    const recent = round({
      requested_at: '2026-11-16T17:52:00Z',
      started_at: '2026-11-16T17:52:00Z',
      finished_at: '2026-11-16T17:53:00Z',
    });
    expect(roundVerdict([recent], 'button', now)).toBe('too_soon');
  });

  it('um por vez; pedido velho na fila não trava', () => {
    expect(
      roundVerdict(
        [round({ status: 'pending', requested_at: '2026-11-16T17:55:00Z' })],
        'button',
        now,
      ),
    ).toBe('busy');
    expect(
      roundVerdict(
        [round({ status: 'pending', requested_at: '2026-11-16T16:00:00Z' })],
        'button',
        now,
      ),
    ).toBe('ok');
  });

  it('o próprio pedido não se bloqueia', () => {
    const mine = round({
      id: 'eu',
      trigger: 'button',
      status: 'pending',
      requested_at: '2026-11-16T17:59:00Z',
    });
    expect(roundVerdict([mine], 'button', now, 'eu')).toBe('ok');
  });
});
