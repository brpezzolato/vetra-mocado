'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Preferência guardada na conta (`user_preferences`), igual no celular e no
 * computador. `value` é `null` até carregar; `save` troca na hora e grava
 * logo depois (digitação seguida vira uma gravação só).
 */
export function useAccountPreference<T extends Record<string, unknown>>(
  key: string,
) {
  const client = useMemo(() => createClient(), []);
  const [value, setValue] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<T | null>(null);
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void client
      .from('user_preferences')
      .select('value')
      .eq('key', key)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        // Escolha feita antes de carregar vale mais que a guardada.
        if (data?.value && !touched.current) setValue(data.value as T);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [client, key]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    void client
      .from('user_preferences')
      .upsert(
        { key, value: next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' },
      )
      .then(() => undefined);
  }, [client, key]);

  // Saiu da tela com gravação na fila: grava antes.
  useEffect(() => flush, [flush]);

  const save = useCallback(
    (next: T) => {
      touched.current = true;
      setValue(next);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
    },
    [flush],
  );

  return { value, loaded, save };
}
