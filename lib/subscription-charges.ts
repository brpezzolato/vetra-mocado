import Decimal from 'decimal.js';
import {
  chargeAfter,
  saoDate,
  upcomingCharge,
  type RecurringExpense,
} from './expense-insights';
import type { FinancialEntry } from './financial-tracker';

/* Cobranças do banco vinculadas às assinaturas.

   O nome cadastrado quase nunca é o que o banco manda ("Icloud +" vem como
   "Apple", "Amazom Prime" como "Amazon Prime", "HBO Max" como
   "MP *HBOMAXASSINO…"), e o cartão às vezes é outro. Um lançamento vira
   cobrança da assinatura quando:
   - o nome bate (palavra do nome, apelido conhecido ou o nome do banco já
     aprendido, aceitando uma letra trocada), e
   - o valor fica a até 20% do cadastrado (preço sobe), e
   - o dia fica a até 5 dias do dia de cobrança (anual: no mesmo mês).
   O cartão não precisa bater: a assinatura passa a mostrar onde caiu.

   Um vínculo gravado (`recurring_expense_id`) sempre vale; um desfeito
   (`recurring_dismissed`) nunca volta. Uma cobrança por mês (ou ano). A
   última cobrança decide o dia de verdade e a próxima data. */

export type ChargeEntry = Pick<
  FinancialEntry,
  'id' | 'entry_type' | 'amount' | 'description' | 'account' | 'occurred_at'
> & {
  bank_description?: string | null;
  installment_group_id?: string | null;
  installment_total?: number | null;
  recurring_expense_id?: string | null;
  recurring_dismissed?: boolean | null;
};

export type SubscriptionLike = Pick<
  RecurringExpense,
  | 'id'
  | 'merchant'
  | 'account'
  | 'amount'
  | 'next_date'
  | 'billing_day'
  | 'frequency'
> & { bank_label?: string | null; paid_by_me?: boolean };

export type SubscriptionStatus =
  /** Caiu neste ciclo; a próxima é no mês (ou ano) seguinte. */
  | 'paid'
  /** Ainda não chegou o dia. */
  | 'upcoming'
  /** Passou do dia (mais 3 de folga) e a cobrança não apareceu. */
  | 'late'
  /** Paga por outra pessoa: nada a vincular. */
  | 'untracked';

export type SubscriptionMatch = {
  /** Mais recente primeiro. */
  charges: ChargeEntry[];
  last: ChargeEntry | null;
  /** Dia em que a última caiu (São Paulo). */
  lastDay: string | null;
  nextDate: string;
  billingDay: number;
  status: SubscriptionStatus;
  /** Cobranças achadas agora, ainda sem vínculo gravado. */
  newLinks: string[];
};

/** Palavras que não identificam serviço nenhum. */
const GENERIC = new Set([
  'assinatura',
  'assinaturas',
  'plano',
  'mensal',
  'anual',
  'club',
  'clube',
  'black',
  'plus',
  'pro',
  'premium',
  'basico',
  'standard',
  'familia',
  'family',
  'individual',
  'anuncios',
  'com',
  'sem',
  'the',
  'app',
  'bra',
]);

/** O nome do serviço e como ele costuma vir na fatura. */
const ALIASES: Record<string, string[]> = {
  icloud: ['apple'],
  appletv: ['apple'],
  applemusic: ['apple'],
  youtube: ['google', 'youtube'],
  gemini: ['google'],
  claude: ['anthropic', 'claude'],
  chatgpt: ['openai'],
  openai: ['openai'],
  meli: ['mercadolivre', 'meli'],
  prime: ['amazon', 'amzn'],
  amazon: ['amazon', 'amzn'],
  hbo: ['hbo'],
  disney: ['disney'],
  globoplay: ['globo'],
  deezer: ['deezer'],
  spotify: ['spotify'],
  netflix: ['netflix'],
  uber: ['uber'],
  ifood: ['ifood'],
};

const DAY = 86_400_000;

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const words = (text: string) =>
  normalize(text)
    .split(' ')
    .filter((word) => word.length >= 3 && !GENERIC.has(word));

/** Distância de edição até 1 (uma letra trocada, sobrando ou faltando). */
function nearlyEqual(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** As palavras que procuramos no lançamento para esta assinatura. */
export function subscriptionTerms(item: SubscriptionLike) {
  // Palavra de 3 letras só se for um serviço conhecido (HBO): "max" ou
  // "one" sozinhos achariam qualquer coisa.
  const own = words(item.merchant).filter(
    (word) => word.length >= 4 || word in ALIASES,
  );
  const compact = normalize(item.merchant).replace(/ /g, '');
  const terms = new Set(own);
  for (const word of [...own, compact])
    for (const alias of ALIASES[word] ?? []) terms.add(alias);
  if (item.bank_label)
    for (const word of words(item.bank_label)) terms.add(word);
  return [...terms];
}

/** O nome do lançamento (exibido ou do banco) lembra a assinatura? */
export function nameMatches(terms: string[], entry: ChargeEntry) {
  const text = `${entry.description} ${entry.bank_description ?? ''}`;
  const compact = normalize(text).replace(/ /g, '');
  const entryWords = words(text);
  return terms.some(
    (term) =>
      compact.includes(term) ||
      (term.length >= 5 && entryWords.some((word) => nearlyEqual(word, term))),
  );
}

const amountMatches = (item: SubscriptionLike, entry: ChargeEntry) => {
  const expected = new Decimal(item.amount);
  if (expected.lte(0)) return false;
  return new Decimal(entry.amount)
    .minus(expected)
    .abs()
    .lte(Decimal.max(1, expected.times(0.2)));
};

const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Distância em dias até o dia de cobrança mais perto (mês anterior, atual ou seguinte). */
function dayDistance(day: string, billingDay: number) {
  const at = Date.parse(`${day}T00:00:00Z`);
  const [y, m] = day.split('-').map(Number);
  let best = Infinity;
  for (const offset of [-1, 0, 1]) {
    const date = new Date(Date.UTC(y, m - 1 + offset, 1));
    const month = date.toISOString().slice(0, 7);
    const target = `${month}-${String(Math.min(billingDay, daysIn(month))).padStart(2, '0')}`;
    best = Math.min(
      best,
      Math.abs(Date.parse(`${target}T00:00:00Z`) - at) / DAY,
    );
  }
  return best;
}

const dayMatches = (item: SubscriptionLike, day: string) => {
  if (item.frequency === 'yearly')
    return day.slice(5, 7) === item.next_date.slice(5, 7);
  return dayDistance(day, item.billing_day) <= 5;
};

const isCandidate = (entry: ChargeEntry) =>
  entry.entry_type === 'expense' &&
  !entry.installment_group_id &&
  (entry.installment_total ?? 0) <= 1;

/** Período (mês ou ano) da cobrança, para ficar uma por período. */
const periodOf = (item: SubscriptionLike, day: string) =>
  item.frequency === 'yearly' ? day.slice(0, 4) : day.slice(0, 7);

export function matchSubscription(
  item: SubscriptionLike,
  entries: ChargeEntry[],
  today: string,
  /** Lançamentos já de outra assinatura (por id): ficam com ela. */
  takenByOthers: Set<string> = new Set(),
): SubscriptionMatch {
  if (item.paid_by_me === false)
    return {
      charges: [],
      last: null,
      lastDay: null,
      nextDate: upcomingCharge(item, today),
      billingDay: item.billing_day,
      status: 'untracked',
      newLinks: [],
    };

  const terms = subscriptionTerms(item);
  const linked: ChargeEntry[] = [];
  const found: ChargeEntry[] = [];
  for (const entry of entries) {
    if (entry.recurring_expense_id === item.id) {
      linked.push(entry);
      continue;
    }
    if (
      entry.recurring_expense_id ||
      entry.recurring_dismissed ||
      takenByOthers.has(entry.id) ||
      !isCandidate(entry)
    )
      continue;
    const day = saoDate(entry.occurred_at);
    if (day > today) continue;
    if (
      nameMatches(terms, entry) &&
      amountMatches(item, entry) &&
      dayMatches(item, day)
    )
      found.push(entry);
  }

  // Uma por período: a vinculada à mão ganha; senão a de valor mais perto.
  const byPeriod = new Map<string, ChargeEntry>();
  const closeness = (entry: ChargeEntry) =>
    new Decimal(entry.amount).minus(item.amount).abs().toNumber();
  for (const entry of linked) {
    const period = periodOf(item, saoDate(entry.occurred_at));
    if (!byPeriod.has(period)) byPeriod.set(period, entry);
  }
  const linkedPeriods = new Set(byPeriod.keys());
  for (const entry of found) {
    const period = periodOf(item, saoDate(entry.occurred_at));
    if (linkedPeriods.has(period)) continue;
    const current = byPeriod.get(period);
    if (!current || closeness(entry) < closeness(current))
      byPeriod.set(period, entry);
  }

  const charges = [...byPeriod.values()].sort(
    (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at),
  );
  const linkedIds = new Set(linked.map((entry) => entry.id));
  const newLinks = charges
    .filter((entry) => !linkedIds.has(entry.id))
    .map((entry) => entry.id);
  const last = charges[0] ?? null;

  if (!last) {
    const nextDate = upcomingCharge(item, today);
    // A data cadastrada já passou e nada caiu: atrasada.
    const late =
      item.next_date < today &&
      Date.parse(`${today}T00:00:00Z`) -
        Date.parse(`${item.next_date}T00:00:00Z`) >
        3 * DAY;
    return {
      charges,
      last,
      lastDay: null,
      nextDate: late ? item.next_date : nextDate,
      billingDay: item.billing_day,
      status: late ? 'late' : 'upcoming',
      newLinks,
    };
  }

  // O dia em que caiu de fato vira o dia de cobrança.
  const lastDay = saoDate(last.occurred_at);
  const billingDay = Number(lastDay.slice(8));
  const rule = { billing_day: billingDay, frequency: item.frequency };
  let nextDate = chargeAfter(rule, lastDay);
  let late = false;
  // Passou um ciclo inteiro sem cobrança: a esperada ficou para trás.
  if (
    Date.parse(`${today}T00:00:00Z`) - Date.parse(`${nextDate}T00:00:00Z`) >
    3 * DAY
  )
    late = true;
  else if (nextDate < today) nextDate = chargeAfter(rule, nextDate);
  return {
    charges,
    last,
    lastDay,
    nextDate,
    billingDay,
    status: late ? 'late' : 'paid',
    newLinks,
  };
}

/** Todas as assinaturas, sem um lançamento servir a duas. */
export function matchSubscriptions(
  items: SubscriptionLike[],
  entries: ChargeEntry[],
  today: string,
) {
  const taken = new Set<string>();
  const result = new Map<string, SubscriptionMatch>();
  // As vinculadas à mão primeiro reservam os seus lançamentos.
  for (const entry of entries)
    if (entry.recurring_expense_id) taken.add(entry.id);
  for (const item of items) {
    const match = matchSubscription(item, entries, today, taken);
    match.newLinks.forEach((id) => taken.add(id));
    result.set(item.id, match);
  }
  return result;
}

/**
 * O que gravar na assinatura depois do vínculo: a próxima data, o dia de
 * verdade, o cartão onde caiu e o nome do banco (se ainda não tinha).
 */
export function subscriptionPatch(
  item: SubscriptionLike,
  match: SubscriptionMatch,
) {
  const patch: Partial<
    Pick<RecurringExpense, 'next_date' | 'billing_day' | 'account'> & {
      bank_label: string;
    }
  > = {};
  if (!match.last) return patch;
  if (match.status === 'paid' && match.nextDate !== item.next_date)
    patch.next_date = match.nextDate;
  if (match.billingDay !== item.billing_day)
    patch.billing_day = match.billingDay;
  if (match.last.account !== item.account) patch.account = match.last.account;
  const label = (match.last.bank_description || match.last.description).trim();
  if (!item.bank_label && label) patch.bank_label = label.slice(0, 200);
  return patch;
}
