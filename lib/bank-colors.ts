/**
 * Cor de cada banco na página do banco e na barra da home; seguem os
 * cofrinhos (`bankPolicy` em lib/domain.ts). Itaú e PicPay usam a da marca.
 */
export const BANK_COLOUR = {
  nubank: '#b517f5',
  itau: '#ec7000',
  picpay: '#21c25e',
  'mercado-pago': '#ffe600',
  /** O cartão de benefício: a cor da marca (PAYMENT_METHOD_COLOUR). */
  flash: '#ff2a91',
} as const;

export type ColouredBank = keyof typeof BANK_COLOUR;

/** A cor de um banco pela chave; neutra para um que não está na lista. */
export const bankColour = (bank: string | null | undefined) =>
  bank && bank in BANK_COLOUR
    ? BANK_COLOUR[bank as ColouredBank]
    : 'var(--muted-foreground)';

/** O azul-marinho da marca Itaú, para o limite livre na barra. */
const ITAU_NAVY = '#000066';

const soft = (colour: string) =>
  `color-mix(in srgb, ${colour} 45%, transparent)`;

/**
 * Pedaço da barra da home: saldo na cor do banco, limite livre num tom mais
 * claro. Exceções: Nubank (limite roxo vivo #b517f5, saldo #820ad1 esmaecido)
 * e Itaú (saldo laranja cheio, limite azul-marinho #000066).
 */
export function barColour(
  bank: string | null | undefined,
  kind: 'balance' | 'limit',
) {
  if (bank === 'nubank') return kind === 'limit' ? '#b517f5' : soft('#820ad1');
  if (bank === 'itau') return kind === 'limit' ? ITAU_NAVY : BANK_COLOUR.itau;
  const colour = bankColour(bank);
  return kind === 'limit' ? soft(colour) : colour;
}
