'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeftSymbol, GlassButton } from '@/components/ui/glass-button';
import { cn } from '@/lib/utils';

export function NavigationBackButton({
  fallback = '/',
  label = 'Voltar',
  className,
}: {
  fallback?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <GlassButton
      type="button"
      surface="lens"
      shape="capsule"
      // iOS tucks the chevron tight against the label and lets the capsule's
      // left padding carry the gap, rather than spacing them evenly.
      className={cn('pl-3', className)}
      aria-label={label}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      <ChevronLeftSymbol />
      {label}
    </GlassButton>
  );
}
