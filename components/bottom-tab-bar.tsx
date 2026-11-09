'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from '@/components/navigation-link';
import { TAB_SECTIONS, isActiveSection } from '@/lib/app-sections';
import { cn } from '@/lib/utils';

/* Barra de abas do celular, presa na borda de baixo, em todas as telas do app. Some no
   computador (lá a navegação é a barra do topo), nas páginas públicas e no
   Vetra AI, onde o campo da conversa ocupa a borda de baixo. O porquinho do
   Vetra AI (vetra-ai-bubble.tsx) não desce abaixo dela. */

const HIDDEN = ['/auth', '/offline', '/desbloquear', '/assistente'];

export function BottomTabBar() {
  const pathname = usePathname();
  // Toque: a pílula já vai para a aba tocada, sem esperar a tela chegar.
  const [tapped, setTapped] = useState<string | null>(null);
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setTapped(null);
  }
  if (HIDDEN.some((path) => isActiveSection(pathname, path))) return null;
  const index = TAB_SECTIONS.findIndex((item) =>
    tapped ? item.href === tapped : isActiveSection(pathname, item.href),
  );
  return (
    <>
      {/* Espaço para o fim da página não ficar escondido atrás da barra. */}
      <div aria-hidden="true" className="vetra-tabbar-space lg:hidden" />
      <nav
        aria-label="Seções"
        className="vetra-tabbar fixed inset-x-0 bottom-0 z-30 rounded-t-[1.75rem] border-t bg-card/95 px-2 pt-1 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.35)] backdrop-blur-xl lg:hidden"
      >
        <div className="relative grid grid-cols-5">
          {/* A pílula atrás do ícone da aba ativa: desliza de uma aba para a
              outra (só transform, com mola curta). */}
          {index >= 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0 flex h-8 w-1/5 justify-center motion-safe:transition-transform motion-safe:duration-[380ms] motion-safe:ease-[cubic-bezier(0.34,1.36,0.64,1)]"
              style={{ transform: `translateX(${index * 100}%)` }}
            >
              <span className="h-full w-14 rounded-full bg-foreground/10" />
            </span>
          )}
          {TAB_SECTIONS.map((item, position) => {
            const active = position === index;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={
                  isActiveSection(pathname, item.href) ? 'page' : undefined
                }
                onClick={() => setTapped(item.href)}
                className={cn(
                  'relative flex flex-col items-center gap-1 pb-1.5 text-[10.5px] text-muted-foreground transition-colors duration-200',
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
