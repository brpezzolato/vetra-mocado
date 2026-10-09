import { ScanFace } from 'lucide-react';

export function FaceIdAnimation({ muted = false }: { muted?: boolean }) {
  return (
    <div
      className={`relative grid size-24 place-items-center overflow-hidden ${muted ? 'text-white/55' : 'text-white'}`}
      aria-hidden="true"
    >
      <ScanFace
        className={`size-16 ${muted ? '' : 'animate-pulse motion-reduce:animate-none'}`}
      />
      {!muted && (
        <span className="vetra-face-scan absolute inset-x-4 h-px bg-white shadow-[0_0_10px_1px_white] motion-reduce:hidden" />
      )}
    </div>
  );
}

export function FaceIdLoading() {
  return (
    <main
      className="fixed inset-0 z-[1000] grid h-dvh place-items-center bg-black"
      aria-busy="true"
      aria-label="Aguardando Face ID"
    >
      <FaceIdAnimation />
    </main>
  );
}
