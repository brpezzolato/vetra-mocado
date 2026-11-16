// Limites da atualização pelo notebook (tabela `pluggy_local_rounds`). Puro.
// O Open Finance limita as leituras por mês: 4 rodadas agendadas e 2 pedidas
// pelo botão por dia (São Paulo), e 10 min entre uma e outra. Só conta a
// rodada em que a Pluggy aceitou o clique (`ok`); falha não gasta leitura.

export type LocalTrigger = 'button' | 'schedule';
export type LocalStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';

export type LocalRound = {
  id: string;
  trigger: LocalTrigger;
  status: LocalStatus;
  result: string | null;
  detail: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export const LOCAL_PER_DAY: Record<LocalTrigger, number> = {
  schedule: 4,
  button: 2,
};
export const LOCAL_EVERY_MS = 10 * 60_000;
/** Sem sinal há mais que isso, o notebook está desligado ou dormindo. */
export const AGENT_ONLINE_MS = 2 * 60_000;
/** Pedido que o notebook não pegou nesse tempo vence. */
export const REQUEST_TTL_MS = 30 * 60_000;

export const saoPauloDay = (value: Date | string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(value),
  );

/** Rodadas aceitas hoje, por origem. */
export function usedToday(rounds: LocalRound[], now: Date) {
  const today = saoPauloDay(now);
  const used: Record<LocalTrigger, number> = { schedule: 0, button: 0 };
  for (const round of rounds)
    if (
      round.status === 'ok' &&
      saoPauloDay(round.started_at ?? round.requested_at) === today
    )
      used[round.trigger]++;
  return used;
}

/**
 * Pode começar uma rodada agora? `busy` com outra na fila ou rodando,
 * `daily_cap` sem saldo do dia para essa origem, `too_soon` com uma aceita há
 * menos de 10 min.
 */
export function roundVerdict(
  rounds: LocalRound[],
  trigger: LocalTrigger,
  now: Date,
  ignore?: string,
): 'ok' | 'busy' | 'daily_cap' | 'too_soon' {
  const others = rounds.filter((round) => round.id !== ignore);
  if (
    others.some(
      (round) =>
        round.status === 'running' ||
        (round.status === 'pending' &&
          now.getTime() - Date.parse(round.requested_at) < REQUEST_TTL_MS),
    )
  )
    return 'busy';
  if (usedToday(others, now)[trigger] >= LOCAL_PER_DAY[trigger])
    return 'daily_cap';
  const lastOk = Math.max(
    0,
    ...others
      .filter((round) => round.status === 'ok')
      .map((round) => Date.parse(round.finished_at ?? round.requested_at)),
  );
  if (now.getTime() - lastOk < LOCAL_EVERY_MS) return 'too_soon';
  return 'ok';
}
