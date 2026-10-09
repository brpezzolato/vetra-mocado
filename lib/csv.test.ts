import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('lê CSV brasileiro com ponto e vírgula', () => {
    expect(parseCsv('Data;Valor;Descrição\n31/08/2026;1.200,50;Aporte')).toEqual(
      {
        headers: ['Data', 'Valor', 'Descrição'],
        rows: [['31/08/2026', '1.200,50', 'Aporte']],
      },
    );
  });
});
