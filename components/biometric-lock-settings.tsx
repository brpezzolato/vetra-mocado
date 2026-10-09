'use client';

import { useEffect, useState } from 'react';
import { ScanFace, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  biometricLockStatus,
  biometricLockSupported,
  disableBiometricLock,
  enableBiometricLock,
} from '@/lib/biometric-lock';

export function BiometricLockSettings() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    queueMicrotask(() => setSupported(biometricLockSupported()));
    void biometricLockStatus()
      .then((status) => setEnabled(status.enabled))
      .catch(() => setError('Não foi possível verificar a proteção.'));
  }, []);

  async function enable() {
    setBusy(true);
    setError('');
    try {
      await enableBiometricLock();
      setEnabled(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível configurar a biometria.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-7 rounded-3xl border bg-card p-5 md:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-muted">
              <ShieldCheck className="size-5" />
            </span>
            <h2 className="font-semibold">Bloqueio por Face ID</h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Proteja sua conta com uma passkey. Ao entrar ou retornar ao app,
            confirme com Face ID, Touch ID ou o código do aparelho. Guarde a
            passkey no seu gerenciador para poder usá-la em outros dispositivos.
          </p>
        </div>
        {enabled ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await disableBiometricLock();
                setEnabled(false);
              } catch {
                setError('Confirme sua identidade para desativar.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Desativar
          </Button>
        ) : (
          <Button disabled={busy || !supported} onClick={() => void enable()}>
            <ScanFace />
            {busy ? 'Configurando…' : 'Ativar Face ID'}
          </Button>
        )}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {enabled
          ? 'Ativo nesta conta. Desbloqueio mantido por até 4 minutos.'
          : supported
            ? 'Desativado nesta conta.'
            : 'Abra o Vetra em HTTPS em um aparelho compatível para ativar.'}
      </p>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  );
}
