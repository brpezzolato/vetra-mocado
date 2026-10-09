import '@/app/bar-loaders.css';
import { cn } from '@/lib/utils';

/** As barras do logo de vidro. `rise`: o carregamento do app; `still`: o
 * logo parado (a saída do carregamento). */
export function BarMark({
  variant = 'still',
  size = 112,
  className,
}: {
  variant?: 'rise' | 'still';
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-v={variant}
      className={cn('bl', className)}
      style={{ fontSize: size / 48 }}
    >
      <span className="bl-bar" />
      <span className="bl-bar" />
      <span className="bl-bar bl-solid" />
    </span>
  );
}
