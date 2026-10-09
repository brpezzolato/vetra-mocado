import { describe, expect, it } from 'vitest';
import {
  describeSummary,
  groupRounds,
  runStatus,
  summarize,
  type SyncRun,
} from './run-summary';

describe('summarize', () => {
  it('junta cartões e cofrinhos só em contagens e totais', () => {
    const summary = summarize(
      {
        linked: 2,
        saved: 2,
        keptManual: 0,
        skipped: 0,
        created: 1,
        archived: 0,
        movements: 3,
        errors: 0,
        banks: [],
      },
      {
        cards: 1,
        inserted: 4,
        spent: 120.456,
        earned: 50,
        updated: 1,
        removed: 0,
        bills: 1,
        errors: 1,
      },
    );
    expect(summary).toEqual({
      entries: 4,
      spent: 120.46,
      earned: 50,
      updated: 1,
      removed: 0,
      movements: 3,
      vaultsCreated: 1,
      vaultsArchived: 0,
      errors: 1,
    });
    expect(runStatus(summary, false)).toBe('partial');
    expect(runStatus(summary, true)).toBe('error');
  });
});

describe('describeSummary', () => {
  it('diz quando não veio nada', () => {
    expect(describeSummary(summarize(null, null))).toBe(
      'Nada novo desde a última atualização.',
    );
  });

  it('resume o que chegou numa frase', () => {
    const text = describeSummary({
      entries: 3,
      spent: 120,
      earned: 0,
      movements: 1,
    }).replace(/\s/g, ' ');
    expect(text).toBe(
      '3 lançamentos novos (R$ 120,00 em saídas) e 1 movimentação nos cofrinhos.',
    );
  });

  it('usa o singular', () => {
    expect(describeSummary({ entries: 1 })).toBe('1 lançamento novo.');
  });
});

describe('groupRounds', () => {
  const run = (
    id: number,
    trigger: SyncRun['trigger'],
    at: string,
    ms: number,
    summary: SyncRun['summary'] = {},
  ): SyncRun => ({
    id,
    trigger,
    status: 'ok',
    started_at: `2026-10-02T${at}Z`,
    duration_ms: ms,
    robot: null,
    summary,
    error: null,
  });

  it('junta um clique e os avisos do banco numa rodada, do início ao fim', () => {
    const rounds = groupRounds([
      run(5, 'webhook', '01:12:20', 8000),
      run(4, 'webhook', '01:12:17', 9000),
      run(3, 'manual', '01:12:16', 9000, { updated: 6 }),
      run(2, 'webhook', '01:12:13', 10000, { entries: 1, spent: 20 }),
      run(1, 'webhook', '01:12:12', 10000, { updated: 15 }),
    ]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].trigger).toBe('manual');
    expect(rounds[0].started_at).toBe('2026-10-02T01:12:12Z');
    // De 01:12:12 até o fim da última (01:12:20 + 8 s).
    expect(rounds[0].duration_ms).toBe(16000);
    expect(rounds[0].summary).toMatchObject({
      entries: 1,
      spent: 20,
      updated: 15,
    });
  });

  it('separa rodadas distantes e mantém o mais recente primeiro', () => {
    const rounds = groupRounds([
      run(2, 'manual', '10:12:06', 10000),
      run(1, 'cron', '08:34:47', 48000),
    ]);
    expect(rounds.map((r) => r.trigger)).toEqual(['manual', 'cron']);
  });
});
