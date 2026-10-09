import type { ReactNode } from 'react';

/**
 * Wraps any figure that reveals money so privacy mode can blur it (the
 * attribute is targeted in app/globals.css). Mark generously. This attribute
 * is the guarantee; `tabular-nums` being blurred too is incidental.
 */
export function Private({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span data-private-value className={className}>
      {children}
    </span>
  );
}
