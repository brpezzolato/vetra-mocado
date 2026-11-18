import { describe, expect, it } from 'vitest';
import { connectionNotices, connectionState } from './connection-health';

const now = Date.parse('2026-10-06T12:00:00Z');

describe('saúde da conexão', () => {
  it('atualizada há pouco está em dia', () => {
    expect(
      connectionState(
        { status: 'UPDATED', lastUpdatedAt: '2026-10-06T08:00:00Z' },
        true,
        now,
      ),
    ).toEqual({ state: 'ok', days: 0 });
  });

  it('mais de 2 dias sem atualizar fica desatualizada', () => {
    expect(
      connectionState(
        { status: 'UPDATED', lastUpdatedAt: '2026-10-03T08:00:00Z' },
        true,
        now,
      ),
    ).toEqual({ state: 'stale', days: 3 });
  });

  it('erro, login pendente ou conexão sem contas é problema', () => {
    expect(
      connectionState(
        { status: 'LOGIN_ERROR', lastUpdatedAt: '2026-10-06T08:00:00Z' },
        true,
        now,
      ).state,
    ).toBe('error');
    // A do Itaú refeita: o item antigo ficou sem contas.
    expect(
      connectionState(
        { status: 'UPDATED', lastUpdatedAt: '2026-09-30T12:00:00Z' },
        false,
        now,
      ).state,
    ).toBe('error');
  });

  it('atualizando agora não é problema', () => {
    expect(
      connectionState(
        { status: 'UPDATING', lastUpdatedAt: '2026-10-01T08:00:00Z' },
        true,
        now,
      ).state,
    ).toBe('updating');
  });
});

describe('avisos das conexões', () => {
  const base = {
    bank: 'nubank',
    updatedAt: null,
    state: 'ok' as const,
    days: 0,
  };
  const day = '2026-10-06';

  it('consentimento avisa aos 15, 7 e 1 dia, um aviso por marco', () => {
    const at = (iso: string) =>
      connectionNotices([{ ...base, consentExpiresAt: iso }], null, day, now);
    expect(at('2026-12-01T00:00:00Z')).toEqual([]);
    expect(at('2026-10-16T12:00:00Z')[0]).toMatchObject({
      key: 'pluggy-consent:nubank:2026-10-16:15',
      title: 'Consentimento do Nubank vence em 10 dias',
    });
    expect(at('2026-10-07T12:00:00Z')[0].title).toBe(
      'Consentimento do Nubank vence amanhã',
    );
    expect(at('2026-10-05T12:00:00Z')[0].title).toBe(
      'Consentimento do Nubank venceu',
    );
  });

  it('pedido de confirmação, automática desligada e sessão do notebook vencida', () => {
    const titles = connectionNotices(
      [{ ...base, waitingInput: true, autoSyncOff: true }],
      'expired',
      day,
      now,
    ).map((notice) => notice.title);
    expect(titles).toEqual([
      'Nubank pede uma confirmação',
      'Atualização automática do Nubank desligada',
      'Sessão do Meu Pluggy no notebook expirou',
    ]);
    expect(connectionNotices([base], 'ok', day, now)).toEqual([]);
  });

  it('notebook sem sinal por mais de 9 h avisa; a noite não', () => {
    const at = (lastSeenAt: string | null) =>
      connectionNotices([base], 'ok', day, now, { lastSeenAt }).map(
        (notice) => notice.key,
      );
    // 7 h sem sinal (da rodada das 23h à das 7h): normal.
    expect(at(new Date(now - 7 * 3_600_000).toISOString())).toEqual([]);
    expect(at(new Date(now - 10 * 3_600_000).toISOString())).toEqual([
      `pluggy-local:offline:${day}`,
    ]);
    expect(at(null)).toEqual([`pluggy-local:offline:${day}`]);
    // Notebook nunca instalado (sem estado): nada.
    expect(connectionNotices([base], null, day, now)).toEqual([]);
  });

  it('automação falhando duas vezes seguidas avisa; uma vez só, não', () => {
    const at = (recentResults: string[]) =>
      connectionNotices([base], recentResults[0] ?? null, day, now, {
        lastSeenAt: new Date(now).toISOString(),
        recentResults,
      }).map((notice) => notice.key);
    expect(at(['no_button', 'no_button'])).toEqual([
      `pluggy-local:broken:${day}`,
    ]);
    expect(at(['error', 'late'])).toEqual([`pluggy-local:broken:${day}`]);
    expect(at(['no_button', 'ok'])).toEqual([]);
    expect(at(['ok', 'error'])).toEqual([]);
  });
});
