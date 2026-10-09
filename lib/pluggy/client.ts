// Único arquivo que lê o JSON bruto da Pluggy. Converte campo a campo (nunca
// spread) para os tipos de `types.ts`, a lista branca. Não loga corpo nem
// apiKey; erros levam só caminho (sem query) e status.
import { createHash } from 'node:crypto';
import { scrubIdentifiers } from '../ai-privacy';
import type {
  PluggyAccount,
  PluggyBill,
  PluggyInstallment,
  PluggyInvestmentLot,
  PluggyInvestmentMovement,
  PluggyItem,
  PluggyReserve,
  PluggyTransaction,
} from './types';

const API = 'https://api.pluggy.ai';
const TIMEOUT_MS = 30_000;
// Validade medida em ~2h; renova antes.
const KEY_LIFETIME_MS = 90 * 60_000;

// Campos declarados à mão: `--experimental-strip-types` não aceita
// parameter properties.
export class PluggyHttpError extends Error {
  readonly path: string;
  readonly status: number;
  constructor(path: string, status: number) {
    super(`Pluggy ${path} → HTTP ${status}`);
    this.path = path;
    this.status = status;
  }
}

type Json = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Limite que vale: o escolhido pelo cliente (`customizedLimitAmount` em
 * `LIMITE_CREDITO_TOTAL`), senão o do banco. O disponível já usa o escolhido.
 */
export function effectiveCreditLimit(credit: Json) {
  const lines = Array.isArray(credit.disaggregatedCreditLimits)
    ? (credit.disaggregatedCreditLimits as Json[])
    : [];
  const customized = lines
    .filter((line) => line.creditLineLimitType === 'LIMITE_CREDITO_TOTAL')
    .map((line) => numOrNull(line.customizedLimitAmount))
    .find((value): value is number => value !== null && value > 0);
  return customized ?? numOrNull(credit.creditLimit);
}

function toAccount(raw: Json): PluggyAccount {
  const credit =
    raw.creditData && typeof raw.creditData === 'object'
      ? (raw.creditData as Json)
      : null;
  return {
    id: str(raw.id),
    itemId: str(raw.itemId),
    type: str(raw.type),
    subtype: str(raw.subtype),
    creditLimit: credit ? effectiveCreditLimit(credit) : null,
    productName:
      str(raw.type) === 'CREDIT'
        ? str(raw.name)
            .replace(/[0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60) || null
        : null,
    availableCreditLimit: credit
      ? numOrNull(credit.availableCreditLimit)
      : null,
    balance: numOrNull(raw.balance),
    bank: bankFromName(`${str(raw.name)} ${str(raw.marketingName)}`),
  };
}

/** Banco pelo nome da conta; só a chave sai daqui. */
function bankFromName(name: string): PluggyAccount['bank'] {
  // Remove acentos via normalize.
  const text = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (/\bnu\s?bank\b|\bnu pagamentos\b/.test(text)) return 'nubank';
  if (/\bitau\b/.test(text)) return 'itau';
  if (/\bpicpay\b/.test(text)) return 'picpay';
  if (/\bmercado\s?pago\b/.test(text)) return 'mercado-pago';
  return null;
}

function toBill(raw: Json): PluggyBill {
  const payments = Array.isArray(raw.payments) ? (raw.payments as Json[]) : [];
  return {
    id: str(raw.id),
    dueDate: str(raw.dueDate),
    closingDate: strOrNull(raw.billClosingDate),
    total: numOrNull(raw.totalAmount) ?? 0,
    minimum: numOrNull(raw.minimumPaymentAmount),
    paid: payments.reduce(
      (sum, payment) => sum + (numOrNull(payment.amount) ?? 0),
      0,
    ),
    // Só dia e valor de cada pagamento.
    payments: payments
      .map((payment) => ({
        date: str(payment.paymentDate).slice(0, 10),
        amount: numOrNull(payment.amount) ?? 0,
      }))
      .filter(
        (payment) =>
          /^\d{4}-\d{2}-\d{2}$/.test(payment.date) && payment.amount > 0,
      ),
  };
}

function toInstallment(raw: unknown): PluggyInstallment | null {
  if (!raw || typeof raw !== 'object') return null;
  const meta = raw as Json;
  return {
    installmentNumber: numOrNull(meta.installmentNumber),
    totalInstallments: numOrNull(meta.totalInstallments),
    totalAmount: numOrNull(meta.totalAmount),
    purchaseDate: strOrNull(meta.purchaseDate),
    billId: strOrNull(meta.billId),
    billForecastDate: strOrNull(meta.billForecastDate),
  };
}

function toTransaction(raw: Json): PluggyTransaction {
  const merchant =
    raw.merchant && typeof raw.merchant === 'object'
      ? (raw.merchant as Json)
      : null;
  return {
    id: str(raw.id),
    accountId: str(raw.accountId),
    date: str(raw.date),
    amount: typeof raw.amount === 'number' ? raw.amount : Number(raw.amount),
    type: str(raw.type),
    status: str(raw.status),
    description: str(raw.description),
    operationType: strOrNull(raw.operationType),
    category: strOrNull(raw.category),
    merchantName: merchant
      ? (strOrNull(merchant.name) ?? strOrNull(merchant.businessName))
      : null,
    installment: toInstallment(raw.creditCardMetadata),
  };
}

function toItem(raw: Json): PluggyItem {
  const connector =
    raw.connector && typeof raw.connector === 'object'
      ? (raw.connector as Json)
      : {};
  return {
    id: str(raw.id),
    connectorName: str(connector.name),
    status: str(raw.status),
    executionStatus: strOrNull(raw.executionStatus),
    lastUpdatedAt: strOrNull(raw.lastUpdatedAt),
    nextAutoSyncAt: strOrNull(raw.nextAutoSyncAt),
  };
}

function toInvestmentLot(raw: Json): PluggyInvestmentLot {
  return {
    id: str(raw.id),
    purchaseDate: strOrNull(raw.purchaseDate) ?? strOrNull(raw.issueDate),
    type: str(raw.type),
    status: str(raw.status),
    rateType: strOrNull(raw.rateType),
    rate: numOrNull(raw.rate),
    date: strOrNull(raw.date),
    amount: numOrNull(raw.amount),
    balance: numOrNull(raw.balance),
    iof: numOrNull(raw.taxes2),
    incomeTax: numOrNull(raw.taxes),
  };
}

function toInvestmentMovement(raw: Json): PluggyInvestmentMovement {
  return {
    id: str(raw.id),
    type: str(raw.type),
    date: str(raw.date),
    amount: numOrNull(raw.amount),
    netAmount: numOrNull(raw.netAmount),
  };
}

/** Reservas de `bankData.reservedBalances`, a única parte de `bankData` lida. */
function toReserves(account: Json): PluggyReserve[] {
  const bankData =
    account.bankData && typeof account.bankData === 'object'
      ? (account.bankData as Json)
      : null;
  const reserves = bankData?.reservedBalances;
  if (!Array.isArray(reserves)) return [];
  return reserves.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const reserve = raw as Json;
    const identification = str(reserve.identification);
    const name = scrubIdentifiers(str(reserve.name)).trim();
    if (!identification || !name) return [];
    const amounts = Array.isArray(reserve.availableAmounts)
      ? (reserve.availableAmounts as unknown[])
      : [];
    const first =
      amounts[0] && typeof amounts[0] === 'object' ? (amounts[0] as Json) : {};
    return [
      {
        key: createHash('sha256').update(identification).digest('hex'),
        name: name.slice(0, 80),
        amount: numOrNull(first.amount),
        accountId: str(account.id),
      },
    ];
  });
}

/** Cliente com as chaves do ambiente, ou `null` sem elas. */
export function pluggyFromEnv(): PluggyClient | null {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  return clientId && clientSecret
    ? new PluggyClient(clientId, clientSecret)
    : null;
}

export class PluggyClient {
  private apiKey: string | null = null;
  private apiKeyExpiresAt = 0;

  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async request(path: string, apiKey: string): Promise<Json> {
    const response = await fetch(`${API}${path}`, {
      headers: { 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new PluggyHttpError(path.split('?')[0], response.status);
    }
    return (await response.json()) as Json;
  }

  private async authenticate(): Promise<string> {
    if (this.apiKey && Date.now() < this.apiKeyExpiresAt) return this.apiKey;
    const response = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new PluggyHttpError('/auth', response.status);
    const body = (await response.json()) as Json;
    const apiKey = body.apiKey;
    if (typeof apiKey !== 'string' || !apiKey) {
      throw new Error('Pluggy /auth respondeu sem apiKey');
    }
    this.apiKey = apiKey;
    this.apiKeyExpiresAt = Date.now() + KEY_LIFETIME_MS;
    return apiKey;
  }

  async getItem(itemId: string): Promise<PluggyItem> {
    const apiKey = await this.authenticate();
    const raw = await this.request(
      `/items/${encodeURIComponent(itemId)}`,
      apiKey,
    );
    return toItem(raw);
  }

  async listAccounts(itemId: string): Promise<PluggyAccount[]> {
    const apiKey = await this.authenticate();
    const raw = await this.request(
      `/accounts?itemId=${encodeURIComponent(itemId)}`,
      apiKey,
    );
    const results = Array.isArray(raw.results) ? raw.results : [];
    return results.map((item) => toAccount(item as Json));
  }

  /**
   * `GET /investments`, todas as páginas. Inclui lotes resgatados
   * (`investments.ts` filtra).
   */
  async listInvestments(itemId: string): Promise<PluggyInvestmentLot[]> {
    const apiKey = await this.authenticate();
    const lots: PluggyInvestmentLot[] = [];
    for (let page = 1; ; page++) {
      const raw = await this.request(
        `/investments?itemId=${encodeURIComponent(itemId)}&pageSize=500&page=${page}`,
        apiKey,
      );
      const results = Array.isArray(raw.results) ? raw.results : [];
      lots.push(...results.map((item) => toInvestmentLot(item as Json)));
      const totalPages =
        typeof raw.totalPages === 'number' ? raw.totalPages : 1;
      if (page >= totalPages || !results.length) return lots;
    }
  }

  /** As faturas fechadas de um cartão (`GET /bills`), todas as páginas. */
  async listBills(accountId: string): Promise<PluggyBill[]> {
    const apiKey = await this.authenticate();
    const bills: PluggyBill[] = [];
    for (let page = 1; ; page++) {
      const raw = await this.request(
        `/bills?accountId=${encodeURIComponent(accountId)}&pageSize=100&page=${page}`,
        apiKey,
      );
      const results = Array.isArray(raw.results) ? raw.results : [];
      bills.push(...results.map((item) => toBill(item as Json)));
      const totalPages =
        typeof raw.totalPages === 'number' ? raw.totalPages : 1;
      if (page >= totalPages || !results.length) return bills;
    }
  }

  /** Os movimentos de um lote (`GET /investments/{id}/transactions`). */
  async listInvestmentMovements(
    lotId: string,
  ): Promise<PluggyInvestmentMovement[]> {
    const apiKey = await this.authenticate();
    const movements: PluggyInvestmentMovement[] = [];
    for (let page = 1; ; page++) {
      const raw = await this.request(
        `/investments/${encodeURIComponent(lotId)}/transactions?pageSize=500&page=${page}`,
        apiKey,
      );
      const results = Array.isArray(raw.results) ? raw.results : [];
      movements.push(
        ...results.map((item) => toInvestmentMovement(item as Json)),
      );
      const totalPages =
        typeof raw.totalPages === 'number' ? raw.totalPages : 1;
      if (page >= totalPages || !results.length) return movements;
    }
  }

  /**
   * Reservas de todas as contas do item. `null` se a Pluggy não informou o
   * campo (lista vazia, ao contrário, pode arquivar cofrinhos).
   */
  async listReserves(itemId: string): Promise<PluggyReserve[] | null> {
    const apiKey = await this.authenticate();
    const raw = await this.request(
      `/accounts?itemId=${encodeURIComponent(itemId)}`,
      apiKey,
    );
    const accounts = (Array.isArray(raw.results) ? raw.results : []) as Json[];
    const informed = accounts.some((account) => {
      const bankData = account.bankData as Json | undefined;
      return Array.isArray(bankData?.reservedBalances);
    });
    return informed ? accounts.flatMap(toReserves) : null;
  }

  /** `GET /v2/transactions` seguindo `next`. `from`/`to` em yyyy-mm-dd. */
  async listTransactions(
    accountId: string,
    from: string,
    to: string,
  ): Promise<PluggyTransaction[]> {
    const apiKey = await this.authenticate();
    const all: PluggyTransaction[] = [];
    const base = '/v2/transactions';
    let path: string | null =
      `${base}?accountId=${encodeURIComponent(accountId)}` +
      `&dateFrom=${from}&dateTo=${to}`;
    while (path) {
      const page = await this.request(path, apiKey);
      const results = Array.isArray(page.results) ? page.results : [];
      all.push(...results.map((item) => toTransaction(item as Json)));
      const next = page.next;
      // `next` pode vir como querystring ou caminho completo.
      path =
        typeof next === 'string' && next
          ? next.startsWith('/')
            ? next
            : next.startsWith('?')
              ? `${base}${next}`
              : `${base}?${next}`
          : null;
    }
    return all;
  }

  /** Webhooks registrados: só id, evento e url (headers têm o segredo). */
  async listWebhooks(): Promise<{ id: string; event: string; url: string }[]> {
    const apiKey = await this.authenticate();
    const raw = await this.request('/webhooks', apiKey);
    const results = Array.isArray(raw.results) ? (raw.results as Json[]) : [];
    return results.map((hook) => ({
      id: str(hook.id),
      event: str(hook.event),
      url: str(hook.url),
    }));
  }

  /** Cria ou atualiza um webhook com headers próprios. */
  async saveWebhook(
    hook: { event: string; url: string; headers: Record<string, string> },
    id?: string,
  ): Promise<void> {
    const apiKey = await this.authenticate();
    const path = id ? `/webhooks/${encodeURIComponent(id)}` : '/webhooks';
    const response = await fetch(`${API}${path}`, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(hook),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new PluggyHttpError(path, response.status);
  }
}
