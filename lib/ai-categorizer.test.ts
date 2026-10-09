import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categorizeExpenseWithAI } from './ai-categorizer';

beforeEach(() => {
  process.env.GEMINI_DATA_POLICY = 'paid-no-training';
});
afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_CATEGORIZATION_MODEL;
  delete process.env.GEMINI_CATEGORIZATION_FALLBACK_MODEL;
  delete process.env.GEMINI_DATA_POLICY;
  vi.unstubAllGlobals();
});

describe('AI expense categorization', () => {
  it('never calls Gemini when data sharing is blocked', async () => {
    process.env.GEMINI_DATA_POLICY = 'blocked';
    process.env.GEMINI_API_KEY = 'test-key';
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    expect(
      await categorizeExpenseWithAI({
        description: 'Padaria',
        account: 'Nubank',
      }),
    ).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });
  it('never sends a card number or e-mail', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const provider = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', provider);
    await categorizeExpenseWithAI({
      description: 'Loja 5162 9200 1234 5678 bruno@exemplo.com',
      account: 'Nubank',
    });
    const sent = String(provider.mock.calls[0]?.[1]?.body);
    expect(sent).not.toMatch(/5162|5678|bruno@exemplo/);
    // O nome da loja é o que há para categorizar, então fica.
    expect(sent).toContain('Loja');
  });

  it('stays optional when no server key is configured', async () => {
    expect(
      await categorizeExpenseWithAI({
        description: 'Padaria',
        account: 'Nubank',
      }),
    ).toBeNull();
  });

  it('accepts only confident categories from structured output', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      category: 'Alimentação',
                      confidence: 0.96,
                    }),
                  },
                ],
              },
            },
          ],
        }),
      }),
    );
    expect(
      await categorizeExpenseWithAI({
        description: 'Padaria Central',
        account: 'Nubank',
      }),
    ).toBe('Alimentação');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('gemini-3.8-flash:generateContent'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'test-key' }),
      }),
    );
  });

  it('ignores a low-confidence Gemini suggestion', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      category: 'Compras',
                      confidence: 0.4,
                    }),
                  },
                ],
              },
            },
          ],
        }),
      }),
    );

    expect(
      await categorizeExpenseWithAI({
        description: 'Estabelecimento desconhecido',
        account: 'Nubank',
      }),
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the lightweight fallback when the primary model is busy', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        category: 'Alimentação',
                        confidence: 0.94,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        }),
    );

    expect(
      await categorizeExpenseWithAI({
        description: 'Padaria Central',
        account: 'Nubank',
      }),
    ).toBe('Alimentação');
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('gemini-3.5-flash-lite:generateContent'),
      expect.any(Object),
    );
  });

  it('nunca manda Pix: a descrição é o nome de quem recebeu', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GEMINI_API_KEY', 'test');
    expect(
      await categorizeExpenseWithAI({
        description: 'Julia Souza',
        account: 'Pix',
      }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
