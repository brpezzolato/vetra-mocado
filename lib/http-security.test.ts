import { describe, it, expect } from 'vitest';
import { readJsonBounded, requireSameOrigin } from './http-security';

describe('HTTP security boundaries', () => {
  it('rejects an untrusted or absent origin', () => {
    for (const origin of ['https://evil.example', 'null', ''])
      expect(() =>
        requireSameOrigin(
          new Request('https://vetra.example/api', { headers: { origin } }),
        ),
      ).toThrow();
    expect(() =>
      requireSameOrigin(
        new Request('https://vetra.example/api', {
          headers: { origin: 'https://vetra.example' },
        }),
      ),
    ).not.toThrow();
  });
  it('limits bytes without trusting Content-Length', async () => {
    const request = new Request('https://vetra.example/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
      body: JSON.stringify({ data: 'á'.repeat(200) }),
    });
    await expect(readJsonBounded(request, 250)).rejects.toMatchObject({
      status: 413,
    });
  });
  it('rejects malformed JSON and non-JSON bodies', async () => {
    await expect(
      readJsonBounded(
        new Request('https://vetra.example/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readJsonBounded(
        new Request('https://vetra.example/api', {
          method: 'POST',
          body: '{}',
        }),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
  it('accepts a bounded valid JSON payload', async () => {
    await expect(
      readJsonBounded(
        new Request('https://vetra.example/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"ok":true}',
        }),
      ),
    ).resolves.toEqual({ ok: true });
  });
});
