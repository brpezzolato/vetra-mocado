/**
 * Progresso da sincronização do botão (app-header) para o balão do mascote
 * (vetra-ai-bubble), via evento da janela (árvores diferentes). `value` até
 * onde anda, `duration` em quanto tempo; `null` esconde.
 */
export type SyncProgress = {
  value: number;
  duration: number;
  label: string;
} | null;

const EVENT = 'vetra:sync-progress';

export function publishSyncProgress(progress: SyncProgress) {
  window.dispatchEvent(
    new CustomEvent<SyncProgress>(EVENT, { detail: progress }),
  );
}

export function subscribeSyncProgress(
  listener: (progress: SyncProgress) => void,
) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<SyncProgress>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
