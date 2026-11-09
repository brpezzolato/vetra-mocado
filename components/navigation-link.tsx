'use client';

import type { ComponentProps } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { createPortal } from 'react-dom';
import { useDelayedLoading } from '@/lib/use-delayed-loading';

/* Troca de tela como num app: a tela atual fica até a próxima estar pronta
   (sem `loading.tsx` nas rotas) e, se demorar, só uma linha fina corre no
   topo. As telas visitadas ficam montadas (`cacheComponents`), então voltar
   a elas é instantâneo. */
function PendingNavigation() {
  const { pending } = useLinkStatus();
  const visible = useDelayedLoading(pending);
  if (!visible) return null;
  return createPortal(
    <div aria-hidden="true" className="vetra-route-progress" />,
    document.body,
  );
}

// Next owns the pending state, so canceled navigation cannot leave it stuck.
export default function NavigationLink({
  children,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <PendingNavigation />
    </Link>
  );
}
