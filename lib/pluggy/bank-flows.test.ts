import { describe, expect, it } from 'vitest';
import { findPassThroughs } from './bank-flows';
import type { BankTransaction } from './bank-detail';

const tx = (
  id: string,
  amount: number,
  at: string,
  flow: BankTransaction['flow'] = 'external',
): BankTransaction => ({
  id,
  date: at.slice(0, 10),
  at,
  amount,
  description: id,
  kind: null,
  category: null,
  pending: false,
  flow,
});

describe('findPassThroughs', () => {
  it('junta a entrada e a saída de mesmo valor perto no tempo', () => {
    const { pairs, ids } = findPassThroughs([
      tx('deposito', 150, '2026-09-30T13:00:00Z'),
      tx('boleto', -150, '2026-09-30T13:05:00Z'),
      tx('mercado', -42.9, '2026-09-30T18:00:00Z'),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].in.id).toBe('deposito');
    expect(pairs[0].out.id).toBe('boleto');
    expect(ids.has('mercado')).toBe(false);
  });

  it('não junta valores diferentes nem distantes mais de 12 h', () => {
    const { pairs } = findPassThroughs([
      tx('a', 100, '2026-09-30T08:00:00Z'),
      tx('b', -100.01, '2026-09-30T08:10:00Z'),
      tx('c', 50, '2026-09-28T08:00:00Z'),
      tx('d', -50, '2026-09-30T08:00:00Z'),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('cada transação entra em um par só, o mais próximo primeiro', () => {
    const { pairs } = findPassThroughs([
      tx('in1', 80, '2026-09-30T10:00:00Z'),
      tx('in2', 80, '2026-09-30T15:00:00Z'),
      tx('out', -80, '2026-09-30T15:30:00Z'),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].in.id).toBe('in2');
  });

  it('rendimento não cobre saída', () => {
    const { pairs } = findPassThroughs([
      tx('juros', 1.25, '2026-09-30T03:00:00Z', 'yield'),
      tx('tarifa', -1.25, '2026-09-30T03:00:00Z'),
    ]);
    expect(pairs).toHaveLength(0);
  });
});
