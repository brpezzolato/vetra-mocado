'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeftSymbol, GlassButton } from '@/components/ui/glass-button';
import { cn } from '@/lib/utils';

export function NavigationBackButton({
  fallback = '/',
  label = 'Voltar',
  className,
  onBack,
}: {
  fallback?: string;
  label?: string;
  className?: string;
  /** Volta dentro da própria tela (ex.: do cartão aberto à lista). */
  onBack?: () => void;
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
        if (onBack) onBack();
        else if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      <ChevronLeftSymbol />
      {label}
    </GlassButton>
  );
}
