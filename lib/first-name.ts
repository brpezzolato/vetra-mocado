/** Primeiro nome para a saudação da home: do perfil ou, sem ele, do e-mail
 * antes do @ ("bruno.pezzolato" vira "Bruno"). Vazio se não houver nada. */
export function firstName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const metadata = user.user_metadata ?? {};
  const fromProfile = [metadata.full_name, metadata.name].find(
    (value): value is string => typeof value === 'string' && !!value.trim(),
  );
  const raw = fromProfile ?? user.email?.split('@')[0] ?? '';
  const first = raw.trim().split(/[\s._-]+/)[0] ?? '';
  if (!/^\p{L}+$/u.test(first)) return '';
  return (
    first.charAt(0).toLocaleUpperCase('pt-BR') +
    first.slice(1).toLocaleLowerCase('pt-BR')
  );
}
