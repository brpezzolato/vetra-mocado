'use client';
import { useEffect, useState, useRef, useCallback, useTransition } from 'react';
import { refreshMountedWidgets } from '@/lib/manual-refresh';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  CalendarDays,
  CloudDownload,
  Wallet,
  Menu,
  RefreshCw,
  Settings,
  WalletCards,
  ReceiptText,
  PiggyBank,
  Sun,
  Moon,
  LogOut,
  ChartNoAxesCombined,
  CreditCard,
  Calculator,
  Repeat2,
  Sparkles,
  ListChecks,
  Plus,
} from 'lucide-react';
import Link from '@/components/navigation-link';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { publishSyncProgress } from '@/lib/sync-progress';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetClose,
} from '@/components/ui/sheet';
import { createClient } from '@/lib/supabase/client';
import { NotificationCenter } from '@/components/notification-center';
import { VetraMark } from '@/components/vetra-mark';
import { updateApp } from '@/lib/app-update';
import { useInstalledApp } from '@/lib/installed-app';
import { Skeleton } from '@/components/ui/skeleton';
import { FinancialChatSheet } from '@/components/financial-chat-sheet';
import { PrivacyModeToggle } from '@/components/privacy-mode-toggle';
import { CloseSymbol, GlassButton } from '@/components/ui/glass-button';

type BankMenuItem = { id: string; name: string; bank: string };
const BANK_MENU_CACHE_KEY = 'vetra:bank-menu-cache';
const BANK_MENU_CACHE_MS = 300_000;

/** Atalhos da barra no desktop; o resto continua no menu. */
const DESKTOP_NAV = [
  { href: '/', label: 'Início' },
  { href: '/financeiro', label: 'Gastos' },
  { href: '/resumo', label: 'Resumo' },
  { href: '/faturas', label: 'Faturas' },
  { href: '/cofrinhos', label: 'Cofrinhos' },
  { href: '/graficos', label: 'Gráficos' },
];

export function AppHeader({
  onRefresh,
  onSignOut,
  onAdd,
}: {
  onRefresh: () => void | Promise<unknown>;
  onSignOut?: () => void;
  /** Mostra o "+" de registrar gasto. */
  onAdd?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const installed = useInstalledApp();
  const [updatingApp, setUpdatingApp] = useState(false);
  const [dark, setDark] = useState(true);
  const [banks, setBanks] = useState<BankMenuItem[]>([]);
  const [banksReady, setBanksReady] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [refreshError, setRefreshError] = useState('');
  const refreshBusy = useRef(false);
  // Progresso da atualização vai para o balão do mascote (lib/sync-progress.ts).
  // Cada etapa diz até onde anda e em quanto tempo (nenhuma informa porcentagem).
  const advance = (value: number, duration: number, label: string) =>
    publishSyncProgress({ value, duration, label });
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    queueMicrotask(() =>
      setDark(document.documentElement.classList.contains('dark')),
    );
  }, []);
  const lastBankLoad = useRef(0);
  const bankLoad = useRef(false);
  const loadBanks = useCallback(async (force = false) => {
    if (
      bankLoad.current ||
      (!force && Date.now() - lastBankLoad.current < BANK_MENU_CACHE_MS)
    )
      return;
    bankLoad.current = true;
    try {
      const { data, error } = await createClient()
        .from('piggy_banks')
        .select('id,name,bank')
        .is('archived_at', null);
      if (!error) {
        setBanks(data ?? []);
        lastBankLoad.current = Date.now();
      }
    } finally {
      bankLoad.current = false;
      setBanksReady(true);
    }
  }, []);
  useEffect(() => {
    const preload = () => {
      for (const src of [
        '/logos/nubank-ui.webp',
        '/logos/mercado-pago-ui.webp',
        '/cards/flash-wallet-ui.webp',
        '/cards/itau-wallet-ui.webp',
        '/cards/nubank-wallet-ui.webp',
        '/cards/picpay-verde-wallet-ui.webp',
        '/cards/pix-wallet-ui.png',
      ]) {
        const logo = new window.Image();
        logo.src = src;
      }
    };
    const idle = window.setTimeout(preload, 1200);
    return () => window.clearTimeout(idle);
  }, []);
  useEffect(() => {
    if (open && !banksReady) void loadBanks();
  }, [open, banksReady, loadBanks]);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      mobileNavRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  const bankMenu = () => (
    <div>
      <Link
        href="/cofrinhos"
        onClick={() => setOpen(false)}
        className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm hover:bg-muted"
      >
        <PiggyBank className="size-4" />
        <span>Cofrinhos</span>
      </Link>
      <div className="ml-5 border-l pl-2">
        {!banksReady &&
          [0, 1].map((item) => (
            <div
              key={item}
              className="flex min-h-11 items-center gap-2 px-3"
              aria-hidden="true"
            >
              <Skeleton className="size-7 shrink-0 rounded-lg" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          ))}
        {banks.map((bank) => (
          <Link
            key={bank.id}
            href={`/cofrinhos/${bank.id}`}
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-muted"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted p-1">
              {bank.bank === 'Nubank' || bank.bank === 'Mercado Pago' ? (
                <Image
                  src={
                    bank.bank === 'Nubank'
                      ? '/logos/nubank-ui.webp'
                      : '/logos/mercado-pago-ui.webp'
                  }
                  alt=""
                  width={24}
                  height={24}
                  unoptimized
                  loading="eager"
                  className="size-full object-contain"
                />
              ) : (
                <PiggyBank className="size-4" />
              )}
            </span>
            <span className="truncate">{bank.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
  const theme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.style.colorScheme = next ? 'dark' : 'light';
  };
  const logout = async () => {
    if (onSignOut) {
      onSignOut();
      return;
    }
    const { error } = await createClient().auth.signOut();
    if (!error) {
      localStorage.removeItem('vetra:dashboard-cache');
      sessionStorage.removeItem(BANK_MENU_CACHE_KEY);
      router.replace('/auth');
    }
  };
  // Menu em grupos: item principal e telas relacionadas recuadas.
  const groups: {
    href: string;
    label: string;
    icon: typeof WalletCards;
    children: { href: string; label: string; icon: typeof WalletCards }[];
  }[] = [
    {
      href: '/financeiro',
      label: 'Controle de gastos',
      icon: ReceiptText,
      children: [
        { href: '/resumo', label: 'Resumo', icon: CalendarDays },
        { href: '/graficos', label: 'Gráficos', icon: ChartNoAxesCombined },
        { href: '/retrospectiva', label: 'Retrospectiva', icon: Sparkles },
        { href: '/revisao', label: 'Revisar compras', icon: ListChecks },
      ],
    },
    {
      href: '/faturas',
      label: 'Faturas',
      icon: CreditCard,
      children: [
        { href: '/assinaturas', label: 'Assinaturas', icon: Repeat2 },
        { href: '/beneficios', label: 'Benefícios (Flash)', icon: Wallet },
        { href: '/simulador', label: 'Simulador de compra', icon: Calculator },
        { href: '/cobertura', label: 'Cofrinho × faturas', icon: PiggyBank },
        { href: '/carteira', label: 'Carteira (teste)', icon: WalletCards },
      ],
    },
  ];
  const menuGroup = (group: (typeof groups)[number]) => (
    <div key={group.href}>
      <Link
        href={group.href}
        onClick={() => setOpen(false)}
        className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm hover:bg-muted"
      >
        <group.icon className="size-4" />
        <span>{group.label}</span>
      </Link>
      <div className="ml-5 border-l pl-2">
        {group.children.map((child) => (
          <Link
            key={child.href}
            href={child.href}
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-muted"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted">
              <child.icon className="size-3.5" />
            </span>
            <span className="truncate">{child.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
  return (
    <header className="vetra-app-safe-header sticky top-0 z-40 border-b bg-background">
      <div className="app-container flex h-[72px] items-center justify-between gap-2">
        <Link
          href="/"
          aria-label="Vetra — início"
          className="flex items-center gap-2"
        >
          {/* Símbolo do Vetra ao lado da palavra. */}
          <VetraMark className="size-7" />
          <span className="text-2xl font-semibold tracking-[-0.04em]">
            Vetra
          </span>
        </Link>
        {/* Desktop: atalhos das telas principais. No celular, só o menu. */}
        <nav
          aria-label="Principal"
          className="hidden flex-1 items-center justify-center gap-1 lg:flex"
        >
          {DESKTOP_NAV.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-full px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
                  active && 'bg-muted font-medium text-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1">
            {/* Guarda o painel do chat; a bolha flutuante abre por portal. */}
            <FinancialChatSheet />
            {/* Registrar gasto: só o símbolo. */}
            {onAdd && (
              <Button
                variant="ghost"
                size="icon"
                className="vetra-glass-on-glass size-9"
                aria-label="Registrar gasto"
                onClick={onAdd}
              >
                <Plus />
              </Button>
            )}
            <NotificationCenter />
            <PrivacyModeToggle className="vetra-glass-on-glass size-9" />
            <Button
              variant="ghost"
              size="icon"
              className="vetra-glass-on-glass size-9"
              aria-label={refreshing ? 'Atualizando dados' : 'Atualizar dados'}
              aria-busy={refreshing}
              disabled={refreshing}
              onClick={() => {
                if (refreshBusy.current) return;
                refreshBusy.current = true;
                setRefreshError('');
                publishSyncProgress({
                  value: 2,
                  duration: 0,
                  label: 'Pedindo atualização aos bancos…',
                });
                window.requestAnimationFrame(() =>
                  advance(45, 45_000, 'Pedindo atualização aos bancos…'),
                );
                // A rodada conta do clique (uma linha por clique em /conexoes).
                const roundStartedAt = new Date().toISOString();
                startRefresh(async () => {
                  try {
                    // Primeiro o robô pede atualização ao Meu Pluggy (lib/pluggy/robot.ts).
                    // Sem robô ou dentro dos 10 min, só segue. Se pediu, espera os bancos.
                    let robotLabel: string | null = null;
                    const robot = await fetch('/api/pluggy/robot', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ action: 'refresh' }),
                    })
                      .then((response) => {
                        // 429: pediu há menos de 10 min.
                        if (response.status === 429)
                          robotLabel = 'skipped:too_soon';
                        return response.ok
                          ? (response.json() as Promise<{
                              ok?: boolean;
                              reason?: string | null;
                              clicked?: number;
                            }>)
                          : null;
                      })
                      .catch(() => null);
                    if (robot)
                      robotLabel = robot.ok
                        ? 'done'
                        : robot.reason === 'daily_cap' ||
                            robot.reason === 'manual_cap'
                          ? `skipped:${robot.reason}`
                          : `failed:${robot.reason ?? 'error'}`;
                    if (robot?.clicked) {
                      advance(60, 8000, 'Esperando os bancos responderem…');
                      await new Promise((resolve) =>
                        window.setTimeout(resolve, 8000),
                      );
                    }
                    advance(85, 15_000, 'Trazendo os dados novos…');
                    // Depois traz da Pluggy o que o banco já tem. Falha aqui não impede o resto.
                    await fetch('/api/pluggy/sync', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        startedAt: roundStartedAt,
                        robot: robotLabel,
                      }),
                    }).catch(() => undefined);
                    advance(97, 4000, 'Atualizando a tela…');
                    await Promise.all([
                      Promise.resolve().then(onRefresh),
                      refreshMountedWidgets(),
                      loadBanks(true),
                    ]);
                    window.dispatchEvent(new Event('vetra:notifications'));
                  } catch {
                    setRefreshError(
                      'Não foi possível atualizar todos os dados. Tente novamente.',
                    );
                  } finally {
                    refreshBusy.current = false;
                    advance(100, 250, 'Dados atualizados.');
                    window.setTimeout(() => publishSyncProgress(null), 2200);
                  }
                });
              }}
            >
              <RefreshCw
                className={
                  refreshing ? 'animate-spin motion-reduce:animate-none' : ''
                }
              />
            </Button>
          </div>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="vetra-glass-on-glass size-9"
                  aria-label="Abrir menu"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent
              side="right"
              showCloseButton={false}
              className="h-dvh w-[86%] max-w-sm gap-0 overflow-hidden pt-0"
            >
              <div className="vetra-mobile-menu-fixed-top shrink-0 px-4">
                <div className="flex min-h-10 items-center justify-between">
                  <SheetTitle className="text-xs uppercase text-muted-foreground">
                    Carteira
                  </SheetTitle>
                  <SheetClose
                    render={
                      <GlassButton
                        shape="circle"
                        className="size-9"
                        aria-label="Fechar menu"
                      />
                    }
                  >
                    <CloseSymbol />
                  </SheetClose>
                </div>
              </div>
              {/* Ref no viewport: é ele quem rola (scrollTo ao topo). */}
              <ScrollArea
                viewportRef={mobileNavRef}
                className="min-h-0 flex-1"
                viewportClassName="overscroll-contain px-4 pt-0 pb-3"
              >
                <nav aria-label="Menu">
                  <Link
                    href="/"
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm hover:bg-muted"
                  >
                    <WalletCards className="size-4" />
                    Início
                  </Link>
                  {bankMenu()}
                  {groups.map(menuGroup)}
                </nav>
              </ScrollArea>
              {/* Rodapé: tema, privacidade, atualizar o app (só instalado;
                  lib/app-update.ts), configurações e sair. */}
              <div
                className={cn(
                  'grid shrink-0 gap-2 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]',
                  installed ? 'grid-cols-5' : 'grid-cols-4',
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-full"
                  aria-label={dark ? 'Ativar modo claro' : 'Ativar modo escuro'}
                  title={dark ? 'Modo claro' : 'Modo escuro'}
                  onClick={theme}
                >
                  {dark ? <Sun /> : <Moon />}
                </Button>
                <PrivacyModeToggle className="h-11 w-full" />
                {installed && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-full"
                    aria-label="Atualizar o app"
                    title="Atualizar o app: busca a versão mais nova e limpa o cache"
                    disabled={updatingApp}
                    onClick={() => {
                      setUpdatingApp(true);
                      void updateApp();
                    }}
                  >
                    <CloudDownload
                      className={cn(updatingApp && 'animate-pulse')}
                    />
                  </Button>
                )}
                <Link
                  href="/configuracoes"
                  onClick={() => setOpen(false)}
                  aria-label="Configurações"
                  title="Configurações"
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'icon' }),
                    'h-11 w-full',
                  )}
                >
                  <Settings />
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-full"
                  aria-label="Sair"
                  title="Sair"
                  onClick={() => void logout()}
                >
                  <LogOut />
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      {refreshError && (
        <p role="alert" className="app-container pb-2 text-sm text-destructive">
          {refreshError}
        </p>
      )}
    </header>
  );
}
