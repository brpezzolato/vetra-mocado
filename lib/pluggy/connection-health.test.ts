import { describe, expect, it } from 'vitest';
import { connectionState } from './connection-health';

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
