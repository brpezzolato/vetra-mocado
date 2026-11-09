'use client';

import { useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from '@/components/navigation-link';
import { TAB_SECTIONS, isActiveSection } from '@/lib/app-sections';
import { cn } from '@/lib/utils';

/* Barra de abas do celular, presa na borda de baixo, em todas as telas do
   app. Some no computador (lá a navegação é a barra do topo), nas páginas
   públicas e no Vetra AI, onde o campo da conversa ocupa a borda de baixo. O
   porquinho do Vetra AI (vetra-ai-bubble.tsx) não desce abaixo dela.

   A pílula atrás da aba ativa desliza no toque e também se arrasta, como a
   das abas da home: segue o dedo e, ao soltar, vai com mola para a aba mais
   perto (contando o embalo) e abre a tela dela. Só transform, uma vez por
   quadro; o React só sabe da aba sob o dedo quando ela muda. */

const HIDDEN = ['/auth', '/offline', '/desbloquear', '/assistente'];
const LAST = TAB_SECTIONS.length - 1;
const SPRING = 'transform 420ms cubic-bezier(0.34, 1.3, 0.64, 1)';

type Drag = {
  id: number;
  x: number;
  y: number;
  from: number;
  slot: number;
  position: number;
  lastX: number;
  lastAt: number;
  /** Abas por milissegundo, suavizada. */
  velocity: number;
  active: boolean;
};

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function BottomTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  // Toque ou arrasto: a pílula fica na aba escolhida sem esperar a tela.
  const [tapped, setTapped] = useState<string | null>(null);
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setTapped(null);
  }
  // A aba sob o dedo durante o arrasto (ícone e nome destacados).
  const [hover, setHover] = useState<number | null>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const liftRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);
  const frame = useRef(0);

  if (HIDDEN.some((path) => isActiveSection(pathname, path))) return null;
  const index = TAB_SECTIONS.findIndex((item) =>
    tapped ? item.href === tapped : isActiveSection(pathname, item.href),
  );
  const shown = hover ?? index;

  const movePill = (position: number, animate: boolean) => {
    const pill = pillRef.current;
    if (!pill) return;
    pill.style.transition = animate && !reducedMotion() ? SPRING : 'none';
    pill.style.transform = `translateX(${position * 100}%)`;
  };
  const lift = (raised: boolean) => {
    const pill = liftRef.current;
    if (!pill) return;
    pill.style.transition = reducedMotion()
      ? 'none'
      : raised
        ? 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)'
        : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';
    pill.style.transform = raised ? 'scale(1.12)' : 'scale(1)';
  };

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragged.current = false;
    const box = event.currentTarget.getBoundingClientRect();
    const slot = box.width / TAB_SECTIONS.length;
    // Fora de uma aba (ex.: Configurações), parte de onde o dedo está.
    const from =
      index >= 0
        ? index
        : Math.min(LAST, Math.max(0, (event.clientX - box.left) / slot - 0.5));
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      from,
      slot,
      position: from,
      lastX: event.clientX,
      lastAt: event.timeStamp,
      velocity: 0,
      active: false,
    };
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    if (!state.active) {
      if (Math.abs(dx) < 6 && Math.abs(event.clientY - state.y) < 6) return;
      if (Math.abs(event.clientY - state.y) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      state.active = true;
      dragged.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Sem captura, o arrasto segue enquanto o dedo está na barra.
      }
      lift(true);
    }
    const now = event.timeStamp;
    const step = (event.clientX - state.lastX) / state.slot;
    state.velocity =
      state.velocity * 0.6 + (step / Math.max(1, now - state.lastAt)) * 0.4;
    state.lastX = event.clientX;
    state.lastAt = now;
    const raw = state.from + dx / state.slot;
    // Nas pontas, pesa.
    state.position =
      raw < 0 ? raw * 0.3 : raw > LAST ? LAST + (raw - LAST) * 0.3 : raw;
    const position = state.position;
    window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(() =>
      movePill(position, false),
    );
    const near = Math.min(LAST, Math.max(0, Math.round(position)));
    if (near !== hover) setHover(near);
  };

  const release = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state || state.id !== event.pointerId || !state.active) return;
    window.cancelAnimationFrame(frame.current);
    lift(false);
    // ~150 ms de embalo decidem para onde ela vai.
    const target = Math.min(
      LAST,
      Math.max(0, Math.round(state.position + state.velocity * 150)),
    );
    movePill(target, true);
    setHover(null);
    const href = TAB_SECTIONS[target].href;
    setTapped(href);
    if (!isActiveSection(pathname, href)) router.push(href);
  };

  return (
    <>
      {/* Espaço para o fim da página não ficar escondido atrás da barra. */}
      <div aria-hidden="true" className="vetra-tabbar-space lg:hidden" />
      <nav
        aria-label="Seções"
        className="vetra-tabbar fixed inset-x-0 bottom-0 z-30 rounded-t-[1.75rem] border-t bg-card/95 px-2 pt-2.5 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.35)] backdrop-blur-xl lg:hidden"
      >
        <div
          className="relative grid touch-none grid-cols-5 select-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
          onClickCapture={(event) => {
            // O arrasto termina num "clique": não abre a aba de novo.
            if (!dragged.current) return;
            dragged.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {shown >= 0 && (
            <span
              ref={pillRef}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0 flex h-8 w-1/5 justify-center will-change-transform"
              style={{
                transform: `translateX(${Math.max(index, 0) * 100}%)`,
                transition: SPRING,
              }}
            >
              <span
                ref={liftRef}
                className="h-full w-14 rounded-full bg-foreground/10"
              />
            </span>
          )}
          {TAB_SECTIONS.map((item, position) => {
            const active = position === shown;
            return (
              <Link
                key={item.href}
                href={item.href}
                draggable={false}
                aria-current={
                  isActiveSection(pathname, item.href) ? 'page' : undefined
                }
                onClick={() => {
                  movePill(position, true);
                  setTapped(item.href);
                }}
                className={cn(
                  'relative flex flex-col items-center gap-1 pb-1 text-[10.5px] text-muted-foreground transition-colors duration-200',
                  active && 'font-semibold text-foreground',
                )}
              >
                <span className="grid h-8 place-items-center">
                  <item.icon
                    aria-hidden="true"
                    className={cn(
                      'size-5 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)]',
                      active && 'scale-110',
                    )}
                  />
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
