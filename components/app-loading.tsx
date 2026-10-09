import { BarMark } from '@/components/bar-loaders';
import { LoadingExitTrigger } from '@/components/loading-exit-trigger';

/** O carregamento do app: as barras do logo subindo. Ao sair, o logo cresce
 * e revela o app (lib/loading-exit.ts). */
export function AppLoading() {
  return (
    <div
      className="fixed inset-0 z-[1000] grid h-dvh place-items-center overflow-hidden bg-background text-foreground"
      aria-busy="true"
    >
      <output className="sr-only" aria-live="polite">
        Carregando…
      </output>
      <LoadingExitTrigger className="size-28">
        <BarMark variant="rise" size={112} />
      </LoadingExitTrigger>
    </div>
  );
}
