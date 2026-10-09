import { describe, expect, it } from 'vitest';
import { effectiveCreditLimit } from './client';

describe('limite do cartão', () => {
  it('usa o limite que o cliente escolheu, quando há um', () => {
    expect(
      effectiveCreditLimit({
        creditLimit: 3200,
        disaggregatedCreditLimits: [
          {
            creditLineLimitType: 'LIMITE_CREDITO_MODALIDADE_OPERACAO',
            customizedLimitAmount: 999,
          },
          {
            creditLineLimitType: 'LIMITE_CREDITO_TOTAL',
            limitAmount: 3200,
            customizedLimitAmount: 1780,
          },
        ],
      }),
    ).toBe(1780);
  });

  it('sem limite escolhido, fica o do banco', () => {
    expect(
      effectiveCreditLimit({
        creditLimit: 600,
        disaggregatedCreditLimits: [
          { creditLineLimitType: 'LIMITE_CREDITO_TOTAL', limitAmount: 600 },
        ],
      }),
    ).toBe(600);
    expect(effectiveCreditLimit({ creditLimit: 600 })).toBe(600);
  });
});
