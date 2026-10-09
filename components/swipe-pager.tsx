'use client';

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/* Páginas lado a lado que seguem o dedo. Ao soltar, encaixa com
   desaceleração; arrasto rápido ou além de 1/5 da largura troca de página.
   Toque numa aba distante passa por cada aba do caminho.
   Durante o deslize só muda `transform`:
   - `onChange` só no fim da animação (re-render no meio travava);
   - a altura acompanha cada página e anima junto (`contain: layout`);
   - movimento aplicado uma vez por quadro (rAF);
   - recorte reto (`overflow: clip`).
   `touch-action: pan-y`: rolagem vertical é do navegador. */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Uma aba de distância; cada aba a mais no caminho soma `STEP_MS`. */
const BASE_MS = 360;
const STEP_MS = 160;

export function SwipePager({
  index,
  onChange,
  pages,
  onPlace,
  className,
}: {
  index: number;
  onChange: (index: number) => void;
  pages: ReactNode[];
  /**
   * Posição da fileira em páginas (fracionária) e a transição CSS, para quem
   * anda junto (a lingueta).
   */
  onPlace?: (position: number, transition: string) => void;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Animando um encaixe: a altura é da animação, não do observador.
  const moving = useRef(false);
  // Página na tela (pode estar à frente do `index` durante a animação).
  const shown = useRef(index);
  const settleTimer = useRef(0);
  const frame = useRef(0);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    at: number;
    dx: number;
    width: number;
    axis: 'x' | 'y' | null;
  } | null>(null);
  // Depois de um arrasto de lado, o toque não vira clique num item.
  const dragged = useRef(false);
  const count = pages.length;

  const width = () => viewportRef.current?.clientWidth || 1;

  const heightOf = (page: number) => pageRefs.current[page]?.offsetHeight ?? 0;

  /** Põe a fileira em `page` deslocada `dx` px; a altura interpola com a vizinha. */
  const place = (page: number, dx: number, duration: number) => {
    const track = trackRef.current;
    const viewport = viewportRef.current;
    const timing = duration ? `${duration}ms ${EASE}` : '';
    if (track) {
      track.style.transition = timing ? `transform ${timing}` : 'none';
      track.style.transform = `translate3d(${-page * width() + dx}px, 0, 0)`;
    }
    if (viewport) {
      const neighbour = Math.min(
        count - 1,
        Math.max(0, page + (dx < 0 ? 1 : -1)),
      );
      const progress = Math.min(1, Math.abs(dx) / width());
      const from = heightOf(page);
      const height = from + (heightOf(neighbour) - from) * progress;
      viewport.style.transition = timing ? `height ${timing}` : 'none';
      viewport.style.height = `${Math.round(height)}px`;
    }
    onPlace?.(page - dx / width(), timing);
  };

  /** Desliza até `page`, passando pelas do caminho; no fim, avisa o React. */
  const settle = (page: number, notify: boolean) => {
    window.clearTimeout(settleTimer.current);
    const distance = Math.max(1, Math.abs(page - shown.current));
    const duration = BASE_MS + (distance - 1) * STEP_MS;
    place(page, 0, duration);
    shown.current = page;
    moving.current = true;
    settleTimer.current = window.setTimeout(() => {
      moving.current = false;
      if (notify) onChange(page);
    }, duration);
  };

  // A aba mudou por toque (o React mudou primeiro): desliza até ela.
  const followIndex = useEffectEvent((next: number) => {
    if (next !== shown.current) settle(next, false);
  });
  useLayoutEffect(() => followIndex(index), [index]);

  // Primeira posição, e de novo se a largura mudar (girar o celular).
  const placeShown = useEffectEvent(() => place(shown.current, 0, 0));
  const fitShown = useEffectEvent(() => {
    const viewport = viewportRef.current;
    if (!viewport || drag.current || moving.current) return;
    viewport.style.transition = 'none';
    viewport.style.height = `${heightOf(shown.current)}px`;
  });
  useLayoutEffect(() => {
    placeShown();
    const viewport = viewportRef.current;
    if (!viewport) return;
    let last = viewport.clientWidth;
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth === last) return;
      last = viewport.clientWidth;
      placeShown();
    });
    observer.observe(viewport);
    // A página atual mudou de altura: acompanha sem animar.
    const pagesObserver = new ResizeObserver(() => fitShown());
    pageRefs.current.forEach((page) => page && pagesObserver.observe(page));
    return () => {
      observer.disconnect();
      pagesObserver.disconnect();
    };
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current);
      window.cancelAnimationFrame(frame.current);
    },
    [],
  );

  const release = () => {
    const state = drag.current;
    drag.current = null;
    window.cancelAnimationFrame(frame.current);
    if (!state || state.axis !== 'x') return;
    const speed = state.dx / Math.max(1, performance.now() - state.at);
    const far =
      Math.abs(state.dx) > state.width * 0.2 || Math.abs(speed) > 0.45;
    const from = shown.current;
    const next = far
      ? Math.min(count - 1, Math.max(0, from + (state.dx < 0 ? 1 : -1)))
      : from;
    settle(next, next !== index);
  };

  return (
    <div
      ref={viewportRef}
      className={cn('touch-pan-y overflow-clip', className)}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        dragged.current = false;
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          at: performance.now(),
          dx: 0,
          width: width(),
          axis: null,
        };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state || state.id !== event.pointerId) return;
        const dx = event.clientX - state.x;
        const dy = event.clientY - state.y;
        if (!state.axis) {
          // Decide a direção no primeiro movimento real; vertical não é nosso.
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (Math.abs(dy) >= Math.abs(dx)) {
            drag.current = null;
            return;
          }
          state.axis = 'x';
          // Recomeça a contar daqui, para a velocidade ser a do arrasto.
          state.at = performance.now();
          window.clearTimeout(settleTimer.current);
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Sem captura, o arrasto segue enquanto o dedo está aqui dentro.
          }
        }
        dragged.current = true;
        const page = shown.current;
        const edge = (page === 0 && dx > 0) || (page === count - 1 && dx < 0);
        state.dx = edge ? dx * 0.3 : dx;
        // Uma vez por quadro, por mais eventos que o dedo mande.
        window.cancelAnimationFrame(frame.current);
        frame.current = window.requestAnimationFrame(() => {
          if (drag.current === state) place(page, state.dx, 0);
        });
      }}
      onPointerUp={release}
      onPointerCancel={() => {
        drag.current = null;
        window.cancelAnimationFrame(frame.current);
        settle(shown.current, shown.current !== index);
      }}
      onClickCapture={(event) => {
        if (!dragged.current) return;
        dragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        ref={trackRef}
        className="flex items-start [backface-visibility:hidden] will-change-transform"
      >
        {pages.map((page, position) => (
          <div
            key={position}
            ref={(node) => {
              pageRefs.current[position] = node;
            }}
            aria-hidden={position !== index}
            inert={position !== index}
            className="w-full min-w-0 shrink-0 [contain:layout]"
          >
            {page}
          </div>
        ))}
      </div>
    </div>
  );
}
