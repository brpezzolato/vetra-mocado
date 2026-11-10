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

/** Gastos (expense-ledger.tsx), bloco a bloco: voltar, título e "Novo", o
 * cartão do mês, busca, situação, cartões e a lista por dia. */
function LedgerSkeleton() {
  const row = (key: number) => (
    <div key={key} className="flex items-center gap-3.5 px-2 py-3">
      <Skeleton className="aspect-[1071/672] w-14 shrink-0 rounded-[4px]" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-36 max-w-full" />
        <Skeleton className="mt-1.5 h-3 w-24 max-w-full" />
      </div>
      <Skeleton className="h-3.5 w-16 shrink-0" />
    </div>
  );
  return (
    <>
      <div className="app-container pt-3">
        <Back />
      </div>
      <div
        aria-busy="true"
        aria-label="Carregando"
        className="app-container py-6 md:py-9"
      >
        <div className="mx-auto max-w-3xl lg:max-w-none">
          <div className="flex items-end justify-between gap-3">
            <div>
              <Skeleton className="h-2.5 w-14" />
              <Skeleton className="mt-2 h-7 w-36 md:h-8" />
            </div>
            <Skeleton className="h-9 w-20 rounded-full" />
          </div>
          <div className="lg:mt-6 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-x-8 lg:gap-y-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
            <div className="lg:col-start-1">
              <section className="mt-6 rounded-3xl border bg-card p-5 md:p-6 lg:mt-0">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2 h-9 w-44" />
                <Skeleton className="mt-5 h-2 w-full rounded-full" />
                <div className="mt-5 grid grid-cols-3 gap-3 border-t pt-4">
                  {[0, 1, 2].map((index) => (
                    <div key={index}>
                      <Skeleton className="h-2.5 w-12" />
                      <Skeleton className="mt-1.5 h-4 w-16" />
                    </div>
                  ))}
                </div>
              </section>
              <div className="mt-6 flex flex-col gap-4">
                <Skeleton className="h-11 rounded-2xl" />
                <div className="grid grid-cols-5 rounded-full bg-muted/70 p-1">
                  <Skeleton className="h-9 rounded-full bg-foreground/15" />
                </div>
                <div className="rounded-3xl border bg-card p-1">
                  {[0, 1, 2, 3].map((index) => (
                    <div
                      key={index}
                      className="flex h-11 items-center gap-3 px-3"
                    >
                      <Skeleton className="size-6 rounded-full" />
                      <Skeleton className="h-3.5 w-32" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:mt-0">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-28" />
              </div>
              <div className="mt-2 rounded-3xl border bg-card px-3 pb-2 md:px-4">
                <Skeleton className="mx-2 mt-4 mb-1 h-2.5 w-12" />
                <div className="divide-y divide-border/50">
                  {[0, 1, 2].map(row)}
                </div>
                <Skeleton className="mx-2 mt-4 mb-1 h-2.5 w-14" />
                <div className="divide-y divide-border/50">
                  {[3, 4, 5].map(row)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Resumo/calendário (period-summary-view.tsx), bloco a bloco: voltar e
 * "Hoje", o cartão do dia, o calendário com a grade e a legenda, a coluna do
 * dia e dos próximos, e o cartão das listas do mês. */
function SummarySkeleton() {
  // Um mês com pontos em alguns dias, como num calendário de verdade.
  const dots = [2, 6, 9, 13, 17, 20, 24, 27, 30];
  const pair = (label: string, value: string) => (
    <div>
      <Skeleton className={`h-3 ${label}`} />
      <Skeleton className={`mt-1.5 h-4 ${value}`} />
    </div>
  );
  const line = (key: number) => (
    <div key={key} className="flex items-center gap-3 px-1 py-1.5">
      <Skeleton className="h-3 w-9 shrink-0" />
      <Skeleton className="size-2 shrink-0 rounded-full" />
      <Skeleton className="h-3.5 flex-1" />
      <Skeleton className="h-3.5 w-14 shrink-0" />
    </div>
  );
  return (
    <div
      aria-busy="true"
      aria-label="Carregando"
      className="app-container mx-auto max-w-5xl py-6 md:py-9"
    >
      <div className="flex items-center justify-between gap-3">
        <Back />
        <Skeleton className="h-10 w-20 rounded-full" />
      </div>

      {/* Cartão do dia: título, pílula, setas, valor e os dois números. */}
      <section className="mt-5 rounded-3xl border bg-card p-5 md:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Skeleton className="h-6 w-36" />
            <Skeleton className="mt-2 h-8 w-28 rounded-full" />
          </div>
          <div className="flex gap-1">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-4 h-3 w-24" />
        <Skeleton className="mt-2 h-10 w-44 md:h-12" />
        <div className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-2 sm:gap-6">
          {[0, 1].map((key) => (
            <div key={key}>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-5 w-24" />
              <Skeleton className="mt-1.5 h-3 w-40 max-w-full" />
            </div>
          ))}
        </div>
      </section>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Calendário: mês e setas, dias da semana, a grade e a legenda. */}
        <section className="min-w-0 rounded-3xl border bg-card p-3 sm:p-4 lg:col-start-1 lg:row-start-1">
          <div className="mb-3 flex items-center gap-2 px-1 pt-1">
            <Skeleton className="h-6 w-36" />
            <div className="ml-auto flex gap-1">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="size-9 rounded-full" />
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="grid place-items-center py-1.5">
                <Skeleton className="h-2.5 w-6" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            {Array.from({ length: 30 }, (_, index) => (
              <div
                key={index}
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl bg-muted/30"
              >
                <Skeleton className="h-3 w-4" />
                <span className="flex h-2 gap-0.5">
                  {dots.includes(index) && (
                    <Skeleton className="size-2 rounded-full" />
                  )}
                  {index % 9 === 6 && (
                    <Skeleton className="size-2 rounded-full" />
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 px-1">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="ml-auto h-7 w-28 rounded-full" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t px-1 pt-4 sm:grid-cols-3">
            {pair('w-28', 'w-20')}
            {pair('w-20', 'w-24')}
            <div className="col-span-2 sm:col-span-1">
              {pair('w-36', 'w-20')}
            </div>
          </div>
        </section>

        {/* Coluna do dia: o valor do dia, os lançamentos e os próximos. */}
        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <section className="rounded-3xl border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Skeleton className="h-3 w-32" />
                <Skeleton className="mt-2 h-6 w-24" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="mt-3 h-2 w-full rounded-full" />
            <Skeleton className="mt-2 h-3 w-40" />
          </section>
          <section className="rounded-3xl border bg-card px-3 py-1 md:px-4">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
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
          </section>
          <section className="rounded-3xl border bg-card p-5">
            <Skeleton className="h-4 w-36" />
            <div className="mt-3 space-y-2">{[0, 1, 2, 3].map(line)}</div>
          </section>
        </div>

        {/* Listas do mês: os quatro chips e as barras por categoria. */}
        <section className="min-w-0 rounded-3xl border bg-card p-4 lg:col-start-1 lg:row-start-2">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-32 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-4 w-40" />
          <div className="mt-4 space-y-4">
            {['w-full', 'w-3/4', 'w-1/2', 'w-1/3'].map((width) => (
              <div key={width}>
                <div className="flex justify-between gap-3">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
                <Skeleton className={`mt-2 h-1.5 rounded-full ${width}`} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
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
      {isActiveSection(pathname, '/financeiro') ? (
        <LedgerSkeleton />
      ) : isActiveSection(pathname, '/resumo') ||
        isActiveSection(pathname, '/calendario') ? (
        <SummarySkeleton />
      ) : (
        <div
          aria-busy="true"
          aria-label="Carregando"
          className={`app-container grid min-w-0 gap-6 py-6 md:py-9 ${pathname === '/' ? '' : 'max-w-3xl'}`}
        >
          <Body pathname={pathname} />
        </div>
      )}
    </main>
  );
}
