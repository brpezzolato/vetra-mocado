'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { FaceIdAnimation } from './face-id-animation';
import { unlockWithBiometrics } from '@/lib/biometric-lock';
import { createClient } from '@/lib/supabase/client';
import { scheduleAutomaticUnlock } from '@/lib/automatic-unlock';

export function UnlockScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const unlock = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await unlockWithBiometrics();
      if (!mounted.current) return;
      router.replace('/');
    } catch {
      if (mounted.current) {
        setError(
          'Verificação cancelada ou indisponível. Toque abaixo para tentar novamente.',
        );
        setBusy(false);
      }
    } finally {
      inFlight.current = false;
    }
  }, [router]);
  useEffect(() => {
    mounted.current = true;
    // This page contains no private data, so its retry UI must remain visible.
    delete document.documentElement.dataset.vetraLocked;
    const cancel = scheduleAutomaticUnlock(() => void unlock(), document);
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [unlock]);
  return (
    <main className="grid min-h-dvh place-items-center bg-black p-6 text-center text-white">
      <section className="w-full max-w-xs">
        <div className="flex justify-center">
          <FaceIdAnimation muted={!busy} />
        </div>
        {!busy && (
          <p className="mt-4 text-sm text-white/65">
            Não foi possível confirmar sua identidade.
          </p>
        )}
        {!busy && (
          <Button
            className="mt-6 w-full bg-white text-black hover:bg-white/90"
            disabled={busy}
            onClick={() => void unlock()}
          >
            Tentar Face ID novamente
          </Button>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-white/55">
            {error}
          </p>
        )}
        {!busy && (
          <Button
            variant="ghost"
            className="mt-2 text-white/60 hover:bg-white/10 hover:text-white"
            onClick={() =>
              void createClient()
                .auth.signOut()
                .then(() => window.location.replace('/auth'))
            }
          >
            Sair da conta
          </Button>
        )}
      </section>
    </main>
  );
}
