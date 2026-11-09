'use client';

import { usePathname } from 'next/navigation';
import Link from '@/components/navigation-link';
import { TAB_SECTIONS, isActiveSection } from '@/lib/app-sections';
import { cn } from '@/lib/utils';

/* Barra de abas flutuante do celular, em todas as telas do app. Some no
   computador (lá a navegação é a barra do topo), nas páginas públicas e no
   Vetra AI, onde o campo da conversa ocupa a borda de baixo. O porquinho do
   Vetra AI (vetra-ai-bubble.tsx) não desce abaixo dela. */

const HIDDEN = ['/auth', '/offline', '/desbloquear', '/assistente'];

export function BottomTabBar() {
  const pathname = usePathname();
  if (HIDDEN.some((path) => isActiveSection(pathname, path))) return null;
  return (
    <>
      {/* Espaço para o fim da página não ficar escondido atrás da barra. */}
      <div aria-hidden="true" className="h-24 lg:hidden" />
      <nav
        aria-label="Seções"
        className="vetra-tabbar fixed inset-x-3 z-30 flex items-center justify-around rounded-[2rem] border bg-card/85 px-2 py-2 shadow-lg backdrop-blur-xl lg:hidden"
      >
        {TAB_SECTIONS.map((item) => {
          const active = isActiveSection(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-14 flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-[10.5px] text-muted-foreground transition-colors',
                active && 'font-semibold text-foreground',
              )}
            >
              <item.icon className="size-5" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
