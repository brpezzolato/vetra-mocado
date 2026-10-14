'use client';

import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef } from 'react';
import { coverUntilReady } from '@/lib/loading-exit';

/* Troca de tela sem carregamento (já em cache) que chega com esqueleto: o
   logo cobre até a tela montar (lib/loading-exit.ts). Na abertura quem cobre
   é o carregamento. Layout effect: decide antes da pintura. */
export function LoadingRouteGate() {
  const pathname = usePathname();
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    coverUntilReady();
  }, [pathname]);
  return null;
}
