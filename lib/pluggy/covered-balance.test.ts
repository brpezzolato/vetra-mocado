import { describe, expect, it } from 'vitest';
import { coveredBalance } from './account-balances';

describe('saldo negativo coberto pela aplicação automática', () => {
  it('negativo sem cheque especial em uso conta como zero', () => {
    // Itaú em 16/10/2026: −147,39 com R$ 0 do cheque especial usado.
    expect(coveredBalance(-147.39, 0)).toBe(0);
  });

  it('com cheque especial em uso, ou sem a informação, o negativo fica', () => {
    expect(coveredBalance(-147.39, 147.39)).toBe(-147.39);
    expect(coveredBalance(-147.39, null)).toBe(-147.39);
  });

  it('saldo positivo não muda', () => {
    expect(coveredBalance(974.99, 0)).toBe(974.99);
  });
});
