import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { securitySession, acquireBudget } from '@/lib/security-server';
import { securityAdmin } from '@/lib/supabase/admin';
import {
  HttpError,
  readJsonBounded,
  requireSameOrigin,
  errorResponse,
} from '@/lib/http-security';

export const runtime = 'nodejs';
const UNLOCK_DURATION_MS = 4 * 60_000;
type Context = { params: Promise<{ action: string }> };
const json = (data: unknown) =>
  Response.json(data, { headers: { 'Cache-Control': 'no-store' } });

function relyingParty(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured && process.env.NODE_ENV === 'production')
    throw new HttpError(503, 'Domínio de segurança não configurado.');
  const origin = new URL(configured || 'http://localhost:3000').origin;
  if (new URL(request.url).origin !== origin)
    throw new HttpError(403, 'Domínio não autorizado.');
  return { origin, rpID: new URL(origin).hostname };
}

export async function GET(_request: Request, context: Context) {
  try {
    if ((await context.params).action !== 'status')
      throw new HttpError(404, 'Não encontrado.');
    const { status } = await securitySession(false);
    return json({
      enabled: status.enabled,
      unlocked: status.unlocked,
      expiresAt: status.expiresAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  let release: (() => Promise<void>) | undefined;
  try {
    requireSameOrigin(request);
    const action = (await context.params).action;
    const { db, user, status } = await securitySession(false);
    if (action === 'lock') {
      const result = await db.rpc('vetra_lock_session');
      if (result.error) throw result.error;
      return json({ locked: true });
    }
    const { origin, rpID } = relyingParty(request);
    const body = (await readJsonBounded(request, 32_768)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new HttpError(400, 'Dados inválidos.');
    const admin = securityAdmin();
    // Rate limiting and credential lookup do not depend on one another.
    const budgetRequest = acquireBudget(user.id, 'security').then((value) => {
      release = value;
    });
    const credentialRequest = Promise.resolve(
      admin
        .from('security_credentials')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle(),
    );
    const [, credentialResult] = await Promise.all([
      budgetRequest,
      credentialRequest,
    ]);
    if (credentialResult.error) throw credentialResult.error;
    const credential = credentialResult.data;
    const kind = body.kind;
    if (kind !== 'register' && kind !== 'authenticate' && kind !== 'disable')
      throw new HttpError(400, 'Operação inválida.');
    if (kind === 'register' && credential)
      throw new HttpError(
        409,
        'Já existe uma passkey. Desative a atual antes de substituir.',
      );
    if (kind !== 'register' && !credential)
      throw new HttpError(400, 'Configure sua passkey.');
    if (action === 'options') {
      const options =
        kind === 'register'
          ? await generateRegistrationOptions({
              rpName: 'Vetra',
              rpID,
              userID: new TextEncoder().encode(user.id),
              userName: user.email || user.id,
              attestationType: 'none',
              authenticatorSelection: {
                authenticatorAttachment: 'platform',
                residentKey: 'required',
                userVerification: 'required',
              },
              supportedAlgorithmIDs: [-7, -257],
            })
          : await generateAuthenticationOptions({
              rpID,
              allowCredentials: [{ id: credential!.id }],
              userVerification: 'required',
            });
      const cleanupRequest = admin
        .from('security_challenges')
        .delete()
        .eq('user_id', user.id)
        .lt('expires_at', new Date().toISOString());
      const saveRequest = admin
        .from('security_challenges')
        .insert({
          user_id: user.id,
          session_id: status.sessionId,
          kind,
          challenge: options.challenge,
          expires_at: new Date(Date.now() + 120_000).toISOString(),
        })
        .select('id')
        .single();
      const [, saved] = await Promise.all([cleanupRequest, saveRequest]);
      if (saved.error) throw saved.error;
      return json({ options, challengeId: saved.data.id });
    }
    if (action !== 'verify') throw new HttpError(404, 'Não encontrado.');
    if (typeof body.challengeId !== 'string' || !body.response)
      throw new HttpError(400, 'Resposta inválida.');
    // DELETE RETURNING consumes the challenge atomically, even on invalid signatures.
    const consumed = await admin
      .from('security_challenges')
      .delete()
      .eq('id', body.challengeId)
      .eq('user_id', user.id)
      .eq('session_id', status.sessionId)
      .eq('kind', kind)
      .gt('expires_at', new Date().toISOString())
      .select('challenge')
      .maybeSingle();
    if (consumed.error || !consumed.data)
      throw new HttpError(400, 'Verificação expirada. Tente novamente.');
    try {
      if (kind === 'register') {
        const result = await verifyRegistrationResponse({
          response: body.response as RegistrationResponseJSON,
          expectedChallenge: consumed.data.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          supportedAlgorithmIDs: [-7, -257],
        });
        if (!result.verified) throw new Error('Unverified');
        const key = result.registrationInfo.credential;
        const saved = await admin.from('security_credentials').insert({
          id: key.id,
          user_id: user.id,
          public_key: Buffer.from(key.publicKey).toString('base64url'),
          counter: key.counter,
        });
        if (saved.error) throw saved.error;
      } else {
        if ((body.response as AuthenticationResponseJSON).id !== credential!.id)
          throw new Error('Credential mismatch');
        const result = await verifyAuthenticationResponse({
          response: body.response as AuthenticationResponseJSON,
          expectedChallenge: consumed.data.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: credential!.id,
            publicKey: new Uint8Array(
              Buffer.from(credential!.public_key, 'base64url'),
            ),
            counter: credential!.counter,
          },
        });
        if (!result.verified) throw new Error('Unverified');
        const saved = await admin
          .from('security_credentials')
          .update({ counter: result.authenticationInfo.newCounter })
          .eq('id', credential!.id)
          .eq('user_id', user.id)
          .eq('counter', credential!.counter)
          .select('id')
          .single();
        if (saved.error) throw saved.error;
      }
    } catch {
      throw new HttpError(403, 'Não foi possível verificar sua identidade.');
    }
    if (kind === 'disable') {
      const removed = await admin
        .from('security_credentials')
        .delete()
        .eq('user_id', user.id);
      if (removed.error) throw removed.error;
      await admin.from('security_unlocks').delete().eq('user_id', user.id);
      return json({ enabled: false, unlocked: true, expiresAt: null });
    }
    const expiresAt = new Date(Date.now() + UNLOCK_DURATION_MS).toISOString();
    const unlocked = await admin.from('security_unlocks').upsert({
      user_id: user.id,
      session_id: status.sessionId,
      verified_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    if (unlocked.error) throw unlocked.error;
    return json({ enabled: true, unlocked: true, expiresAt });
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (release) await release().catch(() => {});
  }
}
