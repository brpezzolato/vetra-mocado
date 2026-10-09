import Decimal from 'decimal.js';
import { parseCsv } from './csv';
import type { ExpenseCategory } from './expense-categories';
import type { FinancialEntryType } from './financial-tracker';
import { normalizeMerchant } from './merchant-names';

/** Conta do extrato Flash; `suggestedCardBank` reconhece a marca e a cor. */
export const FLASH_ACCOUNT = 'Flash';

export type FlashMovement = {
  /** São Paulo calendar day, YYYY-MM-DD. */
  date: string;
  /** HH:MM as printed on the statement. */
  time: string;
  /** UTC instant, built from the São Paulo wall clock above. */
  occurredAt: string;
  /** What the statement printed, kept so a bad cleanup can always be traced. */
  rawDescription: string;
  description: string;
  category: ExpenseCategory;
  entryType: FinancialEntryType;
  /** Always positive; entryType carries the direction. */
  amount: string;
  method: string;
  /** The running balance the statement printed for this row, if any. */
  declaredBalance: string | null;
  externalId: string;
};

export type FlashStatement = {
  movements: FlashMovement[];
  /** The balance on the most recent row — the one worth trusting. */
  closingBalance: { amount: string; date: string; occurredAt: string } | null;
  /** Linhas ilegíveis com o motivo, nunca descartadas em silêncio. */
  skipped: { line: number; raw: string; reason: string }[];
  /**
   * Linhas cujo saldo impresso não fecha. Esperado: a Flash imprime saldo
   * velho em pré-autorizações de corrida.
   */
  balanceMismatches: number;
};

/**
 * A bandeira acrescenta cidade, país e código de viagem; sem limpar, a
 * mesma catraca vira uma dúzia de lojas.
 */
const MERCHANTS: [RegExp, string][] = [
  [/^DL\*UberRides\b/i, 'Uber'],
  [/^UBER \*ONE MEMBERSHIP/i, 'Uber One'],
  [/^UBER SHOPPER STATEMENT/i, 'Uber'],
  [/^99\*/, '99'],
  [/^METRO\*/i, 'Metrô de São Paulo'],
  [/^EMV CPTM\*/i, 'CPTM'],
  [/^Dep[óo]sito transferido$/i, 'Depósito Flash'],
];

const CITY_SUFFIX =
  /\s+(SAO PAULO|SAO CAETANO D(?:O SUL)?|SANTO ANDRE|SAO BERNARDO(?: DO CAMPO)?|DIADEMA|GUARULHOS|OSASCO)\s*(BRA?|BRASIL)?\s*$/i;

const titleCase = (value: string) =>
  value
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLocaleLowerCase('pt-BR');
      // Connectives stay lowercase unless they open the name.
      if (index > 0 && /^(de|da|do|das|dos|e)$/.test(lower)) return lower;
      // Roman numerals are part of the brand: "Sonda II", not "Sonda Ii".
      if (/^[IVX]+$/.test(word)) return word;
      return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    })
    .join(' ');

export function cleanFlashMerchant(raw: string) {
  const value = raw.trim().replace(/\s+/g, ' ');
  for (const [pattern, name] of MERCHANTS) if (pattern.test(value)) return name;
  const withoutCity = value.replace(CITY_SUFFIX, '').trim();
  const base = (withoutCity || value).replace(/\s*\bBRA?\b\s*$/i, '').trim();
  // An all-caps merchant is the card network shouting, not a brand choice.
  return base === base.toLocaleUpperCase('pt-BR') ? titleCase(base) : base;
}

/**
 * VT só aceita 99, Uber e Metrô/CPTM (e as concessionárias de linhas).
 * `metr[oô]` usa `(?![a-z])` e não \b, que não reconhece "ô" como letra.
 * `uber` sem fronteira final ("DL*UberRides"), excluindo Uberlândia.
 * `99` é solto de propósito: errar a carteira se corrige na próxima leitura.
 */
const TRANSIT =
  /\buber(?!l[âa]ndia)|(?:^|\s)99(?:\b|\*)|\bmetr[oô](?![a-z])|\bcptm\b|\bviaquatro\b|\bviamobilidade\b/i;

/**
 * Saldo da Flash de onde saiu a compra, como categoria: só duas respostas,
 * uma por carteira.
 */
export function suggestFlashCategory(raw: string): ExpenseCategory {
  return TRANSIT.test(raw) ? 'Transporte' : 'Alimentação';
}

/**
 * Estável entre reimportações: data, hora, descrição crua e valor. Usa a
 * descrição crua para melhorias na limpeza não reimportarem tudo.
 */
export function flashExternalId(parts: {
  date: string;
  time: string;
  rawDescription: string;
  amount: string;
  entryType: FinancialEntryType;
}) {
  return [
    'flash',
    parts.date,
    parts.time,
    parts.entryType === 'income' ? '+' : '-',
    parts.amount,
    parts.rawDescription.trim().replace(/\s+/g, ' ').toLowerCase(),
  ]
    .join('|')
    .slice(0, 160);
}

const parseBrl = (value: string) => {
  const clean = value.replace(/R\$/gi, '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const negative = clean.startsWith('-');
  const digits = clean
    .replace(/^-/, '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const amount = new Decimal(digits);
  return negative ? amount.neg() : amount;
};

const parseDay = (value: string) => {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const parseTime = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '00:00';
};

const header = (headers: string[], ...names: string[]) => {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase();
  const wanted = names.map(normalize);
  return headers.findIndex((value) => wanted.includes(normalize(value)));
};

/**
 * Lê o extrato exportado da Flash (mais novo primeiro, colunas em
 * português). O que não casa vai para `skipped`.
 */
export function parseFlashStatement(text: string): FlashStatement {
  const { headers, rows } = parseCsv(text);
  const columns = {
    date: header(headers, 'Data'),
    time: header(headers, 'Hora'),
    description: header(headers, 'Movimentação', 'Movimentacao', 'Descrição'),
    amount: header(headers, 'Valor'),
    method: header(headers, 'Meio de Pagamento', 'Meio de pagamento'),
    balance: header(headers, 'Saldo'),
  };
  const skipped: FlashStatement['skipped'] = [];
  if (columns.date < 0 || columns.amount < 0 || columns.description < 0)
    return {
      movements: [],
      closingBalance: null,
      balanceMismatches: 0,
      skipped: [
        {
          line: 1,
          raw: headers.join(','),
          reason:
            'Cabeçalho não reconhecido. O extrato da Flash precisa das colunas Data, Movimentação e Valor.',
        },
      ],
    };

  const movements: FlashMovement[] = [];
  const balances: (Decimal | null)[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const raw = row.join(',');
    const date = parseDay(row[columns.date] ?? '');
    if (!date) {
      skipped.push({ line, raw, reason: 'Data inválida.' });
      return;
    }
    const value = parseBrl(row[columns.amount] ?? '');
    if (!value) {
      skipped.push({ line, raw, reason: 'Valor inválido.' });
      return;
    }
    if (value.isZero()) {
      // Pré-autorizações de R$ 0,00 não são dinheiro.
      skipped.push({ line, raw, reason: 'Movimentação de R$ 0,00.' });
      return;
    }
    const time = parseTime(row[columns.time] ?? '');
    const rawDescription = (row[columns.description] ?? '').trim();
    const entryType: FinancialEntryType = value.isNegative()
      ? 'expense'
      : 'income';
    const amount = value.abs().toFixed(2);
    // Depósito não diz qual saldo recebeu: categoria genérica.
    const category =
      entryType === 'income' ? 'Outros' : suggestFlashCategory(rawDescription);
    movements.push({
      date,
      time,
      // São Paulo sem horário de verão desde 2019: offset fixo.
      occurredAt: new Date(`${date}T${time}:00-03:00`).toISOString(),
      rawDescription,
      // Limpeza do extrato e depois a do app, para convergir com o lançamento manual.
      description:
        entryType === 'expense'
          ? normalizeMerchant(cleanFlashMerchant(rawDescription))
          : cleanFlashMerchant(rawDescription),
      category,
      entryType,
      amount,
      method: (row[columns.method] ?? '').trim(),
      declaredBalance:
        columns.balance >= 0
          ? (parseBrl(row[columns.balance] ?? '')?.toFixed(2) ?? null)
          : null,
      externalId: flashExternalId({
        date,
        time,
        rawDescription,
        amount,
        entryType,
      }),
    });
    balances.push(
      columns.balance >= 0 ? parseBrl(row[columns.balance] ?? '') : null,
    );
  });

  // Do mais velho ao mais novo: cada saldo = anterior + movimento.
  let balanceMismatches = 0;
  for (let index = 0; index < movements.length - 1; index++) {
    const current = balances[index];
    const previous = balances[index + 1];
    if (!current || !previous) continue;
    const signed = new Decimal(movements[index].amount).mul(
      movements[index].entryType === 'expense' ? -1 : 1,
    );
    if (!previous.plus(signed).equals(current)) balanceMismatches++;
  }

  const newest = movements.reduce<FlashMovement | null>(
    (best, movement) =>
      !best || movement.occurredAt > best.occurredAt ? movement : best,
    null,
  );
  return {
    movements,
    closingBalance:
      newest && newest.declaredBalance
        ? {
            amount: newest.declaredBalance,
            date: newest.date,
            occurredAt: newest.occurredAt,
          }
        : null,
    skipped,
    balanceMismatches,
  };
}

/** What the statement says was spent and received, for the import preview. */
export function summarizeFlashStatement(movements: FlashMovement[]) {
  const total = (type: FinancialEntryType) =>
    movements
      .filter((movement) => movement.entryType === type)
      .reduce((sum, movement) => sum.plus(movement.amount), new Decimal(0))
      .toFixed(2);
  const days = [...new Set(movements.map((movement) => movement.date))].sort();
  return {
    count: movements.length,
    spent: total('expense'),
    received: total('income'),
    firstDay: days[0] ?? '',
    lastDay: days.at(-1) ?? '',
  };
}
