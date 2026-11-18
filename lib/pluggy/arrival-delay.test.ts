import { describe, expect, it } from 'vitest';
import { delayLabel, typicalDelayHours } from './arrival-delay';

const row = (occurred: string, created: string) => ({
  occurred_at: occurred,
  created_at: created,
});

describe('atraso típico das compras', () => {
  it('mediana do tempo até chegar, em horas', () => {
    const rows = [
      // Primeira chegada (importação inicial): 01/11 10h.
      row('2026-10-20T12:00:00Z', '2026-11-01T10:00:00Z'),
      row('2026-11-02T12:00:00Z', '2026-11-05T12:00:00Z'), // 72 h
      row('2026-11-03T12:00:00Z', '2026-11-05T12:00:00Z'), // 48 h
      row('2026-11-04T12:00:00Z', '2026-11-06T12:00:00Z'), // 48 h
    ];
    expect(typicalDelayHours(rows)).toBe(48);
  });

  it('a importação inicial não conta como atraso', () => {
    const rows = [
      row('2026-10-25T12:00:00Z', '2026-11-01T10:00:00Z'),
      row('2026-10-30T12:00:00Z', '2026-11-01T10:00:00Z'),
      row('2026-11-02T12:00:00Z', '2026-11-02T13:00:00Z'),
      row('2026-11-03T12:00:00Z', '2026-11-03T13:00:00Z'),
      row('2026-11-04T12:00:00Z', '2026-11-04T15:00:00Z'),
    ];
    expect(typicalDelayHours(rows)).toBe(1);
  });

  it('lançamento antigo que veio muito depois fica de fora', () => {
    const rows = [
      row('2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z'),
      row('2026-10-02T12:00:00Z', '2026-10-02T16:00:00Z'),
      row('2026-10-03T12:00:00Z', '2026-10-03T16:00:00Z'),
      row('2026-10-04T12:00:00Z', '2026-10-04T16:00:00Z'),
      row('2026-10-05T12:00:00Z', '2026-11-05T12:00:00Z'), // 31 dias
    ];
    expect(typicalDelayHours(rows)).toBe(4);
  });

  it('poucas compras: ainda não diz', () => {
    expect(typicalDelayHours([])).toBeNull();
    expect(
      typicalDelayHours([
        row('2026-11-01T12:00:00Z', '2026-11-01T13:00:00Z'),
        row('2026-11-02T12:00:00Z', '2026-11-02T13:00:00Z'),
      ]),
    ).toBeNull();
  });

  it('frase do selo', () => {
    expect(delayLabel(null)).toBeNull();
    expect(delayLabel(1)).toBe('Compras chegam quase na hora');
    expect(delayLabel(5)).toBe('Compras chegam em ~5 h');
    expect(delayLabel(30)).toBe('Compras chegam em ~1 dia');
    expect(delayLabel(60)).toBe('Compras chegam em ~3 dias');
  });
});
