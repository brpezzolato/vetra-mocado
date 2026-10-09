import Decimal from 'decimal.js';
import { saoDate } from './expense-insights';
import type { FinancialEntry } from './financial-tracker';

/* Fila de revisão: compras em "Outros" ou com nome estranho, uma loja por
   vez (das que mais pesam), para dar categoria e nome com um toque; vira
   regra (`save_merchant_alias`). "Pular" grava a loja em `expense_reviews`
   com prefixo `rv:`. */

export type ReviewReason =
  | 'sem categoria'
  | 'número no nome'
  | 'código da maquininha'
  | 'tudo em maiúsculas';

export type ReviewCard = {
  key: string;
  description: string;
  category: string;
  account: string;
  count: number;
  total: string;
  lastDay: string;
  reasons: ReviewReason[];
};

/** Quantos dias para trás a fila olha. */
const WINDOW_DAYS = 90;

/** A chave de "pular" em `expense_reviews` (até 80 caracteres). */
export const reviewKey = (description: string) =>
  `rv:${description.trim().toLocaleLowerCase('pt-BR')}`.slice(0, 80);

/** Por que um nome parece estranho (nenhum motivo: nome bom). */
export function oddNameReasons(name: string): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (/número oculto|\d{4,}/i.test(name)) reasons.push('número no nome');
  // "Mlp*Netshoes", "VMT* 579", "Ebn *Tiktok": o prefixo da adquirente.
  if (/^[\p{L}\d]{2,6}\s?\*/u.test(name)) reasons.push('código da maquininha');
  const letters = name.replace(/[^\p{L}]/gu, '');
  if (
    letters.length >= 8 &&
    letters === letters.toLocaleUpperCase('pt-BR') &&
    /\s/.test(name.trim())
  )
    reasons.push('tudo em maiúsculas');
  return reasons;
}

export function reviewQueue(
  entries: FinancialEntry[],
  skipped: Set<string>,
  today = saoDate(new Date()),
  /** Nomes já ensinados (com `merchant_rules`): só voltam com compra em "Outros". */
  taught: Set<string> = new Set(),
): ReviewCard[] {
  const since = saoDate(
    new Date(Date.parse(`${today}T12:00:00Z`) - WINDOW_DAYS * 86_400_000),
  );
  const cards = new Map<string, ReviewCard & { sum: Decimal }>();
  for (const entry of entries) {
    if (entry.entry_type !== 'expense' || entry.excluded_from_totals) continue;
    const day = saoDate(entry.occurred_at);
    if (day < since || day > today) continue;
    const generic =
      entry.category.trim().toLocaleLowerCase('pt-BR') === 'outros';
    // Já categorizada: nome estranho sozinho não basta.
    if (
      !generic &&
      taught.has(entry.description.trim().toLocaleLowerCase('pt-BR'))
    )
      continue;
    const reasons: ReviewReason[] = [
      ...(generic ? (['sem categoria'] as const) : []),
      ...oddNameReasons(entry.description),
    ];
    if (!reasons.length) continue;
    const key = reviewKey(entry.description);
    if (skipped.has(key)) continue;
    const card = cards.get(key) ?? {
      key,
      description: entry.description,
      category: entry.category,
      account: entry.account,
      count: 0,
      total: '0',
      lastDay: day,
      reasons: [],
      sum: new Decimal(0),
    };
    card.count++;
    card.sum = card.sum.plus(entry.full_amount ?? entry.amount);
    if (day > card.lastDay) {
      card.lastDay = day;
      card.account = entry.account;
    }
    for (const reason of reasons)
      if (!card.reasons.includes(reason)) card.reasons.push(reason);
    cards.set(key, card);
  }
  return [...cards.values()]
    .sort((a, b) => b.sum.comparedTo(a.sum) || b.count - a.count)
    .map(({ sum, ...card }) => ({ ...card, total: sum.toFixed(2) }));
}
