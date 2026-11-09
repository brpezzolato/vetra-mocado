'use client';

import { Plus } from 'lucide-react';
import Link from '@/components/navigation-link';
import { SIDEBAR_SECTIONS } from '@/lib/app-sections';
import { cn } from '@/lib/utils';

/** Coluna de seções da home no desktop, com o "Novo lançamento" no topo. */
export function HomeSidebar({ onAdd }: { onAdd: () => void }) {
  return (
    <nav
      aria-label="Seções"
      className="sticky top-24 grid min-w-0 gap-1 rounded-3xl border bg-card p-3 shadow-xs"
    >
      <button
        type="button"
        onClick={onAdd}
        className="vetra-glass vetra-glass-primary mb-2 inline-flex h-11 items-center justify-center gap-2 text-sm font-semibold"
      >
        <Plus className="size-4" aria-hidden="true" /> Novo lançamento
      </button>
      {SIDEBAR_SECTIONS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.href === '/' ? 'page' : undefined}
          className={cn(
            'flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60',
            item.href === '/' && 'bg-muted font-medium text-foreground',
          )}
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
