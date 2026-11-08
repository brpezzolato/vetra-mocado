import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, createNonce } from './csp';

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy('abc', {
    supabaseUrl: 'https://projeto.supabase.co',
    dev: false,
  });

  it('só deixa rodar script com o nonce do pedido', () => {
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('libera o Supabase, incluindo o tempo real', () => {
    expect(policy).toContain(
      "connect-src 'self' https://projeto.supabase.co wss://projeto.supabase.co",
    );
  });

  it('mantém as travas de moldura, objeto e formulário', () => {
    for (const rule of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ])
      expect(policy).toContain(rule);
  });

  it('em desenvolvimento aceita eval (o Next precisa) e não força https', () => {
    const dev = contentSecurityPolicy('abc', { dev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain('upgrade-insecure-requests');
  });
});

describe('createNonce', () => {
  it('é novo a cada pedido', () => {
    expect(createNonce()).not.toBe(createNonce());
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
