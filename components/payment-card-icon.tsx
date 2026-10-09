import Image from 'next/image';
import { CreditCard } from 'lucide-react';
import type { PaymentMethodId } from '@/lib/payment-cards';
import { cn } from '@/lib/utils';

// Pix as a pre-rendered file (scripts/build-pix-card.mjs) so every tile takes
// the same single-image path.
const WALLET_ART = {
  pix: {
    src: '/cards/pix-wallet-ui.png',
    glow: 'rgba(50, 188, 173, .48)',
  },
  flash: {
    src: '/cards/flash-wallet-ui.webp',
    glow: 'rgba(255, 42, 145, .42)',
  },
  itau: {
    src: '/cards/itau-wallet-ui.webp',
    glow: 'rgba(255, 102, 0, .42)',
  },
  nubank: {
    src: '/cards/nubank-wallet-ui.webp',
    glow: 'rgba(151, 30, 255, .48)',
  },
  picpay: {
    src: '/cards/picpay-wallet-ui.webp',
    glow: 'rgba(0, 0, 0, .8)',
  },
} satisfies Partial<Record<PaymentMethodId, { src: string; glow: string }>>;

/** Banco sem arte própria: cartão na cor da marca com o logo no canto. */
const BRAND_TILE = {
  'mercado-pago': {
    background: '#ffe600',
    logo: '/logos/mercado-pago-ui.webp',
    glow: 'rgba(255, 230, 0, .38)',
  },
} satisfies Partial<
  Record<PaymentMethodId, { background: string; logo: string; glow: string }>
>;

export function PaymentCardIcon({
  bankId,
  large = false,
}: {
  bankId: PaymentMethodId;
  large?: boolean;
}) {
  const art = (
    WALLET_ART as Partial<
      Record<PaymentMethodId, { src: string; glow: string }>
    >
  )[bankId];
  const tile = (
    BRAND_TILE as Partial<
      Record<
        PaymentMethodId,
        { background: string; logo: string; glow: string }
      >
    >
  )[bankId];
  if (!art && tile)
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 aspect-[1071/672]',
          large ? 'w-32' : 'w-14',
        )}
        style={{
          filter: `drop-shadow(0 0 ${large ? 10 : 5}px ${tile.glow}) drop-shadow(0 0 2px ${tile.glow})`,
        }}
      >
        <span
          className="relative block size-full overflow-hidden rounded-[4px]"
          style={{ background: tile.background }}
        >
          <Image
            src={tile.logo}
            alt=""
            aria-hidden="true"
            width={64}
            height={64}
            unoptimized
            loading="eager"
            className={cn(
              'absolute object-contain',
              large ? 'top-2.5 left-2.5 size-7' : 'top-1 left-1 size-3.5',
            )}
          />
        </span>
      </span>
    );
  if (!art) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground',
          large ? 'h-20 w-32' : 'h-9 w-14',
        )}
      >
        <CreditCard className={large ? 'size-8' : 'size-5'} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 aspect-[1071/672]',
        large ? 'w-32' : 'w-14',
      )}
      style={{
        filter: `drop-shadow(0 0 ${large ? 10 : 5}px ${art.glow}) drop-shadow(0 0 2px ${art.glow})`,
      }}
    >
      <span className="relative block size-full overflow-hidden rounded-[4px]">
        <Image
          src={art.src}
          alt=""
          aria-hidden="true"
          width={384}
          height={241}
          unoptimized
          loading="eager"
          className={cn(
            'block h-full w-full object-contain',
            bankId === 'picpay' && 'scale-[1.025]',
          )}
        />
        {bankId === 'picpay' && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 rounded-[4px] border"
            style={{ borderColor: 'rgba(148, 148, 148, .32)' }}
          />
        )}
      </span>
    </span>
  );
}
