'use client';

import {
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
const DETAILS_DELAY = 470;
/** Fechando, os detalhes somem e só desmontam quando os cartões assentam. */
const DETAILS_LEAVE = 520;
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
        <Image
          src={art}
          alt=""
          aria-hidden="true"
          fill
          sizes="(max-width: 640px) 100vw, 560px"
          unoptimized
          loading="eager"
          draggable={false}
          // A arte tem a borda arredondada embutida: um respiro esconde.
          className="scale-[1.03] object-cover select-none"
        />
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
        <span className="absolute top-[8%] right-[6%] text-[clamp(13px,4.4cqw,19px)] font-semibold tracking-tight text-neutral-950/85">
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
  order,
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
  // Abrir põe uma entrada no histórico (o voltar do celular fecha o cartão),
  // com o mesmo endereço (mudar a URL faz o Next redesenhar a página, e a
  // tela piscava) e só depois do movimento.
  const pushed = useRef(false);
  const selectedRef = useRef<string | null>(selected);
  const historyTimer = useRef<number | null>(null);
  /** O popstate do nosso próprio `history.back()` não fecha de novo. */
  const ownBack = useRef(false);

  const collapse = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (historyTimer.current) window.clearTimeout(historyTimer.current);
    // Rolado nos detalhes: sobe junto com a volta dos cartões, sem pulo.
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    selectedRef.current = null;
    setSelected(null);
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      setDetails(null);
      setLeaving(false);
      // Fechado pelo X ou Esc: tira a entrada do histórico depois do movimento.
      if (pushed.current) {
        pushed.current = false;
        ownBack.current = true;
        window.history.back();
      }
    }, DETAILS_LEAVE);
  }, []);

  const expand = useCallback((account: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
    setDetails(null);
    setLeaving(false);
    selectedRef.current = account;
    setSelected(account);
    timer.current = window.setTimeout(
      () => startTransition(() => setDetails(account)),
      DETAILS_DELAY,
    );
  }, []);

  const open = (account: string) => {
    expand(account);
    if (historyTimer.current) window.clearTimeout(historyTimer.current);
    historyTimer.current = window.setTimeout(() => {
      window.history.pushState(window.history.state, '');
      pushed.current = true;
    }, DETAILS_LEAVE + 80);
  };

  const close = useCallback(() => {
    // Aberto pelo link (?cartao= sem entrada nossa no histórico): só limpa.
    if (!pushed.current && window.location.search.includes('cartao='))
      window.history.replaceState(null, '', window.location.pathname);
    collapse();
  }, [collapse]);

  useEffect(() => {
    const onPop = () => {
      if (ownBack.current) {
        ownBack.current = false;
        return;
      }
      // Voltar do celular com um cartão aberto: a entrada já saiu do histórico.
      if (pushed.current && selectedRef.current) {
        pushed.current = false;
        collapse();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      if (timer.current) window.clearTimeout(timer.current);
      if (historyTimer.current) window.clearTimeout(historyTimer.current);
    };
  }, [close, collapse]);

  const index = wallet.findIndex((item) => item.card.account === selected);
  const active = index >= 0 ? wallet[index]! : null;
  const count = wallet.length;
  const openTotal = invoiceCards.reduce(
    (sum, item) => sum.plus(item.current.balance),
    new Decimal(0),
  );
  const nextDue = invoiceCards.map((item) => item.current.due).sort()[0];
  const shown = details ? wallet.find((w) => w.card.account === details) : null;
  // Os detalhes só redesenham quando o cartão mostrado muda.
  const detailsNode = useMemo(() => {
    if (!shown) return null;
    const limit: CardLimit | undefined = inputs.limits.find(
      (item) => item.account === shown.card.account,
    );
    return shown.invoices ? (
      <InvoiceDetails
        entry={shown.invoices}
        limit={limit}
        hideCard
        progressive
      />
    ) : (
      <PendingCardPanel card={shown.card} limit={limit} />
    );
  }, [inputs.limits, shown]);

  /** Posição de cada cartão: na pilha, ou abrindo o escolhido. */
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
    if (!active)
      // Voltando, os da frente sobem em cascata.
      return move(`translate3d(0, ${i * PEEK * 100}%, 0)`, 1, {
        delay: index < 0 && leaving ? Math.max(0, i - 1) * 24 : 0,
      });
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
              onClick={close}
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
          <div
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
                      onClick={() => open(item.card.account)}
                      aria-label={`Abrir a fatura do ${item.card.account}`}
                      className="block size-full rounded-[clamp(12px,4.2cqw,20px)] transition-transform duration-150 outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-foreground active:scale-[0.985]"
                    >
                      <CardFace card={item.card} tag={item.tag} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {shown && (
          <div
            key={shown.card.account}
            className={cn(
              'mt-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-300',
              leaving &&
                'pointer-events-none opacity-0 transition-opacity duration-200',
            )}
            aria-hidden={leaving || undefined}
          >
            {detailsNode}
          </div>
        )}
      </div>
    </main>
  );
}
