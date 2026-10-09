'use client';

import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';

import { cn } from '@/lib/utils';

/**
 * `orientation`: vertical (padrão), `horizontal` (chips, carrosséis) ou `both`.
 * `viewportRef`: quem rola é o viewport interno; `scrollTo`/`scrollTop`
 * precisam dele.
 */
function ScrollArea({
  className,
  children,
  orientation = 'vertical',
  viewportRef,
  viewportClassName,
  hideScrollbar = false,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  orientation?: 'vertical' | 'horizontal' | 'both';
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportClassName?: string;
  /** Sem barra nem durante a rolagem (fileiras curtas). */
  hideScrollbar?: boolean;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          'size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1',
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {!hideScrollbar && orientation !== 'horizontal' && <ScrollBar />}
      {!hideScrollbar && orientation !== 'vertical' && (
        <ScrollBar orientation="horizontal" />
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent flex touch-none p-px select-none',
        // Invisível parada; aparece só rolando ou com o ponteiro em cima.
        'opacity-0 transition-opacity duration-200 data-hovering:opacity-100 data-scrolling:opacity-100',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="rounded-full relative flex-1 bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
