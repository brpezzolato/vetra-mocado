'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(display-mode: standalone)';

/** Aberto como app instalado (tela de início), e não como site no navegador. */
export function isInstalledApp() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia(QUERY).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function useInstalledApp() {
  return useSyncExternalStore(subscribe, isInstalledApp, () => false);
}
