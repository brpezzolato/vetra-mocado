'use client';

import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Liquid Glass controls (back, close, floating actions, menu triggers);
 * material in app/glass.css. A separate component on purpose so each use is
 * a decision: backdrop blur is expensive on iOS.
 */
const glassButton = cva(
  'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap outline-none select-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      /**
       * `onGlass` skips backdrop-filter when the control sits on a pane that
       * already blurred the pixels behind it.
       */
      surface: {
        glass: 'vetra-glass',
        // Backdrop blur; only worth it over real content (scrolling page, floating bar).
        lens: 'vetra-glass vetra-glass-lens',
        onGlass: 'vetra-glass-on-glass',
      },
      shape: {
        // 44px: Apple's touch target.
        circle: 'size-11 rounded-full',
        // One line of text with iOS-like padding.
        capsule: 'h-11 gap-1.5 rounded-full px-4 text-[0.9375rem]',
        // For a cluster of controls sharing one pane of glass.
        bar: 'vetra-glass-bar h-11 gap-1 px-1.5',
      },
      tone: {
        default: '',
        // Tinted glass, for the action a modal is asking you to commit to.
        primary: 'vetra-glass-primary',
        destructive: 'vetra-glass-destructive',
      },
    },
    defaultVariants: { surface: 'glass', shape: 'circle', tone: 'default' },
  },
);

export function GlassButton({
  className,
  surface,
  shape,
  tone,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof glassButton>) {
  return (
    <ButtonPrimitive
      data-slot="glass-button"
      className={cn(glassButton({ surface, shape, tone, className }))}
      {...props}
    />
  );
}

/** Matches SF Symbols geometry: 17px optical size, round caps/joins, ~2.2 stroke. */
const symbol = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** `chevron.left`. iOS uses a chevron to go back, never an arrow. */
export function ChevronLeftSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-[1.0625rem]', className)}
      aria-hidden="true"
      {...symbol}
    >
      <path d="M15 4.5 7.5 12l7.5 7.5" />
    </svg>
  );
}

/** `chevron.right`. */
export function ChevronRightSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-[1.0625rem]', className)}
      aria-hidden="true"
      {...symbol}
    >
      <path d="M9 4.5 16.5 12 9 19.5" />
    </svg>
  );
}

/** `arrow.right`: leaving for somewhere else (a chevron means "more"). */
export function ArrowRightSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-[1.0625rem]', className)}
      aria-hidden="true"
      {...symbol}
    >
      <path d="M4 12h15.5M13 5.5l6.5 6.5-6.5 6.5" />
    </svg>
  );
}

/** `xmark`. */
export function CloseSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-[1.0625rem]', className)}
      aria-hidden="true"
      {...symbol}
    >
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

/** `checkmark`. */
export function CheckSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-[1.0625rem]', className)}
      aria-hidden="true"
      {...symbol}
    >
      <path d="M4.5 12.75 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

/** `ellipsis`. Dots, not strokes, so the caps rule does not apply. */
export function EllipsisSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-[1.0625rem]', className)}
      aria-hidden="true"
      fill="currentColor"
    >
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}
