'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'vetra:privacy-mode';

function applyPrivacyMode(enabled: boolean) {
  document.documentElement.dataset.vetraPrivacy = String(enabled);
}

export function PrivacyModeToggle({ className }: { className?: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) === 'true';
    applyPrivacyMode(stored);
    queueMicrotask(() => setEnabled(stored));
    const sync = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail;
      setEnabled(next);
      applyPrivacyMode(next);
    };
    window.addEventListener('vetra:privacy-mode', sync);
    return () => window.removeEventListener('vetra:privacy-mode', sync);
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      aria-pressed={enabled}
      aria-label={enabled ? 'Mostrar valores' : 'Ocultar valores'}
      title={enabled ? 'Mostrar valores' : 'Ocultar valores'}
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        applyPrivacyMode(next);
        window.localStorage.setItem(STORAGE_KEY, String(next));
        window.dispatchEvent(
          new CustomEvent<boolean>('vetra:privacy-mode', { detail: next }),
        );
      }}
    >
      {enabled ? <EyeOff /> : <Eye />}
    </Button>
  );
}
