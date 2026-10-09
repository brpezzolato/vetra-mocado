import { describe, expect, it } from 'vitest';
import type { BenefitCardBalance } from './benefit-cards';
import {
  flashFacts,
  invoiceFacts,
  spendingFacts,
  vaultFacts,
} from './finance-chat-facts';
import {
  financialChatContext,
  splitFollowUps,
  stripFollowUps,
} from './finance-chat';
import type { FinancialEntry } from './financial-tracker';

// Intl põe um espaço inseparável entre "R$" e o valor; os testes comparam
// com espaço comum para continuarem legíveis.
const plain = (text: string) => text.replace(/ /g, ' ');

let counter = 0;
const entry = (
  occurred_at: string,
  amount: string,
  extra: Partial<FinancialEntry> = {},
): FinancialEntry => ({
  id: `entry-${counter++}`,
  user_id: 'user',
  entry_type: 'expense',
  amount,
  description: 'Mercado',
  category: 'Alimentação',
  account: 'Nubank',
  occurred_at,
  source: 'manual',
  external_id: null,
  created_at: occurred_at,
  updated_at: occurred_at,
  ...extra,
});

describe('gastos já somados para o Vetra AI', () => {
  const entries = [
    entry('2026-08-03T15:00:00Z', '100.00'),
    entry('2026-08-05T15:00:00Z', '50.00', {
      description: 'Ifood',
      category: 'Delivery',
    }),
    entry('2026-08-20T15:00:00Z', '300.00'),
    entry('2026-09-02T15:00:00Z', '40.00'),
    entry('2026-09-04T15:00:00Z', '80.00', {
      description: 'Ifood',
      category: 'Delivery',
    }),
    entry('2026-09-10T15:00:00Z', '1000.00', {
      entry_type: 'income',
      description: 'Salário',
      category: 'Salário',
    }),
  ];
  const facts = plain(spendingFacts(entries, '2026-09-05'));

  it('soma cada mês, com média por dia e categorias', () => {
    expect(facts).toContain(
      'agosto/2026: gastos R$ 450,00 em 3 lançamentos, média R$ 14,52 por dia',
    );
    expect(facts).toContain('Alimentação R$ 400,00 (2 lançamentos)');
    // O mês corrente divide pelos dias que já passaram, não pelos trinta.
    expect(facts).toContain(
      'setembro/2026 (em andamento, até o dia 5): gastos R$ 120,00 em 2 lançamentos, média R$ 24,00 por dia',
    );
  });

  it('lista onde mais gastou, juntando as repetições', () => {
    expect(facts).toContain('Mercado R$ 400,00 em 2x');
  });

  it('compara o mês atual com o mesmo trecho do anterior', () => {
    // 1º a 5 de agosto: 100 + 50. De agosto, o 20 fica de fora.
    expect(facts).toContain(
      '1º a 05 de agosto/2026): R$ 120,00 agora, R$ 150,00 antes, diferença −R$ 30,00',
    );
    expect(facts).toContain('Alimentação −R$ 60,00');
    expect(facts).toContain('Delivery +R$ 30,00');
  });

  it('não conta como receita do mês um lançamento futuro', () => {
    expect(facts).not.toContain('outubro');
  });
});

describe('cofrinhos para o Vetra AI', () => {
  it('avisa que o saldo de hoje não está disponível sem o CDI', () => {
    const facts = vaultFacts(
      [
        {
          id: 'vault',
          user_id: 'user',
          bank: 'Nubank',
          name: 'Reserva',
          product: 'Caixinha Turbo',
          cdi_percentage: 115,
          tax_rule: 'Regressivo',
          iof_rule: 'Regressivo',
          accrues_on_deposit_day: false,
          rate_limit: 5000,
          excess_rate: 100,
          policy_version: 'NUB-TURBO-115',
          policy_started_at: null,
          policy_ends_at: null,
          archived_at: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
          transactions: [],
          balance_snapshots: [],
          bank_earning_credits: [],
        },
      ],
      null,
      new Date('2026-09-28T15:00:00Z'),
    );
    expect(facts).toContain('não respondeu agora');
    expect(facts).toContain('última conferência');
  });
});

describe('Flash para o Vetra AI', () => {
  const balance: BenefitCardBalance = {
    id: 'reading',
    user_id: 'user',
    account: 'Flash Alimentação',
    balance: '500.00',
    measured_at: '2026-09-22',
    source: 'manual',
    created_at: '2026-09-22',
    updated_at: '2026-09-22',
  };

  it('dá o saldo corrente de cada carteira e a previsão', () => {
    const facts = plain(
      flashFacts(
        [
          entry('2026-09-22T15:00:00Z', '900.00', {
            entry_type: 'income',
            account: 'Flash',
            category: 'Outros',
          }),
          entry('2026-09-25T15:00:00Z', '100.00', { account: 'Flash' }),
        ],
        [balance],
        '2026-09-28',
      ),
    );
    expect(facts).toContain('Alimentação e Refeição: saldo agora R$ 400,00');
    expect(facts).toContain('última leitura R$ 500,00 em 22/09/2026');
    expect(facts).toContain('dura até o próximo depósito');
    expect(facts).toContain('Transporte: saldo nunca informado');
  });

  it('fica de fora quando não há Flash', () => {
    expect(
      flashFacts([entry('2026-09-25T15:00:00Z', '10.00')], [], '2026-09-28'),
    ).toBe('');
  });
});

describe('privacidade do contexto enviado ao Gemini', () => {
  it('não leva número de cartão nem e-mail, e mantém o nome do lugar', () => {
    const context = financialChatContext(
      [
        entry('2026-09-22T15:00:00Z', '50.00', {
          description: 'Pedido 5162920012345678 bruno@exemplo.com',
        }),
        entry('2026-09-23T15:00:00Z', '40.00', {
          description: 'Giovanna Pizzaria',
        }),
        entry('2026-09-20T15:00:00Z', '30.00', {
          description: 'Pix Bia - Frete',
          account: 'Pix',
        }),
      ],
      { now: new Date('2026-09-28T15:00:00Z') },
    );
    expect(context).not.toMatch(/5162920012345678|bruno@exemplo/);
    expect(context).toContain('Giovanna Pizzaria');
    // Desde 01/10/2026 o destinatário de Pix vai como apelido: um nome de
    // pessoa pode levar até o Bruno se o que foi enviado vazar.
    expect(context).not.toContain('Bia');
    expect(context).toContain('[pessoa 1]');
  });
});

describe('sugestões de próxima pergunta', () => {
  it('separa a linha escondida do texto da resposta', () => {
    const { body, followUps } = splitFollowUps(
      '### Resumo\nGastou **R$ 10,00**.\n\n<!-- VETRA_SUGESTOES: E em agosto? | Por *categoria*? | Qual o maior? -->',
    );
    expect(body).toBe('### Resumo\nGastou **R$ 10,00**.');
    expect(followUps).toEqual([
      'E em agosto?',
      'Por categoria?',
      'Qual o maior?',
    ]);
  });

  it('deixa respostas antigas, sem a linha, como estão', () => {
    expect(splitFollowUps('Só texto')).toEqual({
      body: 'Só texto',
      followUps: [],
    });
    expect(stripFollowUps('Só texto')).toBe('Só texto');
  });

  it('ignora sugestões vazias e fica com três no máximo', () => {
    expect(
      splitFollowUps('Oi <!-- VETRA_SUGESTOES: a |  | b | c | d -->').followUps,
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('faturas para o Vetra AI', () => {
  const nubank = {
    user_id: 'user',
    account: 'Nubank',
    bank_id: 'nubank' as const,
    created_at: '',
    updated_at: '',
  };
  const cycle = {
    account: 'Nubank',
    kind: 'credit' as const,
    closing_day: 30,
    due_day: 8,
    closing_offset_days: 9,
  };
  // Setembro foi pago com R$ 99,02 a mais, que o banco abate de outubro.
  const bills = [
    {
      account: 'Nubank',
      due_date: '2026-09-08',
      closing_date: '2026-08-30',
      total: '2128.68',
      minimum: '271.91',
      paid: '2227.70',
    },
  ];
  const onInvoice = (amount: string, extra: Partial<FinancialEntry> = {}) =>
    entry('2026-09-15T12:00:00Z', amount, {
      invoice_due_override: '2026-10-08',
      ...extra,
    });

  it('o valor da fatura já desconta o pagamento antecipado', () => {
    const text = plain(
      invoiceFacts({
        entries: [onInvoice('1000.00')],
        cards: [nubank],
        cycles: [cycle],
        bills,
        today: '2026-09-30',
      }),
    );
    expect(text).toContain('VALOR A PAGAR R$ 900,98');
    expect(text).toContain('compras do ciclo R$ 1.000,00');
    expect(text).toContain(
      'pagamento antecipado/crédito da fatura anterior −R$ 99,02',
    );
    // Fatura futura zerada não entra.
    expect(text).not.toContain('08/01/2027');
  });

  it('"fora das contas" entra na fatura, sem nome, e fica fora dos gastos', () => {
    const excluded = onInvoice('300.00', {
      description: 'Compra da mãe',
      excluded_from_totals: true,
    });
    const text = plain(
      invoiceFacts({
        entries: [onInvoice('1000.00'), excluded],
        cards: [nubank],
        cycles: [cycle],
        bills,
        today: '2026-09-30',
      }),
    );
    expect(text).toContain('VALOR A PAGAR R$ 1.200,98');
    expect(text).toContain(
      'compras do usuário R$ 1.000,00; lançamentos "fora das contas" R$ 300,00',
    );
    expect(text).not.toContain('Compra da mãe');

    const context = plain(
      financialChatContext([onInvoice('1000.00')], {
        invoiceEntries: [onInvoice('1000.00'), excluded],
        cards: [nubank],
        cycles: [cycle],
        bills,
        now: new Date('2026-09-30T15:00:00Z'),
      }),
    );
    expect(context).toContain('VALOR A PAGAR R$ 1.200,98');
    expect(context).not.toContain('Compra da mãe');
    expect(context).not.toContain('R$ 1.300,00');
  });
});
