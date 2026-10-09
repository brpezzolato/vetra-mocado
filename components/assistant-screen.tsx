'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FinancialChat } from '@/components/financial-chat';
import { VetraMascot } from '@/components/vetra-mascot';
import { CloseSymbol, GlassButton } from '@/components/ui/glass-button';

/**
 * Conversa como tela própria no celular, com a cara do sheet.
 * No iOS o teclado encolhe só o `visualViewport` e o desloca; o que gruda no
 * topo da página sai junto. Por isso a tela é uma caixa `fixed` do tamanho da
 * área visível, movida até ela: cabeçalho no alto, só a lista rola, campo
 * embaixo (`layout="sheet"`). O documento fica travado.
 */
export function AssistantScreen() {
  const router = useRouter();
  const screenRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const screen = screenRef.current;
    const viewport = window.visualViewport;
    if (!screen) return;

    // O documento não rola atrás do chat.
    const root = document.documentElement;
    root.classList.add('vetra-scroll-locked');

    if (!viewport) return () => root.classList.remove('vetra-scroll-locked');

    // Maior altura já vista com o teclado fechado. Depois de fechar o teclado o
    // iOS às vezes encolhe a área da página e não devolve: o que passa dela é
    // cortado. Nesse caso o campo perde a folga da barra de gestos.
    let fullHeight = Math.max(window.innerHeight, viewport.height);
    let width = window.innerWidth;
    let frame = 0;
    const sync = () => {
      // O iOS rola a página ao abrir o teclado; desfaz na hora para a caixa ficar
      // no topo da área visível.
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        screen.style.setProperty(
          '--vetra-screen-height',
          `${Math.round(viewport.height)}px`,
        );
        screen.style.setProperty(
          '--vetra-screen-top',
          `${Math.max(0, Math.round(viewport.offsetTop))}px`,
        );
        // Girou a tela: a altura de referência recomeça.
        if (window.innerWidth !== width) {
          width = window.innerWidth;
          fullHeight = Math.max(window.innerHeight, viewport.height);
        }
        // Teclado aberto: tira do campo a folga da barra de gestos. O cabeçalho
        // mantém a da barra de status.
        const keyboardOpen = fullHeight - viewport.height > 120;
        const visible = Math.min(window.innerHeight, viewport.height);
        if (!keyboardOpen) fullHeight = Math.max(fullHeight, visible);
        screen.dataset.viewportShort = String(
          !keyboardOpen && fullHeight - visible > 24,
        );
        screen.dataset.keyboardOpen = String(keyboardOpen);
      });
    };
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    // O iOS às vezes avisa só no meio da animação do teclado: ao mudar o foco,
    // recalcula ao longo de ~0,5 s.
    let timers: number[] = [];
    const settle = () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [0, 120, 260, 420, 650, 900].map((delay) =>
        window.setTimeout(sync, delay),
      );
    };
    screen.addEventListener('focusin', settle);
    screen.addEventListener('focusout', settle);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      screen.removeEventListener('focusin', settle);
      screen.removeEventListener('focusout', settle);
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync);
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      root.classList.remove('vetra-scroll-locked');
    };
  }, []);

  return (
    <main
      ref={screenRef}
      className="vetra-assistant-screen fixed inset-x-0 flex flex-col overflow-hidden bg-background"
    >
      {/* Desktop: uma coluna de leitura no centro, não a largura toda. */}
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col md:border-x">
        <header className="vetra-sheet-safe-header shrink-0 border-b bg-background pr-4 pb-3 pl-4">
          <div className="flex items-center gap-3">
            <VetraMascot className="size-9 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base font-semibold">Vetra AI</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pergunte sobre suas finanças.
              </p>
            </div>
            <GlassButton
              shape="circle"
              className="ml-auto size-9"
              aria-label="Fechar Vetra AI"
              onClick={() => {
                if (window.history.length > 1) router.back();
                else router.push('/');
              }}
            >
              <CloseSymbol />
            </GlassButton>
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <FinancialChat layout="sheet" />
        </div>
      </div>
    </main>
  );
}
