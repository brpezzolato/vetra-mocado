import { describe, expect, it } from 'vitest';
import { financialChatContext } from './finance-chat';

describe('financialChatContext', () => {
  it('summarizes current financial data without exposing entry identifiers', () => {
    const now = new Date().toISOString();
    const context = financialChatContext([
      {
        entry_type: 'expense',
        amount: '23.50',
        description: 'Padaria',
        category: 'Alimentação',
        account: 'Nubank',
        occurred_at: now,
      },
      {
        entry_type: 'income',
        amount: '100.00',
        description: 'Salário',
        category: 'Receita',
        account: 'Conta',
        occurred_at: now,
      },
    ]);

    expect(context).toContain('R$ 23,50');
    expect(context).toContain('R$ 100,00');
    expect(context).toContain('Alimentação');
    expect(context).toContain('Padaria');
    // De onde veio a receita (o empregador) vai como apelido.
    expect(context).not.toContain('Salário');
    expect(context).toContain('[origem 1]');
    expect(context).toContain('Base completa analisada: 2 lançamentos');
    expect(context).toContain('Totais mensais');
  });

  it('includes every financial row in the protected model context', () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({
      entry_type: 'expense' as const,
      amount: index + 1,
      description: `Compra ${index + 1}`,
      category: index % 2 ? 'Compras' : 'Alimentação',
      account: 'Cartão',
      occurred_at: new Date(2026, 0, index + 1).toISOString(),
    }));
    const context = financialChatContext(entries);
    expect(context).toContain('Compra 1');
    expect(context).toContain('Compra 25');
    expect(context).toContain('Base completa analisada: 25 lançamentos');
  });
});
