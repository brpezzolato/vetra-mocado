type Refresh = () => void | Promise<unknown>;
type Listener = { refresh: Refresh; followUps: readonly number[] };
// Only mounted browser widgets register here; no financial data is retained.
const listeners = new Set<Listener>();
// The follow-up checks still waiting, so a new refresh or an unmount can
// cancel them.
const pending = new Map<Listener, ReturnType<typeof setTimeout>[]>();

/**
 * Reconferências (ms) após atualizar pela barra do topo: o banco pode levar
 * até um minuto para entregar à Pluggy. Cada componente só redesenha se mudou.
 */
export const BANK_FOLLOW_UPS = [6_000, 15_000, 30_000, 50_000] as const;

function cancel(listener: Listener) {
  for (const timer of pending.get(listener) ?? []) clearTimeout(timer);
  pending.delete(listener);
}

export function subscribeManualRefresh(
  refresh: Refresh,
  options: { followUps?: readonly number[] } = {},
) {
  const listener: Listener = { refresh, followUps: options.followUps ?? [] };
  listeners.add(listener);
  return () => {
    cancel(listener);
    listeners.delete(listener);
  };
}

export async function refreshMountedWidgets() {
  const results = await Promise.allSettled(
    [...listeners].map((listener) => {
      cancel(listener);
      if (listener.followUps.length)
        pending.set(
          listener,
          listener.followUps.map((delay) =>
            setTimeout(() => {
              void Promise.resolve()
                .then(listener.refresh)
                .catch(() => {});
            }, delay),
          ),
        );
      return Promise.resolve().then(listener.refresh);
    }),
  );
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/** Recarrega uma vez, sem reconferências: para mudanças feitas no próprio Vetra. */
export async function refreshWidgetsOnce() {
  await Promise.allSettled(
    [...listeners].map((listener) => Promise.resolve().then(listener.refresh)),
  );
}
