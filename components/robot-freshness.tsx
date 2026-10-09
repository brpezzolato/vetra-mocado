'use client';

import { useEffect, useState } from 'react';
import { BANK_FOLLOW_UPS, subscribeManualRefresh } from '@/lib/manual-refresh';

/* Quando o robô pediu a última atualização aos bancos; nada sem robô conectado. */

async function fetchLastRefresh(): Promise<string | null> {
  const response = await fetch('/api/pluggy/robot?only=status', {
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    robot: { last_refresh_at: string | null } | null;
  };
  return body.robot?.last_refresh_at ?? null;
}

const label = (iso: string) => {
  const at = new Date(iso);
  const day = (date: Date) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
    }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  const when = day(at) === day(new Date()) ? 'hoje' : `em ${day(at)}`;
  return `Bancos atualizados ${when} às ${time}`;
};

/* Última data vista, só em memória: volta sem esperar e só redesenha se mudou. */
let lastSeen: string | null | undefined;

export function RobotFreshness() {
  const [lastRefresh, setLastRefresh] = useState<string | null>(
    () => lastSeen ?? null,
  );

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchLastRefresh()
        .then((value) => {
          if (!alive || value === lastSeen) return;
          lastSeen = value;
          setLastRefresh(value);
        })
        .catch(() => undefined);
    void load();
    const unsubscribe = subscribeManualRefresh(load, {
      followUps: BANK_FOLLOW_UPS,
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (!lastRefresh) return null;
  return (
    <p className="mt-2 px-1 text-xs text-muted-foreground">
      {label(lastRefresh)}
    </p>
  );
}
