'use client';

import type { ComponentProps } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { createPortal } from 'react-dom';
import { ExpensesLoading } from '@/components/expenses-loading';
import { useDelayedLoading } from '@/lib/use-delayed-loading';

function PendingNavigation() {
  const { pending } = useLinkStatus();
  const visible = useDelayedLoading(pending);
  if (!visible) return null;
  return createPortal(<ExpensesLoading />, document.body);
}

// Immediate feedback during the transition, before the streamed route fallback.
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
