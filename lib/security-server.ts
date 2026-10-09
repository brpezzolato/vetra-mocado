import { createClient } from './supabase/server';
import { securityAdmin } from './supabase/admin';
import { HttpError } from './http-security';

export async function securitySession(requireUnlocked = true) {
  const db = await createClient();
  // getClaims verifies the signed JWT without an Auth-server round-trip when
  // the project uses asymmetric keys, which makes the biometric path faster.
  const { data: auth, error: authError } = await db.auth.getClaims();
  const subject = auth?.claims?.sub;
  const email = auth?.claims?.email;
  if (authError || typeof subject !== 'string')
    throw new HttpError(401, 'Entre na sua conta.');
  const user = {
    id: subject,
    email: typeof email === 'string' ? email : undefined,
  };
  const { data, error } = await db.rpc('vetra_security_status');
  if (error || !data?.sessionId)
    throw new HttpError(
      503,
      'Não foi possível verificar a segurança da sessão.',
    );
  if (requireUnlocked && !data.unlocked)
    throw new HttpError(423, 'Desbloqueie o Vetra.');
  return {
    db,
    user,
    status: data as {
      sessionId: string;
      enabled: boolean;
      unlocked: boolean;
      expiresAt: string | null;
    },
  };
}

export async function acquireBudget(
  subject: string,
  scope: 'ai' | 'security' = 'ai',
) {
  const admin = securityAdmin();
  const { data, error } = await admin.rpc('vetra_acquire_budget', {
    p_subject: subject,
    p_scope: scope,
  });
  if (error) throw new HttpError(503, 'Limites temporariamente indisponíveis.');
  if (!data)
    throw new HttpError(
      429,
      'Limite de uso atingido. Tente novamente mais tarde.',
    );
  return async () => {
    await admin.from('security_request_leases').delete().eq('id', data);
  };
}
