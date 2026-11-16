import { describe, expect, it } from 'vitest';
import {
  currentSlot,
  roundVerdict,
  usedToday,
  type LocalRound,
} from './local-rounds';

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

describe('horário da rodada automática', () => {
  const at = (iso: string) => currentSlot(new Date(iso))?.toISOString() ?? null;

  it('acha o horário mais recente dentro da janela de 3 h', () => {
    // 14h20 em São Paulo.
    expect(at('2026-11-16T17:20:00Z')).toBe('2026-11-16T17:00:00.000Z');
    // 16h59: ainda o das 14h; 17h01: janela fechada.
    expect(at('2026-11-16T19:59:00Z')).toBe('2026-11-16T17:00:00.000Z');
    expect(at('2026-11-16T20:01:00Z')).toBeNull();
  });

  it('o das 23h vale depois da meia-noite', () => {
    // 00h30 de 17/11 em São Paulo.
    expect(at('2026-11-17T03:30:00Z')).toBe('2026-11-17T02:00:00.000Z');
  });

  it('o das 18h passa a valer no lugar do das 14h', () => {
    // 18h10 em São Paulo.
    expect(at('2026-11-16T21:10:00Z')).toBe('2026-11-16T21:00:00.000Z');
  });

  it('de madrugada, nenhum', () => {
    // 4h em São Paulo.
    expect(at('2026-11-16T07:00:00Z')).toBeNull();
  });
});
