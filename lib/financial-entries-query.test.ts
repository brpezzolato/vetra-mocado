import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadFinancialEntries } from './financial-entries-query';

describe('financial entries pagination', () => {
  it('reads beyond the first 500 entries for complete monthly totals', async () => {
    const range = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 500 }, (_, id) => ({ id: String(id) })),
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ id: '501' }], error: null });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range,
    };
    const client = { from: () => query } as unknown as SupabaseClient;
    expect((await loadFinancialEntries(client)).data).toHaveLength(501);
    expect(range.mock.calls).toEqual([
      [0, 499],
      [500, 999],
    ]);
  });
  it('never returns incomplete totals when a page fails', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'offline' } }),
    };
    const result = await loadFinancialEntries({
      from: () => query,
    } as unknown as SupabaseClient);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('offline');
  });
  it('deixa de fora o que foi marcado para não contar, salvo quando pedido', async () => {
    const eq = vi.fn().mockReturnThis();
    const query = {
      select: vi.fn().mockReturnThis(),
      eq,
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = { from: () => query } as unknown as SupabaseClient;
    await loadFinancialEntries(client);
    expect(eq).toHaveBeenCalledWith('excluded_from_totals', false);
    eq.mockClear();
    await loadFinancialEntries(client, { includeExcluded: true });
    expect(eq).not.toHaveBeenCalled();
  });
});
