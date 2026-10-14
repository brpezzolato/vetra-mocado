import Decimal from 'decimal.js';
import { myShare } from './entry-share';
import {
  benefitBalanceView,
  benefitForecast,
  FLASH_WALLETS,
  latestBenefitBalance,
  walletEntries,
  type BenefitCardBalance,
} from './benefit-cards';
import {
  buildCreditCardInvoices,
  invoiceStage,
  type CardBill,
  type CardInvoicePayment,
} from './card-invoices';
import type { DailyRate } from './domain';
import type { CardCycle } from './expense-insights';
import type { FinancialAgentCardLimit } from './financial-agent-query';
import type { PaymentCard } from './payment-cards';
import type { FinancialAgentVault } from './financial-agent-query';
import type { FinancialEntry } from './financial-tracker';
import { FLASH_ACCOUNT } from './flash-statement';
import { calculatePortfolio, staleBankDate } from './portfolio';
import { normalizedBank } from './vault-shape';

/**
 * Números que o Vetra AI recebe prontos, calculados com o mesmo código das
 * telas (modelo de linguagem erra somas). A lista crua vai junto. Cofrinhos e
 * Flash vão como o app mostra (motor e saldo corrente).
 */

type Entry = Pick<
  FinancialEntry,
  'entry_type' | 'amount' | 'description' | 'category' | 'account'
> & { occurred_at: string };

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value).toDecimalPlaces(2).toNumber());

export const saoDay = (value: Date | string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const monthName = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(0, 4)}`;

const sum = (items: Entry[]) =>
  items.reduce((total, item) => total.plus(item.amount), new Decimal(0));

const grouped = (items: Entry[], key: (item: Entry) => string) => {
  const groups = new Map<string, Entry[]>();
  for (const item of items) {
    const name = key(item) || 'Sem nome';
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups]
    .map(([name, rows]) => ({ name, total: sum(rows), count: rows.length }))
    .sort((a, b) => b.total.cmp(a.total));
};

const daysInMonth = (month: string) =>
  new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();

const previousMonth = (month: string) => {
  const date = new Date(`${month}-15T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
};

const signed = (value: Decimal) =>
  `${value.gte(0) ? '+' : '−'}${money(value.abs())}`;

/**
 * Gastos por mês (últimos doze): total, média diária, categorias, lojas e o
 * mês corrente vs. o mesmo trecho do anterior.
 */
export function spendingFacts(entries: Entry[], today: string) {
  const expenses = entries.filter((entry) => entry.entry_type === 'expense');
  const incomes = entries.filter((entry) => entry.entry_type === 'income');
  const month = (entry: Entry) => saoDay(entry.occurred_at).slice(0, 7);
  const months = [...new Set(entries.map(month))]
    .filter((value) => value <= today.slice(0, 7))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 12);
  const current = today.slice(0, 7);

  const perMonth = months.map((value) => {
    const spent = expenses.filter((entry) => month(entry) === value);
    const received = incomes.filter((entry) => month(entry) === value);
    const days =
      value === current ? Number(today.slice(8, 10)) : daysInMonth(value);
    const categories = grouped(spent, (entry) => entry.category)
      .map(
        (item) =>
          `${item.name} ${money(item.total)} (${item.count} lançamento${item.count === 1 ? '' : 's'})`,
      )
      .join('; ');
    const merchants = grouped(spent, (entry) => entry.description)
      .slice(0, 8)
      .map(
        (item) =>
          `${item.name} ${money(item.total)}${item.count > 1 ? ` em ${item.count}x` : ''}`,
      )
      .join('; ');
    return [
      `- ${monthName(value)}${value === current ? ` (em andamento, até o dia ${days})` : ''}: gastos ${money(sum(spent))} em ${spent.length} lançamentos, média ${money(sum(spent).div(days || 1))} por dia; entradas ${money(sum(received))}; saldo do mês ${signed(sum(received).minus(sum(spent)))}.`,
      `  Categorias: ${categories || 'nenhum gasto'}.`,
      `  Onde mais gastou: ${merchants || 'nenhum gasto'}.`,
    ].join('\n');
  });

  const day = Number(today.slice(8, 10));
  const before = previousMonth(current);
  const cutoff = `${before}-${String(Math.min(day, daysInMonth(before))).padStart(2, '0')}`;
  const nowSpent = expenses.filter(
    (entry) => month(entry) === current && saoDay(entry.occurred_at) <= today,
  );
  const thenSpent = expenses.filter(
    (entry) => month(entry) === before && saoDay(entry.occurred_at) <= cutoff,
  );
  const thenByCategory = new Map(
    grouped(thenSpent, (entry) => entry.category).map((item) => [
      item.name,
      item.total,
    ]),
  );
  const nowByCategory = new Map(
    grouped(nowSpent, (entry) => entry.category).map((item) => [
      item.name,
      item.total,
    ]),
  );
  const changes = [
    ...new Set([...thenByCategory.keys(), ...nowByCategory.keys()]),
  ]
    .map((name) => ({
      name,
      delta: (nowByCategory.get(name) ?? new Decimal(0)).minus(
        thenByCategory.get(name) ?? new Decimal(0),
      ),
    }))
    .filter((item) => !item.delta.isZero())
    .sort((a, b) => b.delta.abs().cmp(a.delta.abs()))
    .slice(0, 6)
    .map((item) => `${item.name} ${signed(item.delta)}`)
    .join('; ');

  return [
    'GASTOS POR MÊS (já somados — use estes totais, não some a lista de lançamentos):',
    ...perMonth,
    `Mês atual até hoje contra o mesmo trecho do mês anterior (1º a ${cutoff.slice(8)} de ${monthName(before)}): ${money(sum(nowSpent))} agora, ${money(sum(thenSpent))} antes, diferença ${signed(sum(nowSpent).minus(sum(thenSpent)))}. Maiores variações por categoria: ${changes || 'nenhuma'}.`,
  ].join('\n');
}

/**
 * Cofrinhos pelo banco: saldo, impostos (se o banco informa) e rendimento de
 * hoje e do mês. Sem previsão. Sem CDI, o texto avisa.
 */
export function vaultFacts(
  vaults: FinancialAgentVault[],
  rates: DailyRate[] | null,
  now: Date,
) {
  const active = vaults.filter((vault) => !vault.archived_at);
  if (!active.length) return 'COFRINHOS: nenhum cofrinho ativo.';
  if (!rates?.length)
    return 'COFRINHOS: a série do CDI do Banco Central não respondeu agora, então o saldo calculado de hoje não está disponível. Use a última conciliação de cada cofrinho (na seção de cofrinhos abaixo) e avise que é a última conferência, não o saldo de hoje.';
  const today = saoDay(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lines = active.map((vault) => {
    const bank = normalizedBank(vault);
    const portfolio = calculatePortfolio([bank], rates, now);
    const earned = (from: string) =>
      portfolio.results[0]!.result.earnings.reduce(
        (total, entry) =>
          entry.date >= from && entry.date <= today
            ? total.plus(entry.netAmount)
            : total,
        new Decimal(0),
      );
    const stale = staleBankDate([bank], now);
    const asOf = stale
      ? `saldo líquido do banco em ${stale.slice(8)}/${stale.slice(5, 7)} (o banco ainda não informou o de hoje; diga que está desatualizado)`
      : 'saldo líquido hoje';
    // Imposto só o que o banco informa (o Mercado Pago mostra só o líquido).
    const taxes = portfolio.taxesFromBank
      ? ` (bruto ${money(portfolio.grossBalance)}, IOF ${money(portfolio.iof)}, IR ${money(portfolio.incomeTax)})`
      : ' (o banco não informa bruto nem impostos)';
    return `- ${vault.name} (${vault.bank}, ${vault.product}): ${asOf} ${money(portfolio.netBalance)}${taxes}; rendeu hoje ${money(earned(today))}; rendeu no mês ${money(earned(monthStart))}.`;
  });
  const total = calculatePortfolio(active.map(normalizedBank), rates, now);
  return [
    'COFRINHOS (saldo, impostos e rendimentos são só os informados pelo banco, os mesmos números da tela; o Vetra não faz previsão de rendimento, então não estime valores futuros):',
    ...lines,
    `Total dos cofrinhos: ${money(total.netBalance)} líquido.`,
  ].join('\n');
}

/** Flash por carteira: saldo corrente e previsão até o próximo depósito. */
export function flashFacts(
  entries: FinancialEntry[],
  balances: BenefitCardBalance[],
  today: string,
) {
  const card = entries.filter((entry) => entry.account === FLASH_ACCOUNT);
  if (!card.length && !balances.length) return '';
  const lines = FLASH_WALLETS.map((wallet) => {
    const own = walletEntries(wallet, card);
    const view = benefitBalanceView(
      latestBenefitBalance(balances, wallet.account),
      own,
    );
    if (!view)
      return `- ${wallet.label}: saldo nunca informado no app, então não há saldo corrente.`;
    const forecast = benefitForecast(view.current, own, today);
    const outlook = !forecast
      ? 'sem previsão ainda (ciclo com menos de 3 dias ou sem gastos).'
      : forecast.lasts
        ? `no ritmo do ciclo (${money(forecast.perDay)} por dia) dura até o próximo depósito, por volta de ${dateBR(forecast.nextDeposit!)}, sobrando cerca de ${money(forecast.leftover!)}.`
        : `no ritmo do ciclo (${money(forecast.perDay)} por dia) acaba por volta de ${dateBR(forecast.runsOutOn)}${forecast.nextDeposit ? `, antes do próximo depósito (por volta de ${dateBR(forecast.nextDeposit)})` : ''}.`;
    return `- ${wallet.label}: saldo agora ${money(view.current)} (última leitura ${money(view.reported)} em ${dateBR(view.reportedOn)}); ${outlook}`;
  });
  return [
    'CARTÃO FLASH (benefício; cada carteira só paga o próprio tipo de gasto — Transporte só 99, Uber e Metrô/CPTM, o resto sai de Alimentação e Refeição):',
    ...lines,
  ].join('\n');
}

const dateBR = (value: string) =>
  `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;

const STAGE_LABEL = {
  anterior: 'fatura anterior',
  fechada:
    'fatura FECHADA (já fechou, ainda não venceu — é a que se paga agora)',
  atual: 'fatura ATUAL (aberta, ainda recebendo compras)',
  próxima: 'próxima fatura (parcelas e compras já lançadas para ela)',
} as const;

/**
 * Faturas como a tela mostra. O número que importa é o "valor a pagar" (já
 * desconta pagamento antecipado e o pago), não o total de compras.
 * Sem nomes de loja: inclui lançamentos "fora das contas".
 */
export function invoiceFacts({
  entries,
  cards,
  cycles,
  payments = [],
  bills = [],
  limits = [],
  today,
}: {
  entries: FinancialEntry[];
  cards: PaymentCard[];
  cycles: CardCycle[];
  payments?: CardInvoicePayment[];
  bills?: CardBill[];
  limits?: FinancialAgentCardLimit[];
  today: string;
}) {
  const cardInvoices = buildCreditCardInvoices(
    entries,
    cards,
    cycles,
    today,
    payments,
    bills,
    limits,
  );
  if (!cardInvoices.length) return '';
  const lines = cardInvoices.flatMap(({ card, invoices }) => {
    const sorted = [...invoices].sort((a, b) => a.due.localeCompare(b.due));
    const firstOpen = sorted.findIndex((item) => item.due >= today);
    // As duas anteriores, a que se paga agora, a atual e as próximas.
    const window =
      firstOpen < 0
        ? sorted.slice(-2)
        : sorted.slice(Math.max(0, firstOpen - 2), firstOpen + 5);
    // Fatura futura vazia não diz nada e só enche o contexto.
    const shown = window.filter(
      (invoice) =>
        invoice.due < today ||
        invoice.current ||
        invoiceStage(invoice, invoices, today) === 'fechada' ||
        !new Decimal(invoice.charged).isZero(),
    );
    const limit = limits.find((item) => item.account === card.account);
    const header = `- ${card.account}${
      limit?.credit_limit != null
        ? ` (limite ${money(limit.credit_limit)}, disponível ${money(limit.available_limit ?? 0)})`
        : ''
    }:`;
    return [
      header,
      ...shown.map((invoice) => {
        const excluded = invoice.entries
          .filter((entry) => entry.excluded_from_totals)
          .reduce((total, entry) => total.plus(entry.amount), new Decimal(0));
        // Compra dividida: o gasto é só a parte do usuário.
        const own = invoice.entries
          .filter((entry) => !entry.excluded_from_totals)
          .reduce((total, entry) => total.plus(myShare(entry)), new Decimal(0));
        const others = new Decimal(invoice.total).minus(excluded).minus(own);
        const parts = [
          excluded.gt(0) || others.gt(0)
            ? [
                `compras do usuário ${money(own)}`,
                others.gt(0)
                  ? `parte de outras pessoas em compras divididas ${money(others)} (o banco cobra do usuário, mas não é gasto dele)`
                  : null,
                excluded.gt(0)
                  ? `lançamentos "fora das contas" ${money(excluded)} (o banco cobra, mas não são gastos do usuário)`
                  : null,
              ]
                .filter(Boolean)
                .join('; ')
            : `compras do ciclo ${money(invoice.total)}`,
        ];
        if (invoice.carried)
          parts.push(
            `pagamento antecipado/crédito da fatura anterior ${signed(new Decimal(invoice.carried))}`,
          );
        if (invoice.adjustments)
          parts.push(
            `encargos do banco ${signed(new Decimal(invoice.adjustments))}`,
          );
        parts.push(`total cobrado ${money(invoice.charged)}`);
        if (new Decimal(invoice.paid).gt(0))
          parts.push(`já pago ${money(invoice.paid)}`);
        const amount = invoice.settled
          ? `PAGA — valor da fatura ${money(invoice.charged)}`
          : `VALOR A PAGAR ${money(invoice.balance)}`;
        return `  · ${STAGE_LABEL[invoiceStage(invoice, invoices, today)]}, vence ${dateBR(invoice.due)}, fecha ${dateBR(invoice.closing)}: ${amount}. Composição: ${parts.join('; ')}${
          invoice.minimum ? `; mínimo ${money(invoice.minimum)}` : ''
        }${
          invoice.bankTotal
            ? '; total confirmado pelo banco'
            : '; estimativa até o banco fechar'
        }.`;
      }),
    ];
  });
  return [
    'FATURAS DOS CARTÕES (as mesmas da tela de Faturas; "valor a pagar" já desconta pagamento antecipado e pagamentos — é ESTE o valor da fatura, nunca o total de compras):',
    ...lines,
  ].join('\n');
}
