'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { refreshWidgetsOnce } from '@/lib/manual-refresh';

/* A home se atualiza sozinha: a cada `PULSE_MS` (e ao voltar ao app) uma
   consulta leve (contagem, última alteração e última foto do limite) diz se
   algo mudou; se mudou, chama `refreshWidgetsOnce` e recarrega o sininho
   (quando algo muda nos dados). Não chama a Pluggy. */

export const PULSE_MS = 30_000;

export function useEntriesPulse() {
  useEffect(() => {
    const client = createClient();
    let last: string | null = null;
    let busy = false;
    let timer = 0;

    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        // Lançamentos e fotos do limite (de onde sai a "compra a chegar").
        const [entries, limits] = await Promise.all([
          client
            .from('financial_entries')
            .select('updated_at', { count: 'exact' })
            .order('updated_at', { ascending: false })
            .limit(1),
          client
            .from('card_limit_snapshots')
            .select('taken_at')
            .order('taken_at', { ascending: false })
            .limit(1),
        ]);
        if (entries.error) return;
        const signature = [
          entries.count ?? 0,
          entries.data?.[0]?.updated_at ?? '',
          limits.data?.[0]?.taken_at ?? '',
        ].join(':');
        // A primeira leitura só marca o ponto de partida.
        // Mudou: atualiza a tela e o sininho (o robô costuma trazer aviso).
        if (last !== null && signature !== last) {
          await refreshWidgetsOnce();
          window.dispatchEvent(new Event('vetra:notifications'));
        }
        last = signature;
      } finally {
        busy = false;
      }
    };

    const schedule = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => void check(), PULSE_MS);
    };
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      void check();
      schedule();
    };

    void check();
    schedule();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, []);
}
