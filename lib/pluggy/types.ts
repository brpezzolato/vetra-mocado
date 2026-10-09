// Tipos estreitos da Pluggy (docs/PLANO_PLUGGY.md, fase 2): só o que está
// aqui passa adiante. `client.ts` é o único que lê a resposta bruta e monta
// estes objetos campo a campo, nunca com spread.

/** Conta sem `number`, `owner`, `taxNumber`, `bankData`, `creditData`. */
export type PluggyAccount = {
  id: string;
  itemId: string;
  /** 'BANK' ou 'CREDIT', como a Pluggy manda. */
  type: string;
  subtype: string;
  /** Só estes dois de `creditData`. Nulos fora do cartão. */
  creditLimit: number | null;
  availableCreditLimit: number | null;
  /** Nome do produto do cartão, sem números (card-discovery.ts). Nulo na conta. */
  productName: string | null;
  /** Saldo; na corrente, o disponível. */
  balance: number | null;
  /**
   * Chave do banco deduzida do nome da conta (o conector é sempre
   * "MeuPluggy"). O nome em si não sai do client.
   */
  bank: 'nubank' | 'itau' | 'picpay' | 'mercado-pago' | null;
};

/** Só parcela e fatura de `creditCardMetadata`; nunca `cardNumber`. */
export type PluggyInstallment = {
  installmentNumber: number | null;
  totalInstallments: number | null;
  totalAmount: number | null;
  purchaseDate: string | null;
  billId: string | null;
  /** Sem fatura ainda: mês em que vai cair ("2026-12"). */
  billForecastDate: string | null;
};

/** Sem `descriptionRaw`, `paymentData`, `balance` nem CNPJ. */
export type PluggyTransaction = {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  /** 'DEBIT' ou 'CREDIT'. */
  type: string;
  /** 'POSTED' ou 'PENDING'. */
  status: string;
  description: string;
  /** Tipo de operação, ex. `TRANSFERENCIA_SALDO_RESERVADO` (reserva do MP). */
  operationType: string | null;
  category: string | null;
  merchantName: string | null;
  installment: PluggyInstallment | null;
};

export type PluggyItem = {
  id: string;
  connectorName: string;
  status: string;
  executionStatus: string | null;
  lastUpdatedAt: string | null;
  /** Próxima atualização automática (o Meu Pluggy não aceita PATCH /items). */
  nextAutoSyncAt: string | null;
};

/**
 * Lote de investimento (no Nubank, cada depósito é um CDB). Só saldo,
 * imposto, taxa e data. `iof` = `taxes2`, `incomeTax` = `taxes`.
 */
export type PluggyInvestmentLot = {
  /** Id do lote na Pluggy — serve para buscar os movimentos dele. */
  id: string;
  /** Dia do aporte que abriu o lote. */
  purchaseDate: string | null;
  type: string;
  status: string;
  rateType: string | null;
  rate: number | null;
  date: string | null;
  /** Bruto do lote. */
  amount: number | null;
  /** Líquido do lote. */
  balance: number | null;
  iof: number | null;
  incomeTax: number | null;
};

/** Um movimento de um lote: `BUY` é o aporte, `SELL` a retirada. */
export type PluggyInvestmentMovement = {
  id: string;
  type: string;
  date: string;
  /** Valor bruto movimentado. */
  amount: number | null;
  /** O que caiu na conta, já sem imposto (na retirada). */
  netAmount: number | null;
};

/**
 * Saldo reservado do MP. A `identification` vira `key` (SHA-256) e não sai
 * do `client.ts`; o nome passa por `scrubIdentifiers`.
 */
export type PluggyReserve = {
  key: string;
  name: string;
  amount: number | null;
  /** A conta corrente onde aparecem as idas e vindas da reserva. */
  accountId: string;
};

/** Uma fatura fechada do cartão (`GET /bills`). */
export type PluggyBill = {
  id: string;
  dueDate: string;
  closingDate: string | null;
  total: number;
  minimum: number | null;
  /** A soma dos pagamentos que o banco registrou para esta fatura. */
  paid: number;
  /** Cada pagamento: só o dia (yyyy-mm-dd) e o valor. */
  payments: { date: string; amount: number }[];
};
