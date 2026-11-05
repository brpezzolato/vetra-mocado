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

  it('pedido de confirmação, automática desligada e robô parado', () => {
    const titles = connectionNotices(
      [{ ...base, waitingInput: true, autoSyncOff: true }],
      { status: 'expired', last_error: 'Sessão expirada.' },
      day,
      now,
    ).map((notice) => notice.title);
    expect(titles).toEqual([
      'Nubank pede uma confirmação',
      'Atualização automática do Nubank desligada',
      'Sessão do robô do Meu Pluggy expirou',
    ]);
    expect(
      connectionNotices(
        [base],
        { status: 'active', last_error: null },
        day,
        now,
      ),
    ).toEqual([]);
  });
});
