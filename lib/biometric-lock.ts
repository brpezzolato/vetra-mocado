import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';

export let biometricPromptActive = false;
export function biometricLockSupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof PublicKeyCredential !== 'undefined'
  );
}
export type LockStatus = {
  enabled: boolean;
  unlocked: boolean;
  expiresAt: string | null;
};
const unlockCacheKey = 'vetra:biometric-unlocked-until';

export function cachedBiometricUnlock() {
  if (typeof window === 'undefined') return null;
  const expiresAt = window.sessionStorage.getItem(unlockCacheKey);
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
    window.sessionStorage.removeItem(unlockCacheKey);
    return null;
  }
  return expiresAt;
}

export function forgetBiometricUnlock() {
  if (typeof window !== 'undefined')
    window.sessionStorage.removeItem(unlockCacheKey);
}

function rememberBiometricUnlock(status: LockStatus) {
  if (status.enabled && status.unlocked && status.expiresAt)
    window.sessionStorage.setItem(unlockCacheKey, status.expiresAt);
  else forgetBiometricUnlock();
}
export async function biometricLockStatus(): Promise<LockStatus> {
  const response = await fetch('/api/security/status', { cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível verificar sua sessão.');
  return response.json();
}
async function ceremony(kind: 'register' | 'authenticate' | 'disable') {
  if (!biometricLockSupported())
    throw new Error('Use HTTPS e um aparelho compatível com passkeys.');
  biometricPromptActive = true;
  try {
    const optionsResponse = await fetch('/api/security/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    });
    const payload = await optionsResponse.json();
    if (!optionsResponse.ok)
      throw new Error(
        payload.error || 'Não foi possível iniciar a verificação.',
      );
    const response =
      kind === 'register'
        ? await startRegistration({ optionsJSON: payload.options })
        : await startAuthentication({ optionsJSON: payload.options });
    const verified = await fetch('/api/security/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        challengeId: payload.challengeId,
        response,
      }),
    });
    const result = await verified.json();
    if (!verified.ok) throw new Error(result.error || 'Verificação recusada.');
    const status = result as LockStatus;
    localStorage.removeItem('vetra:biometric-lock');
    rememberBiometricUnlock(status);
    window.dispatchEvent(
      new CustomEvent<LockStatus>('vetra:security-changed', {
        detail: status,
      }),
    );
    return status;
  } finally {
    biometricPromptActive = false;
  }
}
export const enableBiometricLock = () => ceremony('register');
export const unlockWithBiometrics = () => ceremony('authenticate');
export const disableBiometricLock = () => ceremony('disable');
