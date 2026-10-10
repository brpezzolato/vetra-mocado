import { Skeleton } from '@/components/ui/skeleton';

/** Abas da home em pílula com a aba Gastos aberta (finance-overview.tsx). */
export function FinanceOverviewDataSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando informações financeiras"
      className="min-w-0"
    >
      <div className="relative grid h-12 grid-cols-3 rounded-full bg-muted/70 p-1">
        <Skeleton className="rounded-full bg-foreground/15" />
        {[0, 1].map((index) => (
          <div key={index} className="grid place-items-center">
            <Skeleton className="h-4 w-16 opacity-60" />
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-3xl border bg-card">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 md:px-6 md:pt-6">
          <div>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
          <Skeleton className="size-9 rounded-full" />
        </div>
        <div className="px-3 pt-1 pb-3 md:px-4">
          <Skeleton className="mx-2 mt-4 mb-1 h-2.5 w-12" />
          <div className="divide-y divide-border/50">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="flex items-center gap-3.5 px-2 py-3">
                <Skeleton className="aspect-[1071/672] w-14 shrink-0 rounded-[4px]" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-32 max-w-full" />
                  <Skeleton className="mt-1.5 h-3 w-24 max-w-full" />
                </div>
                <Skeleton className="h-4 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardDataSkeleton({ overview }: { overview: boolean }) {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando dados dos bancos"
      className="space-y-7"
    >
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      {overview ? (
        <FinanceOverviewDataSkeleton />
      ) : (
        <>
          <section className="space-y-4 rounded-3xl border bg-card p-5 md:p-6">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-10 w-52" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
            </div>
          </section>
          <Skeleton className="h-72 rounded-3xl" />
          <Skeleton className="h-48 rounded-3xl" />
        </>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    </div>
  );
}
