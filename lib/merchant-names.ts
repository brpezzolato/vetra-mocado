/**
 * One name per place. The same shop arrives under several spellings
 * (Shortcut raw string, Flash statement, typed by hand); every write path and
 * the learned-category lookup go through this. Chains are one merchant.
 * Kept apart: Uber rides vs Uber One, and iFood restaurants ("Ifd*…").
 */
const KNOWN: [RegExp, string][] = [
  // Uber One before Uber, or the subscription would be read as a ride.
  [/^uber\s*(\*\s*)?one\b|^uber\s*-\s*assinatura\b/i, 'Uber One'],
  [/^(dl\s*\*\s*)?uber\s*(rides|shopper)?\b/i, 'Uber'],
  [/^99(\s*(ride|pop|taxi)\b|\s*\*|$)/i, '99'],
  [/^metr[oô]\s*\*|^metr[oô]\s+de\s+s[aã]o\s+paulo\b/i, 'Metrô de São Paulo'],
  [/^(emv\s+)?cptm\b/i, 'CPTM'],
  [/^drogasil/i, 'Drogasil'],
  [/^carrefour\b/i, 'Carrefour'],
  [/^oxxo\b/i, 'Oxxo'],
  [/^sonda\b/i, 'Sonda'],
  [/^cinemark\b/i, 'Cinemark'],
  // Marketplaces: o nome do vendedor vem junto e virava lojas diferentes.
  // Casa em qualquer ponto do nome. Amazon Prime fica de fora (assinatura).
  [/mercado\s*livre/i, 'Mercado Livre'],
  [/shopee/i, 'Shopee'],
  [/amazon(?!\s*\*?\s*prime)|amzn/i, 'Amazon'],
  [/tik\s*tok\s*shop/i, 'TikTok Shop'],
  [/aliexpress/i, 'AliExpress'],
  [/\bshein\b/i, 'Shein'],
  [/\btemu\b/i, 'Temu'],
  [/magalu|magazine\s*luiza/i, 'Magalu'],
  // Nadafit counts as iFood; other "Ifd*" restaurants keep their names.
  [/^ifd\s*\*\s*nadafit\b/i, 'Ifood'],
  [/^boteco\s*capit[aã]o/i, 'Boteco Capitão'],
  [/^(lanchonete\s+)?paralelo(\s*17)?\b/i, 'Paralelo 17'],
  [/^cozinha\s+da\s+vil+a\b/i, 'Cozinha da Vila'],
  [/^panificadora\s+lindo\s+p[aã]o\b/i, 'Panificadora Lindo Pão'],
  // Laundry machine: "VMT* 579 - Bar" or "579 - Bar". Pinned to 579.
  [/^vmt\s*\*\s*579\b|^579\s*-\s*bar\b/i, 'Lavanderia'],
];

// Trailing legal form (Ltda, ME…), only as whole words at the end.
const LEGAL_SUFFIX = /(\s+(ltda|ltd|me|epp|eireli|s\.?\s?a\.?|ec))+\.?$/i;

export function normalizeMerchant(value: string) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return name;
  for (const [pattern, canonical] of KNOWN)
    if (pattern.test(name)) return canonical;
  const cleaned = name.replace(LEGAL_SUFFIX, '').trim();
  // Nothing but a legal form: keep it (the API rejects empty names).
  return cleaned || name;
}
