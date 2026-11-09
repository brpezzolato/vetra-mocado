'use client';

import { usePathname } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { FinanceOverviewDataSkeleton } from '@/components/data-skeletons';
import { Skeleton } from '@/components/ui/skeleton';
import { isActiveSection } from '@/lib/app-sections';

/* O esqueleto da tela que está chegando (app/loading.tsx): a barra do topo de
   verdade e os blocos no formato da página, enquanto ela baixa. Some quando a
   tela fica pronta; voltar a uma tela já vista não passa por aqui (as telas
   ficam montadas, cacheComponents). */

function Card({ className = 'h-40' }: { className?: string }) {
  return <Skeleton className={`${className} rounded-3xl`} />;
}

function Rows({ count = 5 }: { count?: number }) {
  return (
    <div className="rounded-3xl border bg-card px-4 py-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3.5 border-b border-border/50 py-3 last:border-0"
        >
          <Skeleton className="aspect-[1071/672] w-14 shrink-0 rounded-[4px]" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-32 max-w-full" />
            <Skeleton className="mt-1.5 h-3 w-24 max-w-full" />
          </div>
          <Skeleton className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function Back() {
  return <Skeleton className="h-9 w-24 rounded-full" />;
}

function Body({ pathname }: { pathname: string }) {
  const is = (href: string) => isActiveSection(pathname, href);
  if (pathname === '/')
    return (
      <>
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Card className="h-80" />
        <FinanceOverviewDataSkeleton />
      </>
    );
  if (is('/faturas'))
    return (
      <>
        <Back />
        <div>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-3 h-11 w-52" />
          <Skeleton className="mt-2 h-4 w-60 max-w-full" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Card />
          <Card />
          <Card />
        </div>
      </>
    );
  if (is('/resumo') || is('/calendario'))
    return (
      <>
        <div className="flex items-center justify-between">
          <Back />
          <Skeleton className="h-10 w-20 rounded-full" />
        </div>
        <Card className="h-56" />
        <Card className="h-80" />
      </>
    );
  if (is('/cofrinhos'))
    return (
      <>
        <div>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-10 w-56" />
        </div>
        <div className="flex gap-3 overflow-x-clip">
          <Card className="h-36 w-64 shrink-0" />
          <Card className="h-36 w-64 shrink-0" />
        </div>
        <Rows count={4} />
      </>
    );
  if (is('/financeiro'))
    return (
      <>
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-2 overflow-x-clip">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-9 w-24 shrink-0 rounded-full" />
          ))}
        </div>
        <Rows count={7} />
      </>
    );
  return (
    <>
      <Back />
      <Skeleton className="h-8 w-48" />
      <Card />
      <Card className="h-56" />
    </>
  );
}

export function RouteSkeleton() {
  const pathname = usePathname();
  return (
    <main className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <AppHeader onRefresh={() => window.location.reload()} />
      <div
        aria-busy="true"
        aria-label="Carregando"
        className={`app-container grid min-w-0 gap-6 py-6 md:py-9 ${pathname === '/' ? '' : 'max-w-3xl'}`}
      >
        <Body pathname={pathname} />
      </div>
    </main>
  );
}
