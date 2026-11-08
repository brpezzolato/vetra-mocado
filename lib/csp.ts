/*
 * Política de conteúdo das páginas (Content-Security-Policy), montada a cada
 * pedido no proxy com um nonce novo: só roda script que o Next carimbou com
 * ele (`strict-dynamic` deixa esses scripts carregarem os pedaços do app).
 * Estilo segue com 'unsafe-inline' porque o app usa `style={…}` (gráficos,
 * animações), que nonce não cobre.
 */

/** Nonce de uso único, em base64. */
export function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(
  nonce: string,
  { supabaseUrl, dev }: { supabaseUrl?: string; dev: boolean },
) {
  // O navegador fala direto com o Supabase (login, consultas e tempo real).
  const supabase = supabaseUrl ? new URL(supabaseUrl) : null;
  const connect = [
    "'self'",
    ...(supabase ? [supabase.origin, `wss://${supabase.host}`] : []),
  ];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
