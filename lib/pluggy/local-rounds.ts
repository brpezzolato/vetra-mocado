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

/** Horários das rodadas automáticas (São Paulo), os mesmos do cron da Vercel. */
export const SCHEDULE_HOURS = [7, 14, 18, 23] as const;
/** Cada rodada cai num minuto aleatório até 45 min depois do horário. */
export const SCHEDULE_JITTER_MS = 45 * 60_000;
/** Notebook dormindo no horário: a rodada ainda vale até 3 h depois. */
export const SCHEDULE_WINDOW_MS = 3 * 3_600_000;

/**
 * Início do horário automático mais recente cuja janela ainda está aberta
 * (inclui o das 23h de ontem depois da meia-noite); `null` fora de todas.
 * São Paulo não tem horário de verão desde 2019: -03:00 fixo.
 */
export function currentSlot(now: Date): Date | null {
  const days = [
    saoPauloDay(new Date(now.getTime() - 86_400_000)),
    saoPauloDay(now),
  ];
  let best: Date | null = null;
  for (const day of days)
    for (const hour of SCHEDULE_HOURS) {
      const start = new Date(
        `${day}T${String(hour).padStart(2, '0')}:00:00-03:00`,
      );
      const since = now.getTime() - start.getTime();
      if (since >= 0 && since < SCHEDULE_WINDOW_MS && (!best || start > best))
        best = start;
    }
  return best;
}
