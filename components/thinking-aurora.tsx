import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** O que o Vetra AI mostra enquanto pensa: uma aurora colorida em CSS
 * (`.vetra-ai-aurora` em app/globals.css). O desfoque mede a partir de `--s`
 * (2rem, o `size-8` do chat); outro tamanho passa `--s` pelo `style`. */
export function ThinkingAurora({
  className,
  ...props
}: ComponentProps<'span'>) {
  return (
    <span
      className={cn('vetra-ai-aurora', className)}
      aria-hidden="true"
      {...props}
    >
      <span className="vetra-ai-aurora-blob" />
    </span>
  );
}
