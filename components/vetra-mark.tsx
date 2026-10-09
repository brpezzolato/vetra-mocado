import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Símbolo do Vetra: três barras crescentes, duas de vidro fosco e a última
 * sólida (prints da prévia; ver public/logos/SOURCES.md). `sm` para a barra
 * do topo, `md` para o ícone; branca no escuro, invertida no claro.
 * `inverted` troca as duas.
 */
export function VetraMark({
  className,
  size = 'sm',
  inverted = false,
}: {
  className?: string;
  size?: 'sm' | 'md';
  inverted?: boolean;
}) {
  const white = `/logos/vetra-mark-${size}-dark.png`;
  const black = `/logos/vetra-mark-${size}-light.png`;
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-block size-6 shrink-0', className)}
    >
      <Image
        src={inverted ? black : white}
        alt=""
        fill
        unoptimized
        className="hidden object-contain dark:block"
      />
      <Image
        src={inverted ? white : black}
        alt=""
        fill
        unoptimized
        className="object-contain dark:hidden"
      />
    </span>
  );
}
