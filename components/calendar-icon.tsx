'use client';

import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic';

const known = new Set<string>(iconNames);

/**
 * Ícone do lucide-react pelo nome (kebab-case), carregado sob demanda: o
 * calendário deixa escolher qualquer um sem pôr os ~2.000 no pacote.
 * Nome desconhecido vira um círculo.
 */
export function CalendarIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <DynamicIcon
      name={(known.has(name) ? name : 'circle') as IconName}
      className={className}
      aria-hidden="true"
      fallback={() => <span className={className} />}
    />
  );
}

export { iconNames };
