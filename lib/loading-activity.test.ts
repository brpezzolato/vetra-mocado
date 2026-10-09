import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadingFetch,
  loadingSnapshot,
  serverLoadingSnapshot,
  subscribeLoading,
  withLoading,
} from './loading-activity';

afterEach(() => vi.unstubAllGlobals());

describe('loading activity', () => {
  it('keeps GET, HEAD and auth refreshes silent', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        expect(loadingSnapshot()).toBe(0);
        return new Response('{}');
      }),
    );
    await loadingFetch('https://example.test/rest/v1/entries');
    await loadingFetch('https://example.test/rest/v1/entries', {
      method: 'HEAD',
    });
    await loadingFetch('https://example.test/auth/v1/token', {
      method: 'POST',
    });
  });
  it('tracks writes without leaving the loader pending', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        expect(loadingSnapshot()).toBe(1);
        return new Response('{}');
      }),
    );
    await loadingFetch('https://example.test/rest/v1/entries', {
      method: 'POST',
    });
    expect(loadingSnapshot()).toBe(0);
  });
  it('does not share server requests with the UI', async () => {
    await withLoading(async () => expect(loadingSnapshot()).toBe(0));
    expect(serverLoadingSnapshot()).toBe(0);
  });

  it('keeps the loader until all concurrent requests finish', async () => {
    vi.stubGlobal('window', {});
    const states: number[] = [];
    const unsubscribe = subscribeLoading(() => states.push(loadingSnapshot()));
    let finish!: () => void;
    const first = withLoading(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await withLoading(async () => expect(loadingSnapshot()).toBe(2));
    expect(loadingSnapshot()).toBe(1);
    finish();
    await first;
    expect(states).toEqual([1, 2, 1, 0]);
    unsubscribe();
  });

  it('clears the loader on rejection and abort', async () => {
    vi.stubGlobal('window', {});
    for (const error of [
      new Error('network'),
      new DOMException('Aborted', 'AbortError'),
    ]) {
      await expect(
        withLoading(async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      expect(loadingSnapshot()).toBe(0);
    }
  });
});
