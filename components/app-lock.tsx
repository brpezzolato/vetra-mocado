'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  cachedBiometricUnlock,
  forgetBiometricUnlock,
  biometricLockStatus,
  biometricPromptActive,
  type LockStatus,
  unlockWithBiometrics,
} from '@/lib/biometric-lock';
import { AppLoading } from './app-loading';
import { FaceIdLoading } from './face-id-animation';

export function AppLock({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPage = ['/auth', '/offline', '/desbloquear'].includes(pathname);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  useEffect(() => {
    if (publicPage) return;
    let disposed = false;
    let enabled = false;
    let unlocking = false;
    let lockRequest: Promise<void> | null = null;
    let timer: ReturnType<typeof setTimeout>;

    function showUnlocked(status: LockStatus) {
      enabled = status.enabled;
      delete document.documentElement.dataset.vetraLocked;
      delete document.documentElement.dataset.vetraObscured;
      setReady(true);
      setError(false);
      clearTimeout(timer);
      if (status.enabled && status.expiresAt)
        timer = setTimeout(
          () => void lock(),
          Math.max(0, new Date(status.expiresAt).getTime() - Date.now()),
        );
    }

    async function unlockCurrentScreen() {
      if (disposed || unlocking || biometricPromptActive) return;
      unlocking = true;
      setReady(false);
      setAuthenticating(true);
      try {
        if (lockRequest) await lockRequest;
        const status = await unlockWithBiometrics();
        if (!disposed) showUnlocked(status);
      } catch {
        if (!disposed) window.location.replace('/desbloquear');
      } finally {
        unlocking = false;
        if (!disposed) setAuthenticating(false);
      }
    }

    async function lock() {
      if (!enabled || biometricPromptActive) return;
      setReady(false);
      forgetBiometricUnlock();
      document.documentElement.dataset.vetraLocked = 'true';
      try {
        lockRequest = fetch('/api/security/lock', {
          method: 'POST',
          keepalive: true,
        }).then((response) => {
          if (!response.ok) throw new Error('Lock failed');
        });
        await lockRequest;
      } finally {
        lockRequest = null;
        if (document.visibilityState === 'visible') void unlockCurrentScreen();
      }
    }
    async function check() {
      const cachedExpiry = cachedBiometricUnlock();
      if (cachedExpiry) {
        showUnlocked({
          enabled: true,
          unlocked: true,
          expiresAt: cachedExpiry,
        });
        return;
      }
      try {
        const status = await biometricLockStatus();
        if (disposed) return;
        if (!status.unlocked) {
          window.location.replace('/desbloquear');
          return;
        }
        showUnlocked(status);
      } catch {
        if (!disposed) {
          setReady(false);
          setError(true);
        }
      }
    }
    const visibility = () => {
      if (!enabled || biometricPromptActive) return;
      if (document.visibilityState === 'hidden') {
        document.documentElement.dataset.vetraObscured = 'true';
        return;
      }
      delete document.documentElement.dataset.vetraObscured;
      if (cachedBiometricUnlock()) return;
      setReady(false);
      void check();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setReady(false);
        void check();
      }
    };
    void check();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', pageshow);
    const securityChanged = (event: Event) => {
      const status = (event as CustomEvent<LockStatus>).detail;
      if (status?.unlocked) showUnlocked(status);
      else void check();
    };
    window.addEventListener('vetra:security-changed', securityChanged);
    return () => {
      disposed = true;
      clearTimeout(timer);
      delete document.documentElement.dataset.vetraObscured;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('vetra:security-changed', securityChanged);
    };
  }, [publicPage]);
  if (publicPage) return children;
  if (error)
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
        <div>
          <p>Não foi possível verificar sua sessão.</p>
          <button
            className="mt-4 underline"
            onClick={() => window.location.reload()}
          >
            Tentar novamente
          </button>
        </div>
      </main>
    );
  if (!ready) return authenticating ? <FaceIdLoading /> : <AppLoading />;
  return <div data-vetra-private>{children}</div>;
}
