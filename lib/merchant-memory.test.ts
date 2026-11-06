import { describe, expect, it } from 'vitest';
import { merchantMemory } from './merchant-memory';

const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T15:00:00Z`;

describe('memória de nomes', () => {
  it('a compra nova segue o nome que o usuário deu ao mesmo lugar', () => {
    const memory = merchantMemory([
      {
        description: 'Farmácia da Esquina',
        bank_description: 'MEGA FARMASAO CAETANO DBRA',
        occurred_at: at(1),
      },
    ]);
    expect(
      memory.name({
        description: 'Mega Farma',
        bankDescription: 'MEGA FARMA SAO PAULO BRA',
      }),
    ).toBe('Farmácia da Esquina');
  });

  it('vale o nome mais recente', () => {
    const memory = merchantMemory([
      { description: 'Novo', bank_description: 'LOJA X', occurred_at: at(5) },
      { description: 'Velho', bank_description: 'LOJA X', occurred_at: at(1) },
    ]);
    expect(
      memory.name({ description: 'Loja X', bankDescription: 'LOJA X' }),
    ).toBe('Novo');
  });

  it('a parcela herda o nome das outras parcelas', () => {
    const memory = merchantMemory([
      { description: 'GTA VI', installment_group_id: 'g1', occurred_at: at(1) },
    ]);
    expect(
      memory.name({ description: 'Playstation', installmentGroupId: 'g1' }),
    ).toBe('GTA VI');
  });

  it('usa a grafia que o lugar já tem, menos a gritada', () => {
    const memory = merchantMemory([
      { description: 'Hilton Pipocas', occurred_at: at(1) },
      { description: 'Hilton Pipocas', occurred_at: at(2) },
      { description: 'HILTON PIPOCAS', occurred_at: at(3) },
      { description: 'HILTON PIPOCAS', occurred_at: at(4) },
      { description: 'HILTON PIPOCAS', occurred_at: at(5) },
    ]);
    expect(memory.name({ description: 'Hiltonpipocas' })).toBe(
      'Hilton Pipocas',
    );
    expect(memory.name({ description: 'Lugar Novo' })).toBe('Lugar Novo');
  });
});
