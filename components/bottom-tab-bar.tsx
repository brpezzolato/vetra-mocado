'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
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
   quadro; o React só sabe da aba sob o dedo quando ela muda. Sem
   backdrop-filter na barra: o desfoque refeito a cada quadro travava o
   arrasto no iPhone.

   Arrastar o dedo de lado na tela também troca de aba, na ordem da barra
   (Início → Gastos → Faturas → …): a tela segue o dedo e, solta além de
   ~28% da largura ou com embalo, sai de lado e a aba vizinha abre. Não
   disputa com quem já arrasta de lado: campos, sliders, pílulas
   (`data-no-page-swipe`), listas que rolam de lado e diálogos abertos ficam
   com o gesto; o carrossel da home (`data-swipe-pager`) só passa o arrasto
   adiante quando está na primeira ou na última página. As bordas da tela
   (24 px) ficam para o voltar do iPhone. */

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

const SWIPE_SKIP =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-page-swipe], .vetra-tabbar, .vetra-ai-bubble, dialog, [role="dialog"]';

/** Algo sob o dedo já usa o arrasto de lado nessa direção? */
function claimsSwipe(target: Element, dx: number) {
  for (
    let node: Element | null = target;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (node.matches(SWIPE_SKIP)) return true;
    const pager = node.getAttribute('data-swipe-pager');
    if (pager) {
      const page = Number((node as HTMLElement).dataset.page ?? 0);
      const outward =
        (page === 0 && dx > 0) || (page === Number(pager) - 1 && dx < 0);
      if (!outward) return true;
      continue;
    }
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

type Swipe = {
  x: number;
  y: number;
  target: Element;
  page: HTMLElement | null;
  dx: number;
  lastX: number;
  lastAt: number;
  /** px por ms, suavizada. */
  velocity: number;
};

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

  // Deslize entre telas: troca de aba com a pílula indo junto.
  const swipeTo = useEffectEvent((target: number) => {
    const href = TAB_SECTIONS[target].href;
    const pill = pillRef.current;
    if (pill) {
      pill.style.transition = reducedMotion() ? 'none' : SPRING;
      pill.style.transform = `translate3d(${target * 100}%, 0, 0)`;
    }
    setTapped(href);
    window.setTimeout(() => router.push(href), 160);
  });
  useEffect(() => {
    const at = TAB_SECTIONS.findIndex((item) =>
      isActiveSection(pathname, item.href),
    );
    if (at < 0) return;
    const wide = window.matchMedia('(min-width: 64rem)');
    let swipe: Swipe | null = null;
    let raf = 0;
    let gone: HTMLElement | null = null;
    let restore = 0;
    const clear = (page: HTMLElement) => {
      page.style.transition = '';
      page.style.transform = '';
      page.style.opacity = '';
    };
    const start = (event: TouchEvent) => {
      swipe = null;
      if (event.touches.length !== 1 || wide.matches) return;
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      const touch = event.touches[0];
      if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return;
      swipe = {
        x: touch.clientX,
        y: touch.clientY,
        target: event.target as Element,
        page: null,
        dx: 0,
        lastX: touch.clientX,
        lastAt: event.timeStamp,
        velocity: 0,
      };
    };
    const move = (event: TouchEvent) => {
      const state = swipe;
      if (!state) return;
      if (event.touches.length !== 1) {
        swipe = null;
        if (state.page) clear(state.page);
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - state.x;
      const dy = touch.clientY - state.y;
      if (!state.page) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // Rolagem é vertical; só um arrasto claramente de lado é nosso.
        if (
          Math.abs(dy) * 1.2 >= Math.abs(dx) ||
          claimsSwipe(state.target, dx)
        ) {
          swipe = null;
          return;
        }
        state.page = state.target.closest('main');
        if (!state.page) {
          swipe = null;
          return;
        }
      }
      const step = touch.clientX - state.lastX;
      state.velocity =
        state.velocity * 0.6 +
        (step / Math.max(1, event.timeStamp - state.lastAt)) * 0.4;
      state.lastX = touch.clientX;
      state.lastAt = event.timeStamp;
      // Sem aba para aquele lado, pesa.
      const edge = (at === 0 && dx > 0) || (at === LAST && dx < 0);
      state.dx = edge ? dx * 0.25 : dx;
      if (reducedMotion()) return;
      const page = state.page;
      const offset = state.dx;
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        page.style.transition = 'none';
        page.style.transform = `translate3d(${offset}px, 0, 0)`;
      });
    };
    const end = () => {
      const state = swipe;
      swipe = null;
      if (!state?.page) return;
      window.cancelAnimationFrame(raf);
      const page = state.page;
      const width = window.innerWidth;
      const target = at + (state.dx < 0 ? 1 : -1);
      const far =
        Math.abs(state.dx) > width * 0.28 ||
        (Math.abs(state.velocity) > 0.5 &&
          Math.abs(state.dx) > 40 &&
          Math.sign(state.velocity) === Math.sign(state.dx));
      if (far && target >= 0 && target <= LAST) {
        if (!reducedMotion()) {
          page.style.transition =
            'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out';
          page.style.transform = `translate3d(${state.dx < 0 ? -width * 0.4 : width * 0.4}px, 0, 0)`;
          page.style.opacity = '0';
        }
        gone = page;
        // Se a tela nova não vier, a antiga volta.
        restore = window.setTimeout(() => clear(page), 4000);
        swipeTo(target);
        return;
      }
      if (reducedMotion()) {
        clear(page);
        return;
      }
      page.style.transition =
        'transform 320ms cubic-bezier(0.34, 1.2, 0.64, 1)';
      page.style.transform = 'translate3d(0, 0, 0)';
      window.setTimeout(() => {
        if (swipe?.page !== page) clear(page);
      }, 340);
    };
    const cancel = () => {
      const state = swipe;
      swipe = null;
      if (state?.page) clear(state.page);
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', cancel);
      window.cancelAnimationFrame(raf);
      window.clearTimeout(restore);
      // A tela que saiu de lado fica escondida (Activity); ao voltar a
      // ela, aparece no lugar.
      if (gone) clear(gone);
    };
  }, [pathname]);

  if (HIDDEN.some((path) => isActiveSection(pathname, path))) return null;
  const index = TAB_SECTIONS.findIndex((item) =>
    tapped ? item.href === tapped : isActiveSection(pathname, item.href),
  );
  const shown = hover ?? index;

  const movePill = (position: number, animate: boolean) => {
    const pill = pillRef.current;
    if (!pill) return;
    pill.style.transition = animate && !reducedMotion() ? SPRING : 'none';
    pill.style.transform = `translate3d(${position * 100}%, 0, 0)`;
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
    // A tela nova monta depois da mola quase assentar: montar junto travava
    // a animação.
    if (!isActiveSection(pathname, href))
      window.setTimeout(() => router.push(href), 220);
  };

  return (
    <>
      {/* Espaço para o fim da página não ficar escondido atrás da barra. */}
      <div aria-hidden="true" className="vetra-tabbar-space lg:hidden" />
      <nav
        aria-label="Seções"
        className="vetra-tabbar fixed inset-x-0 bottom-0 z-30 rounded-t-[1.75rem] border-t bg-card px-2 pt-3.5 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.35)] lg:hidden"
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
                transform: `translate3d(${Math.max(index, 0) * 100}%, 0, 0)`,
                transition: SPRING,
              }}
            >
              <span
                ref={liftRef}
                className="h-full w-14 rounded-full bg-foreground/10 will-change-transform"
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
