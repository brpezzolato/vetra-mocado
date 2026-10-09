import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Mascote do Vetra AI: o porquinho 3D do Fluent Emoji (MIT; ver
 * public/logos/SOURCES.md). Imagem estática; o movimento é CSS
 * (`.vetra-mascot`). `size-6` por padrão; mude via `className`.
 */
export function VetraMascot({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'vetra-mascot relative inline-block size-6 shrink-0',
        className,
      )}
      {...props}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 5 KB, já no
          tamanho certo; o otimizador de imagem não ganharia nada aqui. */}
      <img
        src="/logos/vetra-ai-pig.webp"
        alt=""
        width={128}
        height={128}
        draggable={false}
        className="vetra-mascot-art size-full object-contain"
      />
    </span>
  );
}
