import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { EarningEntry } from './finance';
import { closedSummaries, monthlyYields } from './vault-history';

const earning = (date: string, net: string): EarningEntry => ({
  date,
  grossAmount: null,
  netAmount: new Decimal(net),
  taxes: null,
});

describe('quanto já ganhei, mês a mês', () => {
  const current = [
    {
      name: 'Minha Reserva',
      bank: 'Nubank',
      earnings: [earning('2026-09-02', '0.50'), earning('2026-10-01', '0.60')],
    },
    {
      name: 'Adiantamento',
      bank: 'Mercado Pago',
      // O dia negativo é dinheiro que saiu sem aparecer: não conta.
      earnings: [
        earning('2026-09-20', '0.10'),
        earning('2026-09-29', '-59.80'),
      ],
    },
  ];
  const archived = {
    name: 'Viagem',
    bank: 'Mercado Pago',
    archivedAt: '2026-09-25T12:00:00Z',
    earnings: [earning('2026-09-10', '1.00'), earning('2026-09-11', '1.50')],
  };

  it('soma atuais e encerrados, do mês mais novo ao mais velho', () => {
    expect(
      monthlyYields([...current, archived]).map(({ month, total }) => [
        month,
        total.toFixed(2),
      ]),
    ).toEqual([
      ['2026-10', '0.60'],
      ['2026-09', '3.10'],
    ]);
  });

  it('o encerrado fica registrado com o quanto rendeu', () => {
    expect(
      closedSummaries([archived]).map((item) => [
        item.label,
        item.detail,
        item.total.toFixed(2),
      ]),
    ).toEqual([['Mercado Pago · Viagem', 'Encerrado em 25/09', '2.50']]);
  });
});
