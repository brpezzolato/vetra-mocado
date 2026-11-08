// Formatos de data e cor usados nas telas dos cofrinhos.

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

export const dateBR = (date: string | Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: SAO_PAULO_TIME_ZONE }).format(
    typeof date === 'string'
      ? new Date(`${date.slice(0, 10)}T12:00:00-03:00`)
      : date,
  );

export const shortDate = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: SAO_PAULO_TIME_ZONE,
  }).format(date);

/** Cor de texto legível do banco do cofrinho (tokens por tema). */
export const vaultTextAccent = (institution: string) => {
  if (/nubank/i.test(institution)) return 'var(--brand-nubank-text)';
  if (/mercado\s*pago/i.test(institution))
    return 'var(--brand-mercadopago-text)';
  return undefined;
};
