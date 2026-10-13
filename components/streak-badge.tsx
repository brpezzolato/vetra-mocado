import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

/* Dias no azul desde o começo (`daysInTheBlue`, lib/daily-allowance.ts), na
   home e no resumo diário. Não é sequência: um dia acima do valor só não
   soma. Cor por faixa de dias; borda tracejada quando provisório. Sem
   `tabular-nums`: não é dinheiro. */

/** A cor de cada faixa de dias, da mais fria à mais quente. */
const TIERS = [
  {
    from: 30,
    tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    border: 'border-sky-500/45',
    text: 'text-sky-600 dark:text-sky-400',
  },
  {
    from: 14,
    tone: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    border: 'border-violet-500/45',
    text: 'text-violet-600 dark:text-violet-400',
  },
  {
    from: 7,
    tone: 'bg-red-500/15 text-red-700 dark:text-red-300',
    border: 'border-red-500/45',
    text: 'text-red-600 dark:text-red-400',
  },
  {
    from: 3,
    tone: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    border: 'border-orange-500/45',
    text: 'text-orange-600 dark:text-orange-400',
  },
  // Amarelo forte no começo: âmbar sumia no escuro.
  {
    from: 1,
    tone: 'bg-yellow-400/15 text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-400/50',
    text: 'text-yellow-600 dark:text-yellow-400',
  },
] as const;

export const blueTier = (days: number) =>
  TIERS.find((tier) => days >= tier.from) ?? TIERS.at(-1)!;

const daysText = (total: number) => (total === 1 ? '1 dia' : `${total} dias`);

const describe = (total: number, provisional: boolean) =>
  `${daysText(total)} no azul desde o começo${provisional ? ' · provisório: compras no cartão levam até 3 dias úteis para chegar' : ''}`;

/** Contador da home: chama, o total e "dias no azul" embaixo. */
export function BlueDaysCounter({
  total,
  provisional,
}: {
  total: number;
  provisional: boolean;
}) {
  const tier = blueTier(total);
  return (
    <span
      title={describe(total, provisional)}
      className="inline-flex shrink-0 flex-col items-end gap-0.5"
    >
      <span className="inline-flex items-center gap-1 text-sm font-semibold">
        <Flame
          aria-hidden="true"
          // Sólida, preenchida na cor da faixa.
          className={cn('size-3.5 fill-current', tier.text)}
          strokeWidth={2.25}
        />
        {total}
      </span>
      <span aria-hidden="true" className="text-[11px] text-muted-foreground">
        {total === 1 ? 'dia no azul' : 'dias no azul'}
      </span>
      <span className="sr-only">
        {`${daysText(total)} no azul desde o começo${provisional ? ', provisório' : ''}`}
      </span>
    </span>
  );
}

/** Pílula do resumo diário: "12 dias no azul". */
export function BlueDaysBadge({
  total,
  provisional,
}: {
  total: number;
  provisional: boolean;
}) {
  const tier = blueTier(total);
  return (
    <span
      title={describe(total, provisional)}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold',
        tier.tone,
        provisional && ['border border-dashed', tier.border],
      )}
    >
      <Flame aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
      {`${daysText(total)} no azul`}
      {provisional && <span className="sr-only">, provisório</span>}
    </span>
  );
}
