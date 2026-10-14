'use client';

import { startTransition, useLayoutEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

/* Seletor em pílula com ícones, na mecânica da pílula da home: espaços
   iguais, a pílula branca desliza só por transform (sem animar largura) e
   segue o dedo quando arrastada; ao soltar, encaixa no ícone mais perto.
   Os ícones escuros vivem dentro da pílula e andam ao contrário, então só o
   que está sob ela aparece destacado. */

export type PillOption<T extends string> = {
  value: T;
  label: string;
  icon: LucideIcon;
  /** Selo de contagem no ícone (0 some). */
  count?: number;
};

const SLIDE = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';

export function PillSwitch<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Nome do grupo para leitor de tela. */
  label: string;
}) {
  const count = options.length;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const pillRef = useRef<HTMLSpanElement>(null);
  const liftRef = useRef<HTMLSpanElement>(null);
  const iconsRef = useRef<HTMLSpanElement>(null);
  const position = useRef(index);
  const placed = useRef(false);
  const frame = useRef(0);
  const dragged = useRef(false);
  // Escolha feita, ainda não refletida em `value`: a pílula não volta.
  const pending = useRef<number | null>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    from: number;
    slot: number;
    position: number;
    active: boolean;
  } | null>(null);

  /** Põe a pílula (e os ícones de dentro) na posição, em espaços. */
  const place = (to: number, animate: boolean) => {
    position.current = to;
    const pill = pillRef.current;
    const icons = iconsRef.current;
    if (!pill || !icons) return;
    pill.style.transition = icons.style.transition = animate ? SLIDE : 'none';
    pill.style.transform = `translate3d(${to * 100}%, 0, 0)`;
    icons.style.transform = `translate3d(${(-to * 100) / count}%, 0, 0)`;
  };

  // Segue o valor de fora; na montagem, sem animar.
  useLayoutEffect(() => {
    if (drag.current?.active) return;
    if (pending.current !== null) {
      if (pending.current !== index) return;
      pending.current = null;
    }
    place(index, placed.current);
    placed.current = true;
  });

  // Segurar: só o fundo cresce (mola curta), os ícones não.
  const lift = (up: boolean) => {
    const pill = liftRef.current;
    if (!pill) return;
    pill.style.transition = up
      ? 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)'
      : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';
    pill.style.transform = up ? 'scale(1.08)' : 'scale(1)';
  };

  // A pílula anda já; a troca vem depois do primeiro quadro, como
  // transição: a lista que se refaz não segura a animação (antes, ~700 ms).
  const choose = (to: number) => {
    place(to, true);
    const next = options[to];
    if (!next || next.value === value) return;
    pending.current = to;
    requestAnimationFrame(() =>
      window.setTimeout(() => startTransition(() => onChange(next.value))),
    );
  };

  return (
    <fieldset
      className="relative m-0 grid min-w-0 touch-pan-y rounded-full border-0 bg-muted/70 p-1 select-none"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        dragged.current = false;
        const box = pillRef.current?.getBoundingClientRect();
        if (
          box &&
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom
        )
          lift(true);
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          from: position.current,
          slot: (event.currentTarget.clientWidth - 8) / count,
          position: position.current,
          active: false,
        };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state || state.id !== event.pointerId) return;
        const dx = event.clientX - state.x;
        if (!state.active) {
          if (Math.abs(dx) < 6 && Math.abs(event.clientY - state.y) < 6) return;
          // Gesto vertical é rolagem da página.
          if (Math.abs(event.clientY - state.y) > Math.abs(dx)) {
            drag.current = null;
            lift(false);
            return;
          }
          state.active = true;
          dragged.current = true;
          lift(true);
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Sem captura, o arrasto segue enquanto o dedo está no trilho.
          }
        }
        state.position = Math.min(
          count - 1,
          Math.max(0, state.from + dx / state.slot),
        );
        // Um passo por quadro, por transform.
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() =>
          place(state.position, false),
        );
      }}
      onPointerUp={(event) => {
        const state = drag.current;
        drag.current = null;
        lift(false);
        if (!state?.active || state.id !== event.pointerId) return;
        cancelAnimationFrame(frame.current);
        choose(Math.round(state.position));
      }}
      onPointerCancel={() => {
        const state = drag.current;
        drag.current = null;
        lift(false);
        if (state?.active) place(index, true);
      }}
      onClickCapture={(event) => {
        // O arrasto termina num "clique": não troca de novo.
        if (!dragged.current) return;
        dragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option, slot) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={slot === index}
            aria-label={
              option.count ? `${option.label}, ${option.count}` : option.label
            }
            title={option.label}
            onClick={() => choose(slot)}
            className="relative grid h-9 min-w-0 place-items-center rounded-full text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2"
          >
            <span className="relative">
              <Icon className="size-4" aria-hidden="true" />
              {!!option.count && (
                <span
                  aria-hidden="true"
                  className="absolute -top-2 left-2.5 min-w-4 rounded-full bg-foreground/15 px-1 text-center text-[10px] leading-4 tabular-nums text-foreground"
                >
                  {option.count > 99 ? '99+' : option.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
      {/* A pílula: um espaço do trilho, com os ícones escuros por dentro. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-1">
        <span
          ref={pillRef}
          className="absolute inset-y-0 left-0 z-10 will-change-transform"
          style={{ width: `${100 / count}%` }}
        >
          <span
            ref={liftRef}
            className="absolute inset-0 rounded-full bg-foreground shadow-sm will-change-transform"
          />
          <span className="absolute inset-0 overflow-hidden rounded-full">
            <span
              ref={iconsRef}
              className="absolute inset-y-0 left-0 grid will-change-transform"
              style={{
                width: `${count * 100}%`,
                gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
              }}
            >
              {options.map((option) => {
                const Icon = option.icon;
                return (
                  <span
                    key={option.value}
                    className="grid place-items-center text-background"
                  >
                    <Icon className="size-4" strokeWidth={2.5} />
                  </span>
                );
              })}
            </span>
          </span>
        </span>
      </span>
    </fieldset>
  );
}
