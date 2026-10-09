import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
const state = vi.hoisted(() => ({
  credential: null as Record<string, unknown> | null,
  challenge: 'test-challenge',
  consumed: false,
  unlocks: 0,
  unlockExpiresAt: '',
  queries: [] as [string, string, unknown][],
  disabled: false,
}));
vi.mock('@/lib/security-server', () => ({
  securitySession: async () => ({
    user: { id: 'owner' },
    status: { sessionId: 'session', enabled: true, unlocked: false },
  }),
  acquireBudget: async () => async () => {},
}));
vi.mock('@/lib/supabase/admin', () => ({
  securityAdmin: () => ({
    from: (table: string) => {
      let op = 'select';
      let update: unknown;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          state.queries.push([table, key, value]);
          return query;
        },
        gt: () => query,
        delete: () => {
          op = 'delete';
          return query;
        },
        update: (value: unknown) => {
          op = 'update';
          update = value;
          return query;
        },
        upsert: (value: { expires_at?: string }) => {
          state.unlocks++;
          state.unlockExpiresAt = value.expires_at ?? '';
          return Promise.resolve({ error: null });
        },
        maybeSingle: async () => {
          if (table === 'security_credentials')
            return { data: state.credential, error: null };
          if (table === 'security_challenges' && op === 'delete') {
            const value = state.consumed
              ? null
              : { challenge: state.challenge };
            state.consumed = true;
            return { data: value, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (op === 'update') Object.assign(state.credential!, update);
          return { data: { id: 'credential' }, error: null };
        },
      };
      return query;
    },
  }),
}));
import { POST } from './[action]/route';
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});
const jwk = publicKey.export({ format: 'jwk' });
const cose = Buffer.concat([
  Buffer.from('a5010203262001215820', 'hex'),
  Buffer.from(jwk.x!, 'base64url'),
  Buffer.from('225820', 'hex'),
  Buffer.from(jwk.y!, 'base64url'),
]);

function assertion(
  origin = 'https://vetra.example',
  challenge = state.challenge,
  flags = 5,
) {
  const client = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge, origin }),
  );
  const auth = Buffer.concat([
    createHash('sha256').update('vetra.example').digest(),
    Buffer.from([flags]),
    Buffer.from([0, 0, 0, 1]),
  ]);
  const signature = sign(
    'sha256',
    Buffer.concat([auth, createHash('sha256').update(client).digest()]),
    privateKey,
  );
  return {
    id: 'Y3JlZGVudGlhbA',
    rawId: 'Y3JlZGVudGlhbA',
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: client.toString('base64url'),
      authenticatorData: auth.toString('base64url'),
      signature: signature.toString('base64url'),
    },
  };
}
function request(response: unknown) {
  return new Request('https://vetra.example/api/security/verify', {
    method: 'POST',
    headers: {
      origin: 'https://vetra.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'authenticate',
      challengeId: 'challenge-id',
      response,
    }),
  });
}
const context = { params: Promise.resolve({ action: 'verify' }) };
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://vetra.example');
  state.credential = {
    id: 'Y3JlZGVudGlhbA',
    public_key: cose.toString('base64url'),
    counter: 0,
  };
  state.consumed = false;
  state.unlocks = 0;
  state.unlockExpiresAt = '';
  state.queries = [];
});
describe('real WebAuthn assertion verification', () => {
  it('accepts a signed assertion and binds challenge consumption to owner and session', async () => {
    const startedAt = Date.now();
    expect((await POST(request(assertion()), context)).status).toBe(200);
    expect(state.unlocks).toBe(1);
    expect(
      new Date(state.unlockExpiresAt).getTime() - startedAt,
    ).toBeLessThanOrEqual(241_000);
    expect(
      new Date(state.unlockExpiresAt).getTime() - startedAt,
    ).toBeGreaterThan(239_000);
    expect(state.queries).toContainEqual([
      'security_challenges',
      'user_id',
      'owner',
    ]);
    expect(state.queries).toContainEqual([
      'security_challenges',
      'session_id',
      'session',
    ]);
  });
  it('rejects challenge replay', async () => {
    const signed = assertion();
    expect((await POST(request(signed), context)).status).toBe(200);
    expect((await POST(request(signed), context)).status).toBe(400);
    expect(state.unlocks).toBe(1);
  });
  it.each(['origin', 'challenge', 'signature', 'verification', 'credential'])(
    'rejects invalid %s without granting access',
    async (kind) => {
      const signed = assertion(
        kind === 'origin' ? 'https://evil.example' : 'https://vetra.example',
        kind === 'challenge' ? 'wrong' : state.challenge,
        kind === 'verification' ? 1 : 5,
      );
      if (kind === 'signature')
        signed.response.signature = Buffer.alloc(64).toString('base64url');
      if (kind === 'credential') {
        signed.id = 'b3RoZXI';
        signed.rawId = 'b3RoZXI';
      }
      expect((await POST(request(signed), context)).status).toBe(403);
      expect(state.unlocks).toBe(0);
    },
  );
});
