'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { VetraMascot } from '@/components/vetra-mascot';
import { subscribeSyncProgress, type SyncProgress } from '@/lib/sync-progress';

/* Vetra AI como botão flutuante, estilo AssistiveTouch:
   - sempre num canto; ao soltar, desliza ao canto da posição projetada pela
     velocidade do gesto;
   - nunca sobre a barra do topo; some com menus e diálogos (globals.css);
   - fala o progresso da sincronização num balão (lib/sync-progress.ts).
   Parado usa left/top; em movimento só transform, fora do React. */

const SIZE = 56;
const MARGIN = 14;
const DRAG_THRESHOLD = 6;
const STORAGE_KEY = 'vetra:ai-bubble-corner';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
const CORNERS: Corner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

const subscribeNothing = () => () => {};

function readCorner(): Corner {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (CORNERS.includes(value as Corner)) return value as Corner;
  } catch {}
  // Primeira vez: embaixo à direita, onde o polegar alcança.
  return 'bottom-right';
}

/**
 * Área permitida: abaixo da barra do topo, menos margens e áreas seguras
 * (lidas de uma sonda, pois `env()` só existe no CSS).
 */
function bounds(probe: HTMLElement | null) {
  const style = probe ? getComputedStyle(probe) : null;
  const inset = (side: 'Top' | 'Right' | 'Bottom' | 'Left') =>
    style ? parseFloat(style[`padding${side}`]) || 0 : 0;
  // Barra sticky: a borda de baixo não muda com a rolagem.
  const nav = document.querySelector('.vetra-app-safe-header');
  const navBottom = nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
  const minX = MARGIN + inset('Left');
  const minY = MARGIN + Math.max(inset('Top'), navBottom);
  const maxX = Math.max(
    minX,
    window.innerWidth - SIZE - MARGIN - inset('Right'),
  );
  const maxY = Math.max(
    minY,
    window.innerHeight - SIZE - MARGIN - inset('Bottom'),
  );
  return { minX, minY, maxX, maxY };
}

function cornerPoint(corner: Corner, probe: HTMLElement | null) {
  const { minX, minY, maxX, maxY } = bounds(probe);
  return {
    x: corner.endsWith('left') ? minX : maxX,
    y: corner.startsWith('top') ? minY : maxY,
  };
}

/**
 * Quadros de uma mola amortecida que leva (dx, dy) a zero partindo da
 * velocidade do dedo (px/ms). Passa um pouco e assenta.
 */
function springFrames(dx: number, dy: number, vx: number, vy: number) {
  const STIFFNESS = 210;
  const DAMPING = 21;
  const STEP = 1 / 60;
  let x = dx;
  let y = dy;
  let ux = vx * 1000;
  let uy = vy * 1000;
  const frames: Keyframe[] = [{ transform: `translate3d(${x}px, ${y}px, 0)` }];
  let arrived = -1;
  for (let step = 1; step < 90; step++) {
    ux += (-STIFFNESS * x - DAMPING * ux) * STEP;
    uy += (-STIFFNESS * y - DAMPING * uy) * STEP;
    x += ux * STEP;
    y += uy * STEP;
    frames.push({
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`,
    });
    if (arrived < 0 && Math.hypot(x, y) < 3) arrived = step;
    if (Math.hypot(x, y) < 0.3 && Math.hypot(ux, uy) < 8) break;
  }
  frames.push({ transform: 'translate3d(0px, 0px, 0)' });
  return {
    frames,
    duration: (frames.length - 1) * STEP * 1000,
    /** Momento em que toca o canto (pouso). */
    arrivedAt: Math.max(0, arrived) * STEP * 1000,
  };
}

export function VetraAiBubble({ onOpen }: { onOpen: () => void }) {
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(<FloatingBubble onOpen={onOpen} />, document.body);
}

type Anchor = { x: number; y: number; corner: Corner };

function FloatingBubble({ onOpen }: { onOpen: () => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const corner = useRef<Corner>('bottom-right');
  /** A posição parada, gravada em left/top. */
  const position = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  const settleTimer = useRef(0);
  const flight = useRef<Animation | null>(null);
  const drag = useRef<{
    id: number;
    startX: number;
    startY: number;
    /** Onde o porquinho está agora, durante o arraste. */
    x: number;
    y: number;
    moved: boolean;
    lastX: number;
    lastY: number;
    lastT: number;
    vx: number;
    vy: number;
  } | null>(null);
  // Até quando um clique encerra um arraste. Por tempo: no toque o clique às
  // vezes não dispara e uma flag presa engoliria o próximo.
  const suppressClickUntil = useRef(0);

  // Fala atual e posição parada; `anchor` null esconde o balão em movimento.
  const [speech, setSpeech] = useState<SyncProgress>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const place = (x: number, y: number) => {
    position.current = { x, y };
    const wrapper = wrapperRef.current;
    if (wrapper)
      Object.assign(wrapper.style, { left: `${x}px`, top: `${y}px` });
  };

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const snapToCorner = () => {
      if (drag.current) return;
      const point = cornerPoint(corner.current, probeRef.current);
      place(point.x, point.y);
      setAnchor({ ...point, corner: corner.current });
    };
    corner.current = readCorner();
    snapToCorner();
    wrapper.dataset.ready = 'true';
    window.addEventListener('resize', snapToCorner);
    window.visualViewport?.addEventListener('resize', snapToCorner);
    return () => {
      window.cancelAnimationFrame(frame.current);
      window.clearTimeout(settleTimer.current);
      window.removeEventListener('resize', snapToCorner);
      window.visualViewport?.removeEventListener('resize', snapToCorner);
    };
  }, []);

  /** `now` = timeStamp do ponteiro (mesma origem do clique seguinte). */
  const release = (now: number) => {
    const current = drag.current;
    drag.current = null;
    const wrapper = wrapperRef.current;
    if (!current?.moved || !wrapper) return;
    window.cancelAnimationFrame(frame.current);
    suppressClickUntil.current = now + 400;
    delete wrapper.dataset.dragging;
    wrapper.style.removeProperty('--vetra-lean');
    // Canto pela posição projetada (~200ms de inércia) vs. meio da área.
    const { minX, minY, maxX, maxY } = bounds(probeRef.current);
    const left = current.x + current.vx * 200 < (minX + maxX) / 2;
    const top = current.y + current.vy * 200 < (minY + maxY) / 2;
    corner.current = `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}`;
    try {
      localStorage.setItem(STORAGE_KEY, corner.current);
    } catch {}
    glide(current, corner.current, { vx: current.vx, vy: current.vy });
    // Arrastou durante a sincronização: fica onde soltou, sem voltar.
    homeCorner.current = null;
  };

  /**
   * FLIP até o canto: grava left/top finais e anima o transform de `from` a
   * zero. Não grava o canto preferido (só o arraste grava).
   */
  const glide = (
    from: { x: number; y: number },
    to: Corner,
    velocity = { vx: 0, vy: 0 },
  ) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    corner.current = to;
    const target = cornerPoint(to, probeRef.current);
    setAnchor(null);
    place(target.x, target.y);
    wrapper.style.transform = '';
    flight.current?.cancel();
    window.clearTimeout(settleTimer.current);
    const land = () => {
      // Pouso ao tocar o canto.
      wrapper.dataset.landed = 'true';
      window.setTimeout(() => delete wrapper.dataset.landed, 450);
    };
    const done = () => {
      flight.current = null;
      setAnchor({ ...target, corner: to });
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done();
      return;
    }
    const { frames, duration, arrivedAt } = springFrames(
      from.x - target.x,
      from.y - target.y,
      velocity.vx,
      velocity.vy,
    );
    wrapper.dataset.flying = 'true';
    const animation = wrapper.animate(frames, { duration, easing: 'linear' });
    flight.current = animation;
    settleTimer.current = window.setTimeout(land, arrivedAt);
    animation.onfinish = () => {
      delete wrapper.dataset.flying;
      done();
    };
    animation.oncancel = () => delete wrapper.dataset.flying;
  };

  // Na sincronização vai para o canto superior direito e fala de lá; ao fim
  // volta para `homeCorner`.
  const homeCorner = useRef<Corner | null>(null);
  useEffect(
    () =>
      subscribeSyncProgress((progress) => {
        setSpeech(progress);
        const wrapper = wrapperRef.current;
        if (wrapper) {
          if (progress) wrapper.dataset.talking = 'true';
          else delete wrapper.dataset.talking;
        }
        if (progress && homeCorner.current === null && !drag.current) {
          homeCorner.current = corner.current;
          if (corner.current !== 'top-right')
            glide(position.current, 'top-right');
        } else if (!progress && homeCorner.current) {
          const back = homeCorner.current;
          homeCorner.current = null;
          if (corner.current !== back) glide(position.current, back);
        }
      }),
    [],
  );

  // Balão acima (abaixo nos cantos de cima), crescendo para dentro da tela.
  // Medido contra a tela inteira para não espremer o texto.
  const bubble = (() => {
    if (!anchor) return null;
    const below = anchor.corner.startsWith('top');
    const growsRight = anchor.corner.endsWith('left');
    return {
      below,
      box: {
        ...(below
          ? { top: anchor.y + SIZE + 10 }
          : { bottom: window.innerHeight - anchor.y + 10 }),
        ...(growsRight
          ? { left: anchor.x }
          : { right: window.innerWidth - (anchor.x + SIZE) }),
        transformOrigin: `${growsRight ? 'left' : 'right'} ${below ? 'top' : 'bottom'}`,
      },
      tail: {
        ...(below ? { top: -6 } : { bottom: -6 }),
        ...(growsRight ? { left: SIZE / 2 - 6 } : { right: SIZE / 2 - 6 }),
      },
    };
  })();

  return (
    <>
      {/* Sonda invisível para ler `env()` do JS. */}
      <div
        ref={probeRef}
        aria-hidden="true"
        className="pointer-events-none invisible fixed pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
      />
      {/* Camada do tamanho da tela que corta o que vaza; só o botão recebe toque. */}
      <div className="vetra-ai-bubble-layer pointer-events-none fixed inset-0 z-45 overflow-hidden">
        <div
          ref={wrapperRef}
          className="vetra-ai-bubble-wrap pointer-events-auto absolute"
        >
          <button
            type="button"
            aria-label="Abrir Vetra AI"
            title="Vetra AI — arraste para outro canto"
            className="vetra-ai-bubble grid size-14 touch-none place-items-center select-none"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              // Afunda ao toque (:active não dispara no iPhone).
              if (wrapperRef.current)
                wrapperRef.current.dataset.pressed = 'true';
              drag.current = {
                id: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                x: position.current.x,
                y: position.current.y,
                moved: false,
                lastX: event.clientX,
                lastY: event.clientY,
                lastT: event.timeStamp,
                vx: 0,
                vy: 0,
              };
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.id !== event.pointerId) return;
              const dx = event.clientX - current.startX;
              const dy = event.clientY - current.startY;
              if (!current.moved) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                current.moved = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                const wrapper = wrapperRef.current;
                if (wrapper) {
                  // Pegou no meio do encaixe: continua de onde está.
                  window.clearTimeout(settleTimer.current);
                  if (flight.current) {
                    const matrix = new DOMMatrixReadOnly(
                      getComputedStyle(wrapper).transform,
                    );
                    flight.current.cancel();
                    flight.current = null;
                    place(
                      position.current.x + matrix.m41,
                      position.current.y + matrix.m42,
                    );
                  }
                  wrapper.style.transform = '';
                  delete wrapper.dataset.landed;
                  delete wrapper.dataset.pressed;
                  wrapper.dataset.dragging = 'true';
                }
                setAnchor(null);
              }
              // Velocidade suavizada, em px/ms, para o arremesso.
              const dt = Math.max(1, event.timeStamp - current.lastT);
              current.vx =
                current.vx * 0.6 + ((event.clientX - current.lastX) / dt) * 0.4;
              current.vy =
                current.vy * 0.6 + ((event.clientY - current.lastY) / dt) * 0.4;
              current.lastX = event.clientX;
              current.lastY = event.clientY;
              current.lastT = event.timeStamp;
              // Livre no arraste, preso à área; encaixe ao soltar. Um transform por quadro.
              const { minX, minY, maxX, maxY } = bounds(probeRef.current);
              current.x = Math.min(
                maxX,
                Math.max(minX, position.current.x + dx),
              );
              current.y = Math.min(
                maxY,
                Math.max(minY, position.current.y + dy),
              );
              window.cancelAnimationFrame(frame.current);
              frame.current = window.requestAnimationFrame(() => {
                const wrapper = wrapperRef.current;
                if (!wrapper || drag.current !== current) return;
                wrapper.style.transform = `translate3d(${current.x - position.current.x}px, ${current.y - position.current.y}px, 0)`;
                // Inclina para o lado em que o dedo leva, pela velocidade.
                const lean = Math.max(-16, Math.min(16, current.vx * 22));
                wrapper.style.setProperty(
                  '--vetra-lean',
                  `${lean.toFixed(1)}deg`,
                );
              });
            }}
            onPointerUp={(event) => {
              if (wrapperRef.current) delete wrapperRef.current.dataset.pressed;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
              release(event.timeStamp);
            }}
            onPointerCancel={(event) => {
              if (wrapperRef.current) delete wrapperRef.current.dataset.pressed;
              release(event.timeStamp);
            }}
            onClick={(event) => {
              // O clique que encerra um arraste não abre o chat.
              if (event.timeStamp < suppressClickUntil.current) return;
              onOpen();
            }}
          >
            <VetraMascot className="pointer-events-none size-12" />
          </button>
        </div>
        {speech && bubble && (
          // Por fora, só a posição; por dentro, a pílula.
          <output
            aria-live="polite"
            className="vetra-ai-speech pointer-events-none absolute isolate max-w-[calc(100vw-1.5rem)]"
            style={bubble.box}
          >
            <span className="vetra-ai-speech-pill relative flex h-10 items-center gap-2.5 rounded-full border bg-popover pr-4 pl-3.5 text-[13px] font-medium whitespace-nowrap text-popover-foreground">
              {speech.value >= 100 ? (
                <Check
                  aria-hidden="true"
                  className="size-4 shrink-0 text-emerald-500"
                />
              ) : (
                <span aria-hidden="true" className="vetra-ai-dots">
                  <i />
                  <i />
                  <i />
                </span>
              )}
              <span
                key={speech.label}
                className="vetra-ai-speech-text min-w-0 overflow-hidden text-ellipsis"
              >
                {speech.label}
              </span>
              {/* A pontinha, sobre a cabeça do porquinho. */}
              <span
                aria-hidden="true"
                className={`absolute size-3 rotate-45 bg-popover ${
                  bubble.below ? 'border-t border-l' : 'border-r border-b'
                }`}
                style={bubble.tail}
              />
            </span>
          </output>
        )}
      </div>
    </>
  );
}
