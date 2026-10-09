import { describe, expect, it } from 'vitest';
import { oddNameReasons, reviewKey, reviewQueue } from './review-queue';
import type { FinancialEntry } from './financial-tracker';

let id = 0;
const entry = (
  description: string,
  category: string,
  amount: string,
  day = '2026-10-05',
): FinancialEntry => ({
  id: String(id++),
  user_id: 'u',
  entry_type: 'expense',
  amount,
  description,
  category,
  account: 'Nubank',
  occurred_at: `${day}T15:00:00Z`,
  source: 'pluggy',
  external_id: null,
  created_at: '',
  updated_at: '',
});

describe('fila de revisão', () => {
  it('reconhece nome estranho', () => {
    expect(oddNameReasons('Mlp*Netshoes-Adidas')).toContain(
      'código da maquininha',
    );
    expect(oddNameReasons('[número oculto]-Paroquia Nossa S')).toContain(
      'número no nome',
    );
    expect(oddNameReasons('MERCADO PAGO INSTITUICAO DE PAGAMENTO')).toContain(
      'tudo em maiúsculas',
    );
    expect(oddNameReasons('Lavanderia')).toEqual([]);
    expect(oddNameReasons('99')).toEqual([]);
  });

  it('uma carta por loja, das que mais pesam, sem as puladas', () => {
    const queue = reviewQueue(
      [
        entry('Tio Gil Magazine', 'Outros', '25.40'),
        entry('Tio Gil Magazine', 'Outros', '10.00', '2026-10-06'),
        entry('MERCADO PAGO INSTITUICAO DE PAGAMENTO', 'Outros', '35.44'),
        entry('Lavanderia', 'Serviços', '18.00'),
        entry('Pulada', 'Outros', '99.00'),
        entry('Antiga', 'Outros', '50.00', '2026-05-01'),
      ],
      new Set([reviewKey('Pulada')]),
      '2026-10-07',
    );
    expect(queue.map((card) => card.description)).toEqual([
      'MERCADO PAGO INSTITUICAO DE PAGAMENTO',
      'Tio Gil Magazine',
    ]);
    expect(queue[1]).toMatchObject({
      count: 2,
      total: '35.40',
      lastDay: '2026-10-06',
      reasons: ['sem categoria'],
    });
  });

  it('loja já categorizada não volta só pelo nome estranho', () => {
    const queue = reviewQueue(
      [
        // Ele deu categoria, mas o nome continua o do banco.
        entry('Mlp*Netshoes-Adidas', 'Compras', '149.99'),
        // Mesmo nome, compra nova ainda em "Outros": essa volta.
        entry('Ifd*Quintal', 'Alimentação', '40.00'),
        entry('Ifd*Quintal', 'Outros', '30.00'),
      ],
      new Set(),
      '2026-10-07',
      new Set(['mlp*netshoes-adidas', 'ifd*quintal']),
    );
    expect(queue.map((card) => card.description)).toEqual(['Ifd*Quintal']);
    expect(queue[0].count).toBe(1);
  });
});
