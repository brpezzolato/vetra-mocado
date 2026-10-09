import { Flame, Shield, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/* Selo da sequência no azul (`allowanceStreak`), na home e no resumo diário.
   Cor por faixa de dias; borda tracejada quando provisória; estrela no recorde;
   escudos para as recuperações restantes da semana. Sem `tabular-nums`: não é
   dinheiro. */

/** A cor de cada faixa de dias, da mais fria à mais quente. */
const TIERS = [
  {
    from: 30,
    tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    border: 'border-sky-500/45',
    text: 'text-sky-600 dark:text-sky-400',
    fill: 'bg-sky-500',
  },
  {
    from: 14,
    tone: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    border: 'border-violet-500/45',
    text: 'text-violet-600 dark:text-violet-400',
    fill: 'bg-violet-500',
  },
  {
    from: 7,
    tone: 'bg-red-500/15 text-red-700 dark:text-red-300',
    border: 'border-red-500/45',
    text: 'text-red-600 dark:text-red-400',
    fill: 'bg-red-500',
  },
  {
    from: 3,
    tone: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    border: 'border-orange-500/45',
    text: 'text-orange-600 dark:text-orange-400',
    fill: 'bg-orange-500',
  },
  // Amarelo forte no começo: âmbar sumia no escuro.
  {
    from: 1,
    tone: 'bg-yellow-400/15 text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-400/50',
    text: 'text-yellow-600 dark:text-yellow-400',
    fill: 'bg-yellow-400',
  },
] as const;

export const streakTier = (days: number) =>
  TIERS.find((tier) => days >= tier.from) ?? TIERS.at(-1)!;

const describe = ({
  current,
  best,
  provisional,
  savesLeft,
}: {
  current: number;
  best: number;
  provisional: boolean;
  savesLeft?: number;
}) =>
  `${current === 1 ? '1 dia' : `${current} dias`} seguidos no azul · recorde ${best}${savesLeft === undefined ? '' : ` · ${savesLeft === 1 ? '1 recuperação' : `${savesLeft} recuperações`} nesta semana`}${provisional ? ' · provisória: compras no cartão levam até 3 dias úteis para chegar' : ''}`;

/**
 * Selo do card da home: chama e número, recorde em cinza ("4 / 7") e uma
 * barrinha até ele. Sempre na cor cheia (esmaecer o provisório deixava
 * marrom). Detalhes no title.
 */
export function StreakRecord({
  current,
  best,
  provisional,
  savesLeft,
}: {
  current: number;
  best: number;
  provisional: boolean;
  savesLeft?: number;
}) {
  const tier = streakTier(current);
  const progress = best > 0 ? Math.min(current / best, 1) : 1;
  return (
    <span
      title={describe({ current, best, provisional, savesLeft })}
      className="inline-flex shrink-0 flex-col items-end gap-1"
    >
      <span className="inline-flex items-center gap-1 text-sm font-semibold">
        <Flame
          aria-hidden="true"
          // Sólida, preenchida na cor da faixa.
          className={cn('size-3.5 fill-current', tier.text)}
          strokeWidth={2.25}
        />
        {current}
        <span className="font-normal text-muted-foreground">/ {best}</span>
      </span>
      <span
        aria-hidden="true"
        className="h-1 w-12 overflow-hidden rounded-full bg-foreground/10"
      >
        <span
          className={cn('block h-full rounded-full', tier.fill)}
          style={{ width: `${progress * 100}%` }}
        />
      </span>
      <span className="sr-only">
        {`, ${current === 1 ? 'dia' : 'dias'} seguidos no azul, recorde ${best}`}
        {savesLeft === undefined
          ? ''
          : `, ${savesLeft === 1 ? '1 recuperação' : `${savesLeft} recuperações`} nesta semana`}
        {provisional ? ', provisória' : ''}
      </span>
    </span>
  );
}

export function StreakBadge({
  current,
  best,
  provisional,
  savesLeft,
  withLabel = false,
}: {
  current: number;
  best: number;
  provisional: boolean;
  /** Recuperações que restam nesta semana. */
  savesLeft?: number;
  /** "3 dias no azul" por extenso, em vez de só o número. */
  withLabel?: boolean;
}) {
  const tier = streakTier(current);
  const record = current > 1 && current >= best;
  const days = current === 1 ? '1 dia' : `${current} dias`;
  return (
    <span
      title={describe({ current, best, provisional, savesLeft })}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold',
        tier.tone,
        provisional && ['border border-dashed', tier.border],
      )}
    >
      <Flame aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
      {withLabel ? `${days} no azul` : current}
      {savesLeft !== undefined && savesLeft > 0 && (
        <span aria-hidden="true" className="ml-0.5 flex items-center gap-px">
          {Array.from({ length: savesLeft }, (_, index) => (
            <Shield key={index} className="size-2.5 fill-current opacity-60" />
          ))}
        </span>
      )}
      {record && (
        <Star
          aria-hidden="true"
          className="size-3 fill-current"
          strokeWidth={2.25}
        />
      )}
      <span className="sr-only">
        {withLabel ? '' : ` ${current === 1 ? 'dia' : 'dias'} seguidos no azul`}
        {record ? ', seu recorde' : ''}
        {savesLeft === undefined
          ? ''
          : `, ${savesLeft === 1 ? '1 recuperação' : `${savesLeft} recuperações`} nesta semana`}
        {provisional ? ', provisória' : ''}
      </span>
    </span>
  );
}
