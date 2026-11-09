'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { AssistantScreen } from '@/components/assistant-screen';
import { VetraMascot } from '@/components/vetra-mascot';
import { VetraAiBubble } from '@/components/vetra-ai-bubble';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  FinancialChat,
  preloadConversation,
} from '@/components/financial-chat';
import { CloseSymbol, GlassButton } from '@/components/ui/glass-button';

export function FinancialChatSheet() {
  const [open, setOpen] = useState(false);
  // Celular: a conversa abre por cima da tela atual, sem trocar de página.
  const [screenOpen, setScreenOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // A conversa já vem baixada: o toque no porquinho só mostra.
  useEffect(() => {
    const timer = window.setTimeout(preloadConversation, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  // Trocou de tela (um link da resposta, a barra de abas): a conversa fecha.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setScreenOpen(false);
  }

  useEffect(() => {
    if (!screenOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScreenOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screenOpen]);

  useEffect(() => {
    if (!open) return;

    const sheet = sheetRef.current;
    const viewport = window.visualViewport;
    if (!sheet || !viewport) return;

    let animationFrame = 0;
    /* Sheet sized to the visual viewport (what the keyboard doesn't cover), so
       the header stays on top and the composer at the bottom. */
    const syncWithVisualViewport = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        sheet.style.setProperty(
          '--vetra-visual-viewport-top',
          `${Math.max(0, Math.round(viewport.offsetTop))}px`,
        );
        sheet.style.setProperty(
          '--vetra-visual-viewport-left',
          `${Math.max(0, Math.round(viewport.offsetLeft))}px`,
        );
        sheet.style.setProperty(
          '--vetra-visual-viewport-width',
          `${Math.round(viewport.width)}px`,
        );
        sheet.style.setProperty(
          '--vetra-visual-viewport-height',
          `${Math.round(viewport.height)}px`,
        );
        /* With the keyboard up, the header drops the status-bar room.
           `innerHeight` (layout viewport) doesn't shrink, so the difference is the keyboard. */
        sheet.dataset.keyboard = String(
          window.innerHeight - viewport.height > 120,
        );
      });
    };

    syncWithVisualViewport();
    viewport.addEventListener('resize', syncWithVisualViewport);
    viewport.addEventListener('scroll', syncWithVisualViewport);
    sheet.addEventListener('focusin', syncWithVisualViewport);
    sheet.addEventListener('focusout', syncWithVisualViewport);
    window.addEventListener('orientationchange', syncWithVisualViewport);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      viewport.removeEventListener('resize', syncWithVisualViewport);
      viewport.removeEventListener('scroll', syncWithVisualViewport);
      sheet.removeEventListener('focusin', syncWithVisualViewport);
      sheet.removeEventListener('focusout', syncWithVisualViewport);
      window.removeEventListener('orientationchange', syncWithVisualViewport);
    };
  }, [open]);

  // Sem porquinho nas telas públicas e na própria conversa (/assistente).
  if (
    ['/auth', '/offline', '/desbloquear', '/assistente'].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  )
    return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Bolha flutuante (portal no <body>, só após montar). No celular abre
          a tela da conversa por cima, em vez do sheet (assistant-screen.tsx). */}
      <VetraAiBubble
        routeKey={pathname}
        onOpen={() => {
          preloadConversation();
          if (window.matchMedia('(max-width: 767px)').matches)
            setScreenOpen(true);
          else setOpen(true);
        }}
      />
      {screenOpen &&
        createPortal(
          <dialog
            open
            aria-modal="true"
            aria-label="Vetra AI"
            className="fixed inset-0 z-50 m-0 size-full max-h-none max-w-none border-0 bg-transparent p-0 text-foreground"
          >
            <AssistantScreen onClose={() => setScreenOpen(false)} />
          </dialog>,
          document.body,
        )}
      <SheetContent
        ref={sheetRef}
        side="right"
        showCloseButton={false}
        className="vetra-chat-sheet inset-auto right-auto bottom-auto max-w-none gap-0 overflow-hidden overscroll-none border-0 sm:max-w-none"
        style={{
          maxWidth: 'none',
          ['--vetra-visual-viewport-top' as string]: '0px',
          ['--vetra-visual-viewport-left' as string]: '0px',
          ['--vetra-visual-viewport-width' as string]: '100vw',
          ['--vetra-visual-viewport-height' as string]: '100dvh',
        }}
      >
        <SheetHeader className="vetra-sheet-safe-header shrink-0 border-b pr-4 pb-3 pl-4">
          <div className="flex items-center gap-3">
            <VetraMascot className="size-9 shrink-0" />
            <div className="min-w-0">
              <SheetTitle className="text-base">Vetra AI</SheetTitle>
              <SheetDescription className="mt-0.5 text-xs">
                Pergunte sobre suas finanças.
              </SheetDescription>
            </div>
            <SheetClose
              render={
                <GlassButton
                  shape="circle"
                  className="ml-auto size-9"
                  aria-label="Fechar Vetra AI"
                />
              }
            >
              <CloseSymbol />
            </SheetClose>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1">
          <FinancialChat layout="sheet" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
