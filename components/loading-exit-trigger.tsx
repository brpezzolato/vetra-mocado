'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  loadingHidden,
  loadingShown,
  playLoadingExit,
} from '@/lib/loading-exit';

/* Envolve a logo do carregamento e dispara a saída (lib/loading-exit.ts) ao
   desmontar. Layout effect: a limpeza roda antes da pintura, senão o app
   piscava um quadro. Carregamento de menos de 350 ms só some. */
const MIN_VISIBLE_MS = 350;

export function LoadingExitTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    loadingShown();
    const shownAt = performance.now();
    // Medido enquanto ainda está na tela: na saída o nó já pode ter saído.
    let rect = element.getBoundingClientRect();
    const measure = () => {
      rect = element.getBoundingClientRect();
    };
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      // Já há uma saída esperando: só a libera.
      if (loadingHidden()) return;
      const elapsedMs = performance.now() - shownAt;
      if (elapsedMs < MIN_VISIBLE_MS) return;
      // As barras: a saída parte de onde a Subida as deixou.
      playLoadingExit(rect, { source: element });
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
