'use client';

import {
  ChevronLeftSymbol,
  ChevronRightSymbol,
} from '@/components/ui/glass-button';
import { HOME_LAYOUTS, setHomeLayout } from '@/lib/home-layout';
import { cn } from '@/lib/utils';

/** Troca o arranjo da home durante o teste. Fica flutuando embaixo. */
export function HomeLayoutSwitcher({
  layout,
  raised = false,
}: {
  layout: number;
  /** Acima da barra de abas do arranjo 6 no celular. */
  raised?: boolean;
}) {
  const total = HOME_LAYOUTS.length;
  const go = (step: number) => setHomeLayout((layout + step + total) % total);
  return (
    <div
      className={cn(
        'vetra-home-switcher fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card/95 p-1 shadow-lg backdrop-blur',
        raised && 'vetra-home-switcher-raised',
      )}
    >
      <button
        type="button"
        aria-label="Home anterior"
        onClick={() => go(-1)}
        className="vetra-glass grid size-10 place-items-center"
      >
        <ChevronLeftSymbol className="size-4" />
      </button>
      <p
        aria-live="polite"
        className="min-w-0 px-2 text-center text-xs leading-tight"
      >
        <span className="block font-semibold tabular-nums">
          Home {layout} de {total - 1}
        </span>
        <span className="block max-w-[11rem] truncate text-muted-foreground">
          {HOME_LAYOUTS[layout]}
        </span>
      </p>
      <button
        type="button"
        aria-label="Próxima home"
        onClick={() => go(1)}
        className="vetra-glass grid size-10 place-items-center"
      >
        <ChevronRightSymbol className="size-4" />
      </button>
    </div>
  );
}
