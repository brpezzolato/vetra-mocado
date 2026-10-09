import { describe, expect, it, vi } from 'vitest';
import {
  refreshMountedWidgets,
  refreshWidgetsOnce,
  subscribeManualRefresh,
} from './manual-refresh';

describe('manual navbar refresh', () => {
  it('awaits mounted widgets and unregisters unmounted widgets', async () => {
    const refresh = vi.fn(async () => {});
    const unsubscribe = subscribeManualRefresh(refresh);
    await refreshMountedWidgets();
    expect(refresh).toHaveBeenCalledTimes(1);
    unsubscribe();
    await refreshMountedWidgets();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('refreshes other widgets even if one fails', async () => {
    const removeFailure = subscribeManualRefresh(() => {
      throw new Error('offline');
    });
    const healthy = vi.fn(async () => {});
    const removeHealthy = subscribeManualRefresh(healthy);
    try {
      await expect(refreshMountedWidgets()).rejects.toThrow('offline');
      expect(healthy).toHaveBeenCalledOnce();
    } finally {
      removeFailure();
      removeHealthy();
    }
  });
});

describe('conferências depois da atualização', () => {
  it('lê na hora e confere de novo nos momentos pedidos', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const unsubscribe = subscribeManualRefresh(refresh, {
      followUps: [6_000, 15_000],
    });
    await refreshMountedWidgets();
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    unsubscribe();
    vi.useRealTimers();
  });

  it('uma atualização nova reinicia as conferências e sair cancela', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const unsubscribe = subscribeManualRefresh(refresh, {
      followUps: [10_000],
    });
    await refreshMountedWidgets();
    await vi.advanceTimersByTimeAsync(5_000);
    await refreshMountedWidgets();
    await vi.advanceTimersByTimeAsync(6_000);
    // A primeira conferência (em 10 s) foi cancelada pela segunda leitura.
    expect(refresh).toHaveBeenCalledTimes(2);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('recarga única (lançamento novo no próprio Vetra)', () => {
  it('lê uma vez, sem as conferências seguintes, e não para por um erro', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const removeFailure = subscribeManualRefresh(() => {
      throw new Error('offline');
    });
    const unsubscribe = subscribeManualRefresh(refresh, {
      followUps: [6_000],
    });
    await refreshWidgetsOnce();
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    removeFailure();
    unsubscribe();
    vi.useRealTimers();
  });
});
