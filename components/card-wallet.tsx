'use client';

import {
  Activity,
  memo,
  startTransition,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { CreditCard } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import {
  InvoiceDetails,
  PendingCardPanel,
  useInvoiceCards,
  type CardLimit,
} from '@/components/invoice-center';
import { Private } from '@/components/private-value';
import { CloseSymbol, GlassButton } from '@/components/ui/glass-button';
import type { CardInvoiceInputs } from '@/lib/card-invoices-query';
import { createClient } from '@/lib/supabase/client';
import type { CreditCardInvoices } from '@/lib/card-invoices';
import type { PaymentCard } from '@/lib/payment-cards';
import { cn } from '@/lib/utils';

/* Carteira (teste; se aprovada, substitui /faturas): os cartões empilhados
   como no Apple Wallet. Tocar sobe o cartão para o topo, os de cima somem
   para trás, os de baixo descem para fora da tela e os detalhes da fatura
   aparecem embaixo.

   Desempenho: os cartões se movem só por `transform` e `opacity` (o
   navegador anima isso no compositor, fora da thread principal), com as
   posições em porcentagem da própria altura, sem medir nada em JS. Os
   detalhes, que são pesados, só montam depois que o movimento já começou. */

/** Proporção do cartão (as artes de public/cards têm 1071 × 672). */
const RATIO = 1071 / 672;
/** Quanto de cada cartão aparece na pilha, em fração da altura. */
const PEEK = 0.3;
/**
 * Quando os detalhes montam depois do toque: com o cartão quase no lugar,
 * para a montagem (o trabalho pesado) não cair no meio do movimento.
 */
const DETAILS_DELAY = 400;
/** Fechando, os detalhes somem e só desmontam quando os cartões assentam. */
const DETAILS_LEAVE = 520;
/** Segurar este tempo levanta o cartão para arrastar (como no Apple Wallet). */
const HOLD_MS = 380;
/** Mexer mais que isso antes do tempo é rolagem, não segurar. */
const HOLD_SLOP = 8;
/** Curva do iOS; a do cartão escolhido passa um tiquinho e volta. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const EASE_SPRING = 'cubic-bezier(0.34, 1.18, 0.64, 1)';

const CARD_ART: Partial<Record<PaymentCard['bank_id'], string>> = {
  nubank: '/cards/nubank-wallet-lg.webp',
  itau: '/cards/itau-wallet-lg.webp',
  picpay: '/cards/picpay-wallet-lg.webp',
  flash: '/cards/flash-wallet-lg.webp',
};
/** Banco sem arte: a cor da marca com o logo no canto. */
const CARD_BRAND: Partial<
  Record<PaymentCard['bank_id'], { colour: string; logo: string }>
> = {
  'mercado-pago': { colour: '#ffe600', logo: '/logos/mercado-pago-ui.webp' },
};

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value).toNumber());
const dayMonth = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replace('.', '');

type WalletCard = {
  card: PaymentCard;
  invoices: CreditCardInvoices | null;
  /** Rótulo no canto quando há dois cartões do mesmo banco. */
  tag: string | null;
};

/** O nome que separa dois cartões do mesmo banco ("Platinum", "Crédito"). */
function cardTag(card: PaymentCard, all: PaymentCard[]) {
  const same = all.filter((item) => item.bank_id === card.bank_id);
  if (same.length < 2) return null;
  const words = card.account
    .split(/\s+/)
    .filter(
      (word) =>
        !/^(itaú|itau|nubank|picpay|mastercard|visa|cartão|multiplo|múltiplo)$/i.test(
          word,
        ),
    );
  const pick =
    words.find((word) => !/^crédito$/i.test(word)) ?? words[0] ?? card.account;
  return pick.replace(/^./, (first) => first.toUpperCase());
}

/**
 * A face do cartão: a arte, ou a cor da marca, ou um cartão neutro. `memo`:
 * abrir e fechar só mudam a posição, nunca a face.
 */
const CardFace = memo(function CardFace({
  card,
  tag,
}: {
  card: PaymentCard;
  tag: string | null;
}) {
  const art = CARD_ART[card.bank_id];
  const brand = CARD_BRAND[card.bank_id];
  return (
    <span
      className="relative block size-full overflow-hidden rounded-[clamp(12px,4.2cqw,20px)] shadow-[0_10px_30px_-8px_rgb(0_0_0/0.55)]"
      style={{ background: brand?.colour ?? 'var(--muted)' }}
    >
      {art ? (
        // A arte tem a borda arredondada embutida: uma moldura 3% maior que
        // o cartão esconde. Por tamanho e não por `scale`: transformação
        // dentro do cartão que se move, com cantos recortados, faz o Safari
        // recortar a cada quadro.
        <span className="absolute -inset-[1.5%]">
          <Image
            src={art}
            alt=""
            aria-hidden="true"
            fill
            sizes="(max-width: 640px) 100vw, 560px"
            unoptimized
            loading="eager"
            draggable={false}
            className="object-cover select-none"
          />
        </span>
      ) : brand ? (
        <Image
          src={brand.logo}
          alt=""
          aria-hidden="true"
          width={96}
          height={96}
          unoptimized
          loading="eager"
          draggable={false}
          className="absolute top-[8%] left-[6%] h-[20%] w-auto object-contain select-none"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-muted-foreground">
          <CreditCard className="size-10" />
        </span>
      )}
      {(tag || (!art && !brand)) && (
        // Impresso no cartão: texto escuro simples, sem pílula.
        <span className="absolute top-[9%] right-[6%] text-[clamp(10px,3.1cqw,13px)] font-medium tracking-wide text-neutral-950/55">
          {tag ?? card.account}
        </span>
      )}
    </span>
  );
});

/**
 * Da frente para trás: a ordem salva na conta (`user_preferences`, chave
 * `wallet`); sem ela, o mais usado na frente, sem dois cartões do mesmo banco
 * colados quando der (dois laranjas do Itaú lado a lado se confundem).
 */
function walletOrder(
  items: WalletCard[],
  saved: string[] | null,
  entries: CardInvoiceInputs['entries'],
) {
  if (saved?.length) {
    const rank = (account: string) => {
      const at = saved.indexOf(account);
      return at < 0 ? saved.length : at;
    };
    return [...items].sort(
      (a, b) => rank(a.card.account) - rank(b.card.account),
    );
  }
  const uses = new Map<string, number>();
  for (const entry of entries)
    if (entry.entry_type === 'expense')
      uses.set(entry.account, (uses.get(entry.account) ?? 0) + 1);
  const left = [...items].sort(
    (a, b) => (uses.get(b.card.account) ?? 0) - (uses.get(a.card.account) ?? 0),
  );
  const out: WalletCard[] = [];
  while (left.length) {
    const previous = out.at(-1)?.card.bank_id;
    const at = left.findIndex((item) => item.card.bank_id !== previous);
    out.push(...left.splice(at < 0 ? 0 : at, 1));
  }
  return out;
}

export function CardWallet({
  inputs,
  order: savedOrder,
  initialAccount,
  initialError,
}: {
  inputs: CardInvoiceInputs;
  /** Ordem salva, da frente para trás (contas). */
  order: string[] | null;
  initialAccount: string | null;
  initialError: string;
}) {
  const router = useRouter();
  // Abrir e fechar mudam estado aqui: o cabeçalho e os detalhes ficam
  // memorizados para não redesenhar junto (seria trabalho no meio do movimento).
  const header = useMemo(
    () => <AppHeader onRefresh={() => router.refresh()} />,
    [router],
  );
  const { invoiceCards, pendingCards } = useInvoiceCards(inputs);
  const client = useMemo(() => createClient(), []);
  // Da frente para trás; arrastar troca aqui e grava na conta.
  const [order, setOrder] = useState(savedOrder);
  // A pilha vai de trás (topo) para a frente (o cartão inteiro, embaixo).
  const wallet: WalletCard[] = useMemo(() => {
    const all = [...invoiceCards.map((item) => item.card), ...pendingCards];
    const items: WalletCard[] = [
      ...invoiceCards.map((item) => ({
        card: item.card,
        invoices: item,
        tag: cardTag(item.card, all),
      })),
      ...pendingCards.map((card) => ({
        card,
        invoices: null,
        tag: cardTag(card, all),
      })),
    ];
    return walletOrder(items, order, inputs.entries).reverse();
  }, [inputs.entries, invoiceCards, order, pendingCards]);
  const known = (account: string | null) =>
    account && wallet.some((item) => item.card.account === account)
      ? account
      : null;

  // `selected` move os cartões na hora; `details` monta os detalhes depois.
  const [selected, setSelected] = useState<string | null>(() =>
    known(initialAccount),
  );
  const [details, setDetails] = useState<string | null>(() =>
    known(initialAccount),
  );
  // Fechando: os detalhes esmaecem antes de desmontar.
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | null>(null);
  // Sem histórico do navegador: qualquer `pushState`/`replaceState` faz o
  // roteador do Next redesenhar a página, e no meio da animação isso
  // reiniciava o esmaecer dos detalhes (a tela "piscava"; visto quadro a
  // quadro, 23/10/2026). Fecha pelo X ou pelo Esc.

  const collapse = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    // Rolado nos detalhes: sobe junto com a volta dos cartões, sem pulo.
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    setSelected(null);
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      setDetails(null);
      setLeaving(false);
      // Aberto pelo link (?cartao=): limpa o endereço só com tudo parado.
      if (window.location.search.includes('cartao='))
        window.history.replaceState(null, '', window.location.pathname);
    }, DETAILS_LEAVE);
  }, []);

  const open = (account: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
    setDetails(null);
    setLeaving(false);
    setSelected(account);
    timer.current = window.setTimeout(
      () => startTransition(() => setDetails(account)),
      DETAILS_DELAY,
    );
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') collapse();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [collapse]);

  const index = wallet.findIndex((item) => item.card.account === selected);
  const active = index >= 0 ? wallet[index]! : null;
  const count = wallet.length;
  const openTotal = invoiceCards.reduce(
    (sum, item) => sum.plus(item.current.balance),
    new Decimal(0),
  );
  const nextDue = invoiceCards.map((item) => item.current.due).sort()[0];
  // Os detalhes de todos os cartões ficam montados e escondidos (`Activity`
  // hidden: o React os prepara em segundo plano depois da tela pronta). Abrir
  // só revela o painel pronto, sem montar nada pesado durante a animação, o
  // que no iPhone travava o movimento e fazia os detalhes "bugarem".
  const panels = useMemo(
    () =>
      wallet.map((item) => {
        const limit: CardLimit | undefined = inputs.limits.find(
          (row) => row.account === item.card.account,
        );
        return {
          account: item.card.account,
          node: item.invoices ? (
            <InvoiceDetails entry={item.invoices} limit={limit} hideCard />
          ) : (
            <PendingCardPanel card={item.card} limit={limit} />
          ),
        };
      }),
    [inputs.limits, wallet],
  );

  /** Posição de cada cartão: na pilha, ou abrindo o escolhido. */
  // Arrastar para reordenar: segurar levanta o cartão; ele segue o dedo por
  // uma variável CSS (`--drag-y`, sem redesenhar o React a cada movimento) e
  // os outros abrem espaço quando ele passa de uma faixa.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragging = useRef<{
    from: number;
    to: number;
    startY: number;
    step: number;
    el: HTMLElement;
  } | null>(null);
  const press = useRef<{
    timer: number;
    x: number;
    y: number;
  } | null>(null);
  /** O clique que vem depois de soltar um arrasto não abre a fatura. */
  const swallowClick = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const saveOrder = useCallback(
    (stack: WalletCard[]) => {
      // A pilha vai de trás para a frente; a ordem salva, da frente para trás.
      const next = stack.map((item) => item.card.account).reverse();
      setOrder(next);
      void client
        .from('user_preferences')
        .upsert(
          {
            key: 'wallet',
            value: { order: next },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,key' },
        )
        .then(() => undefined);
    },
    [client],
  );

  const moveCard = (from: number, to: number) => {
    if (from === to) return;
    const stack = [...wallet];
    const [moved] = stack.splice(from, 1);
    stack.splice(to, 0, moved!);
    saveOrder(stack);
  };

  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const onCardPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    i: number,
  ) => {
    if (active || (event.pointerType === 'mouse' && event.button !== 0)) return;
    endPress();
    // O botão captura o dedo (os eventos seguem vindo para ele); quem se move
    // é o invólucro posicionado.
    const target = event.currentTarget;
    const el = target.parentElement!;
    const pointer = event.pointerId;
    const startY = event.clientY;
    press.current = {
      x: event.clientX,
      y: startY,
      timer: window.setTimeout(() => {
        press.current = null;
        try {
          target.setPointerCapture(pointer);
        } catch {}
        dragging.current = {
          from: i,
          to: i,
          startY,
          step: el.getBoundingClientRect().height * PEEK,
          el,
        };
        el.style.setProperty('--drag-y', '0px');
        navigator.vibrate?.(8);
        setDrag({ from: i, to: i });
      }, HOLD_MS),
    };
  };

  const onCardPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const held = press.current;
    if (held) {
      if (
        Math.abs(event.clientX - held.x) > HOLD_SLOP ||
        Math.abs(event.clientY - held.y) > HOLD_SLOP
      )
        endPress();
      return;
    }
    const current = dragging.current;
    if (!current) return;
    const dy = event.clientY - current.startY;
    current.el.style.setProperty('--drag-y', `${dy}px`);
    const to = Math.max(
      0,
      Math.min(wallet.length - 1, Math.round(current.from + dy / current.step)),
    );
    if (to !== current.to) {
      current.to = to;
      navigator.vibrate?.(4);
      setDrag({ from: current.from, to });
    }
  };

  const onCardPointerUp = () => {
    endPress();
    const current = dragging.current;
    if (!current) return;
    dragging.current = null;
    swallowClick.current = true;
    window.setTimeout(() => (swallowClick.current = false), 0);
    moveCard(current.from, current.to);
    setDrag(null);
    // Depois que o React tirou a variável da posição, limpa.
    requestAnimationFrame(() => current.el.style.removeProperty('--drag-y'));
  };

  // Arrastando, o dedo não rola a página (o touchmove precisa ser não
  // passivo para poder cancelar a rolagem no iPhone).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const block = (event: TouchEvent) => {
      if (dragging.current) event.preventDefault();
    };
    stage.addEventListener('touchmove', block, { passive: false });
    return () => stage.removeEventListener('touchmove', block);
  }, [wallet.length]);

  /** Onde cada cartão fica na pilha, contando o espaço aberto pelo arrasto. */
  const slot = (i: number) => {
    if (!drag || i === drag.from) return i;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return i - 1;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return i + 1;
    return i;
  };

  /**
   * Posição de cada cartão: na pilha, ou abrindo o escolhido. Os que saem
   * deslizam um pouco, esmaecem e ficam `visibility: hidden` no fim (senão,
   * rolando os detalhes, eles reapareciam no meio da tela). A troca de
   * visibilidade vai junto na transição, com atraso: some só no fim e
   * reaparece já no começo da volta.
   */
  const place = (i: number): CSSProperties => {
    const move = (
      transform: string,
      opacity: number,
      { duration = 440, fade = 260, delay = 0, ease = EASE } = {},
    ): CSSProperties => ({
      zIndex: i + 1,
      transform,
      opacity,
      visibility: opacity === 0 ? 'hidden' : 'visible',
      transitionProperty: 'transform, opacity, visibility',
      transitionDuration: `${duration}ms, ${fade}ms, 0s`,
      transitionTimingFunction: `${ease}, ease, linear`,
      transitionDelay: `${delay}ms, ${delay}ms, ${opacity === 0 ? delay + fade : 0}ms`,
    });
    if (drag && i === drag.from)
      // O cartão levantado segue o dedo, um pouco maior e por cima de todos.
      return {
        zIndex: 100,
        transform: `translate3d(0, calc(${i * PEEK * 100}% + var(--drag-y, 0px)), 0) scale(1.04)`,
        opacity: 1,
        visibility: 'visible',
        transition: 'none',
      };
    if (!active)
      // Voltando, os da frente sobem em cascata.
      return {
        ...move(`translate3d(0, ${slot(i) * PEEK * 100}%, 0)`, 1, {
          delay: index < 0 && leaving ? Math.max(0, i - 1) * 24 : 0,
          duration: drag ? 280 : 440,
        }),
        zIndex: slot(i) + 1,
      };
    if (i === index)
      return move('translate3d(0, 0, 0)', 1, {
        duration: 500,
        ease: EASE_SPRING,
      });
    if (i < index)
      // Os de trás recuam um pouco e somem.
      return move(
        `translate3d(0, ${(i * PEEK - 0.12) * 100}%, 0) scale(0.94)`,
        0,
        { duration: 380, fade: 220 },
      );
    // Os da frente descem e somem.
    return move(`translate3d(0, ${((i - index) * PEEK + 0.5) * 100}%, 0)`, 0, {
      duration: 380,
      fade: 240,
      delay: (i - index - 1) * 16,
    });
  };

  return (
    // overflow-clip (não hidden): os cartões que descem não esticam a página
    // e o AppHeader segue sticky.
    <main className="min-h-dvh overflow-clip bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      {header}
      <div className="app-container max-w-xl py-5 md:py-8">
        {initialError && (
          <p className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            Não foi possível carregar todas as informações das faturas.
          </p>
        )}

        {/* Título da pilha e, aberto, o fechar com o nome do cartão. */}
        <div className="relative mb-5 h-14">
          <div
            className={cn(
              'absolute inset-0 flex items-end justify-between gap-3 transition-[opacity,transform] duration-300 motion-reduce:transition-none',
              active
                ? 'pointer-events-none -translate-y-1 opacity-0'
                : 'opacity-100',
            )}
            aria-hidden={active ? true : undefined}
          >
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Teste</p>
              <h1 className="text-3xl font-semibold tracking-tight">
                Carteira
              </h1>
            </div>
            {invoiceCards.length > 0 && (
              <div className="shrink-0 text-right">
                <p className="text-[11px] text-muted-foreground">
                  Faturas atuais
                  {nextDue ? ` · vence ${dayMonth(nextDue)}` : ''}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  <Private>{money(openTotal)}</Private>
                </p>
              </div>
            )}
          </div>
          <div
            className={cn(
              'absolute inset-0 flex items-center gap-3 transition-[opacity,transform] duration-300 motion-reduce:transition-none',
              active
                ? 'opacity-100'
                : 'pointer-events-none translate-y-1 opacity-0',
            )}
            aria-hidden={active ? undefined : true}
          >
            {/* O mesmo X dos diálogos do app. */}
            <GlassButton
              type="button"
              shape="circle"
              className="size-9 shrink-0"
              aria-label="Fechar e voltar aos cartões"
              tabIndex={active ? 0 : -1}
              onClick={collapse}
            >
              <CloseSymbol />
            </GlassButton>
            <p className="min-w-0 truncate text-base font-semibold">
              {active?.card.account}
            </p>
          </div>
        </div>

        {count === 0 ? (
          <p className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground">
            Nenhum cartão de crédito ainda.
          </p>
        ) : (
          <>
            <p id="wallet-reorder-hint" className="sr-only">
              Segure e arraste o cartão para mudar a ordem, ou use Alt e as
              setas.
            </p>
            <div
              ref={stageRef}
              className="relative [container-type:inline-size]"
              style={{
                // A pilha ocupa a altura de um cartão mais as faixas dos outros;
                // aberto (e fechando), só a do cartão: os detalhes não pulam
                // para baixo enquanto somem sob os cartões que voltam.
                aspectRatio:
                  active || leaving
                    ? `${RATIO}`
                    : `${RATIO} / ${1 + (count - 1) * PEEK}`,
              }}
            >
              {wallet.map((item, i) => {
                const chosen = i === index;
                const hidden = Boolean(active) && !chosen;
                return (
                  <div
                    key={item.card.account}
                    className="absolute inset-x-0 top-0 will-change-transform motion-reduce:transition-none!"
                    style={{ aspectRatio: `${RATIO}`, ...place(i) }}
                    aria-hidden={hidden || undefined}
                  >
                    {active ? (
                      // Aberto, o nome do cartão está na barra do fechar.
                      <div className="size-full">
                        <CardFace card={item.card} tag={item.tag} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (swallowClick.current || drag) return;
                          open(item.card.account);
                        }}
                        onPointerDown={(event) => onCardPointerDown(event, i)}
                        onPointerMove={onCardPointerMove}
                        onPointerUp={onCardPointerUp}
                        onPointerCancel={onCardPointerUp}
                        onContextMenu={(event) => event.preventDefault()}
                        // Teclado: Alt + setas muda o cartão de lugar.
                        onKeyDown={(event) => {
                          if (!event.altKey) return;
                          if (event.key === 'ArrowUp' && i > 0) {
                            event.preventDefault();
                            moveCard(i, i - 1);
                          } else if (
                            event.key === 'ArrowDown' &&
                            i < wallet.length - 1
                          ) {
                            event.preventDefault();
                            moveCard(i, i + 1);
                          }
                        }}
                        aria-label={`Abrir a fatura do ${item.card.account}`}
                        aria-describedby="wallet-reorder-hint"
                        className={cn(
                          'block size-full rounded-[clamp(12px,4.2cqw,20px)] transition-shadow duration-150 outline-none select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-foreground',
                          drag?.from === i
                            ? 'shadow-[0_24px_48px_-12px_rgb(0_0_0/0.7)]'
                            : undefined,
                        )}
                      >
                        <CardFace card={item.card} tag={item.tag} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className={details ? 'mt-6' : undefined}>
          {panels.map((panel) => {
            const visible = details === panel.account;
            return (
              <Activity
                key={panel.account}
                mode={visible ? 'visible' : 'hidden'}
              >
                {/* De escondido para visível a animação de entrada roda uma
                    vez; fechando, esmaece sob os cartões que voltam. */}
                <div
                  className={cn(
                    'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300',
                    visible &&
                      leaving &&
                      'pointer-events-none opacity-0 transition-opacity duration-200',
                  )}
                  aria-hidden={(visible && leaving) || undefined}
                >
                  {panel.node}
                </div>
              </Activity>
            );
          })}
        </div>
      </div>
    </main>
  );
}
