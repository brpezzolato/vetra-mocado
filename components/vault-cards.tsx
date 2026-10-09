'use client';

import { useEffect, useRef } from 'react';
import Link from '@/components/navigation-link';
import Image from 'next/image';
import Decimal from 'decimal.js';
import { ChevronRight } from 'lucide-react';
import type { PiggyBank, DailyRate } from '@/lib/domain';
import { bankPolicy } from '@/lib/domain';
import { calculatePortfolio, staleBankDate, yieldOnly } from '@/lib/portfolio';
import { cn } from '@/lib/utils';

export function VaultCards({
  banks,
  rates,
  activeId,
  onSelect,
  stacked = false,
  list = false,
}: {
  banks: PiggyBank[];
  rates: DailyRate[];
  activeId?: string;
  onSelect?: (id: string) => void;
  /** Um embaixo do outro, sem carrossel. */
  stacked?: boolean;
  /** Aba Cofrinhos da home: total em destaque e uma linha por cofrinho. */
  list?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const centered = useRef(false);
  const portfolio = calculatePortfolio(banks, rates);
  const generalNetGain = portfolio.lifetimeNetGain;
  const formattedMoney = (value: Decimal.Value) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(new Decimal(value).toNumber());
  useEffect(() => {
    const track = ref.current;
    if (!track || stacked || list) return;
    const center = () => {
      if (!window.matchMedia('(max-width: 767px)').matches) return;
      const selected = Array.from(
        track.querySelectorAll<HTMLElement>('[data-vault-id]'),
      ).find((card) => card.dataset.vaultId === activeId);
      if (!selected) return;
      const box = track.getBoundingClientRect();
      const card = selected.getBoundingClientRect();
      track.scrollTo({
        left:
          track.scrollLeft +
          card.left -
          box.left -
          (track.clientWidth - card.width) / 2,
        behavior: centered.current ? 'smooth' : 'instant',
      });
      centered.current = true;
    };
    const frame = requestAnimationFrame(center);
    const observer = new ResizeObserver(center);
    observer.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [activeId, banks.length, stacked, list]);
  // Ganho = só rendimento (`yieldOnly`), nunca negativo; fecha com o card
  // geral (`lifetimeNetGain`).
  const signedGain = (gain: Decimal) => ({
    detail: `${gain.isNegative() ? '−' : '+'}${formattedMoney(gain.abs())}`,
    gainIsNegative: gain.isNegative(),
  });
  const cards = [
    {
      id: 'all',
      name: 'Dinheiro geral',
      bank: 'CARTEIRA',
      image: '/logos/vetra-pig-ui.webp',
      value: portfolio.netBalance,
      stale: staleBankDate(banks),
      ...signedGain(generalNetGain),
      color: 'var(--foreground)',
    },
    // Reusa o replay de `portfolio.results` (na ordem de `banks`).
    ...portfolio.results.map(({ bank, result }) => ({
      id: bank.id,
      name: bank.name,
      bank: bank.bank,
      image:
        bank.bank === 'Nubank'
          ? '/logos/nubank-ui.webp'
          : '/logos/mercado-pago-ui.webp',
      value: result.netBalance,
      stale: staleBankDate([bank]),
      ...signedGain(yieldOnly(result.earnings)),
      color: bankPolicy(bank.bank).color,
    })),
  ];
  if (list) {
    const [total, ...vaults] = cards;
    const stale = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;
    return (
      <div className="min-w-0">
        <Link
          href="/cofrinhos"
          className="flex items-end justify-between gap-3 rounded-2xl transition-colors"
        >
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">
              Guardado nos cofrinhos
            </span>
            <span className="mt-1 block text-3xl font-semibold tracking-tight tabular-nums">
              {formattedMoney(total.value)}
            </span>
            {total.detail && (
              <span
                className={`mt-1 block text-xs font-medium tabular-nums ${total.gainIsNegative ? 'text-destructive' : 'text-emerald-500'}`}
              >
                {total.detail} de rendimento
              </span>
            )}
          </span>
          <span className="mb-1 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            Ver tudo
            <ChevronRight className="size-3.5" />
          </span>
        </Link>
        <ul className="mt-4 divide-y divide-border/70 border-t border-border/70">
          {vaults.map((vault, position) => {
            const bank = portfolio.results[position]?.bank;
            return (
              <li key={vault.id}>
                <Link
                  href={`/cofrinhos/${encodeURIComponent(vault.id)}`}
                  className="flex items-center gap-3 py-3.5 transition-opacity active:opacity-70"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full border bg-background">
                    <Image
                      src={vault.image}
                      alt=""
                      width={22}
                      height={22}
                      unoptimized
                      className="size-5.5 object-contain"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">
                      {vault.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {bank
                        ? `${bank.bank} · ${bank.cdi_percentage}% do CDI`
                        : vault.bank}
                    </span>
                    {/* Saldo só do banco: sem atualização hoje, mostra o último dia informado. */}
                    {vault.stale && (
                      <span className="block truncate text-[11px] text-amber-600 dark:text-amber-400">
                        Saldo de {stale(vault.stale)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[15px] font-semibold tabular-nums">
                      {formattedMoney(vault.value)}
                    </span>
                    {vault.detail && (
                      <span
                        className={`block text-xs font-medium tabular-nums ${vault.gainIsNegative ? 'text-destructive' : 'text-emerald-500'}`}
                      >
                        {vault.detail}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return (
    <nav
      ref={ref}
      aria-label="Selecionar cofrinho"
      className={
        stacked
          ? 'grid w-full min-w-0 gap-2'
          : 'vault-carousel flex w-full min-w-0 snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain py-1 md:grid md:grid-cols-3'
      }
    >
      {cards.map((card) => (
        <Link
          key={card.id}
          href={
            card.id === 'all'
              ? '/cofrinhos'
              : `/cofrinhos/${encodeURIComponent(card.id)}`
          }
          data-vault-id={card.id}
          aria-current={activeId === card.id ? 'page' : undefined}
          onClick={(event) => {
            if (
              !onSelect ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onSelect(card.id);
          }}
          style={{
            borderColor: activeId === card.id ? card.color : undefined,
            boxShadow:
              activeId === card.id
                ? `inset 0 0 0 1px ${card.color}`
                : undefined,
          }}
          className={cn(
            'grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-[border-color,box-shadow,background-color,transform] duration-300 ease-out hover:bg-muted/40 active:scale-[0.985] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-foreground motion-reduce:transition-none md:w-full',
            !stacked && 'flex-[0_0_68%] snap-center',
          )}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
            <Image
              src={card.image}
              alt=""
              width={28}
              height={28}
              unoptimized
              loading="eager"
              className={`size-7 object-contain ${card.id === 'all' ? 'invert dark:invert-0' : ''}`}
            />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[10px] uppercase text-muted-foreground">
              {card.bank}
            </span>
            <span className="block truncate text-sm font-semibold">
              {card.name}
            </span>
            <span className="block truncate text-xs tabular-nums text-muted-foreground">
              {formattedMoney(card.value)}
            </span>
            {/* Saldo só do banco: sem atualização hoje, mostra o último dia informado. */}
            {card.stale && (
              <span className="block truncate text-[11px] text-amber-600 dark:text-amber-400">
                Desatualizado · saldo de {card.stale.slice(8)}/
                {card.stale.slice(5, 7)}
              </span>
            )}
            {card.detail && (
              <span
                className={`mt-0.5 block truncate text-[11px] font-medium tabular-nums ${card.gainIsNegative ? 'text-destructive' : 'text-emerald-500'}`}
              >
                {card.detail}
              </span>
            )}
          </span>
          <ChevronRight className="size-4" />
        </Link>
      ))}
    </nav>
  );
}
