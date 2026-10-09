import type { PiggySyncResult } from './piggy-sync';
import type { CardSyncResult } from './card-sync';

/* Tipos e resumo do histórico de sincronizações, usáveis no cliente. */

export type SyncTrigger = 'cron' | 'manual' | 'webhook';
export type RunStatus = 'ok' | 'partial' | 'error';

/** Só contagens e totais: nada de conta, descrição ou pessoa. */
export type RunSummary = {
  entries: number;
  spent: number;
  earned: number;
  updated: number;
  removed: number;
  movements: number;
  vaultsCreated: number;
  vaultsArchived: number;
  errors: number;
};

export type SyncRun = {
  id: number;
  trigger: SyncTrigger;
  status: RunStatus;
  started_at: string;
  duration_ms: number;
  robot: string | null;
  summary: Partial<RunSummary>;
  error: string | null;
};

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function summarize(
  piggy: PiggySyncResult | null,
  cards: CardSyncResult | null,
): RunSummary {
  return {
    entries: cards?.inserted ?? 0,
    spent: Math.round((cards?.spent ?? 0) * 100) / 100,
    earned: Math.round((cards?.earned ?? 0) * 100) / 100,
    updated: cards?.updated ?? 0,
    removed: cards?.removed ?? 0,
    movements: piggy?.movements ?? 0,
    vaultsCreated: piggy?.created ?? 0,
    vaultsArchived: piggy?.archived ?? 0,
    errors: (piggy?.errors ?? 0) + (cards?.errors ?? 0),
  };
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** O resumo em uma frase, para a notificação e para o histórico. */
export function describeSummary(summary: Partial<RunSummary>): string {
  const parts: string[] = [];
  const entries = summary.entries ?? 0;
  if (entries) {
    const totals = [
      summary.spent ? `${money.format(summary.spent)} em saídas` : '',
      summary.earned ? `${money.format(summary.earned)} em entradas` : '',
    ].filter(Boolean);
    parts.push(
      plural(entries, 'lançamento novo', 'lançamentos novos') +
        (totals.length ? ` (${totals.join(' e ')})` : ''),
    );
  }
  if (summary.movements)
    parts.push(
      plural(
        summary.movements,
        'movimentação nos cofrinhos',
        'movimentações nos cofrinhos',
      ),
    );
  if (summary.vaultsCreated)
    parts.push(
      plural(summary.vaultsCreated, 'cofrinho novo', 'cofrinhos novos'),
    );
  if (summary.updated)
    parts.push(
      plural(summary.updated, 'lançamento revisto', 'lançamentos revistos'),
    );
  if (summary.removed)
    parts.push(
      plural(summary.removed, 'lançamento removido', 'lançamentos removidos'),
    );
  if (!parts.length) return 'Nada novo desde a última atualização.';
  const text =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

export function runStatus(summary: RunSummary, failed: boolean): RunStatus {
  if (failed) return 'error';
  return summary.errors ? 'partial' : 'ok';
}

/** Intervalo máximo para duas sincronizações contarem como a mesma rodada. */
const ROUND_GAP_MS = 30_000;

const STATUS_RANK: Record<RunStatus, number> = { ok: 0, partial: 1, error: 2 };
const TRIGGER_RANK: Record<SyncTrigger, number> = {
  webhook: 0,
  cron: 1,
  manual: 2,
};

/**
 * Junta sincronizações coladas numa rodada: do início da primeira ao fim da
 * última; origem botão > cron > aviso; pior resultado; novos somam, revistos
 * e removidos ficam no maior. Do mais recente ao mais antigo.
 */
export function groupRounds(runs: SyncRun[]): SyncRun[] {
  const ordered = [...runs].sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
  );
  const rounds: { run: SyncRun; start: number; end: number }[] = [];
  for (const run of ordered) {
    const start = Date.parse(run.started_at);
    const end = start + run.duration_ms;
    const last = rounds.at(-1);
    if (!last || start > last.end + ROUND_GAP_MS) {
      rounds.push({ run: { ...run, summary: { ...run.summary } }, start, end });
      continue;
    }
    const merged = last.run;
    last.end = Math.max(last.end, end);
    if (TRIGGER_RANK[run.trigger] > TRIGGER_RANK[merged.trigger])
      merged.trigger = run.trigger;
    if (STATUS_RANK[run.status] > STATUS_RANK[merged.status])
      merged.status = run.status;
    merged.robot = merged.robot ?? run.robot;
    merged.error = merged.error ?? run.error;
    const a = merged.summary;
    const b = run.summary;
    const add = (key: keyof RunSummary) => (a[key] ?? 0) + (b[key] ?? 0);
    const max = (key: keyof RunSummary) => Math.max(a[key] ?? 0, b[key] ?? 0);
    merged.summary = {
      entries: add('entries'),
      spent: Math.round(add('spent') * 100) / 100,
      earned: Math.round(add('earned') * 100) / 100,
      movements: add('movements'),
      vaultsCreated: add('vaultsCreated'),
      vaultsArchived: add('vaultsArchived'),
      errors: add('errors'),
      updated: max('updated'),
      removed: max('removed'),
    };
  }
  return rounds
    .map(({ run, start, end }) => ({ ...run, duration_ms: end - start }))
    .reverse();
}
