'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useEffectEvent,
} from 'react';
import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import Link from '@/components/navigation-link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  NOTICE_DESTINATIONS,
  noticeIcon,
  noticeWhen,
  type Notice,
} from '@/lib/notifications';

/* Sininho: as notificações mais recentes e o link para /notificacoes. Abrir
   marca as mostradas como lidas; arquivadas não aparecem nem contam. */

const RECENT = 4;

export function NotificationCenter() {
  const db = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const lastLoaded = useRef(0);

  const loadCount = useCallback(async () => {
    const count = await db
      .from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .is('archived_at', null);
    if (!count.error) setUnread(count.count ?? 0);
  }, [db]);

  const load = useCallback(async () => {
    const list = await db
      .from('app_notifications')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(RECENT);
    if (list.error) setError(true);
    else {
      setItems((list.data ?? []) as Notice[]);
      setError(false);
      lastLoaded.current = Date.now();
    }
    setLoaded(true);
    await loadCount();
    return (list.data ?? []) as Notice[];
  }, [db, loadCount]);

  /** Abriu: carrega (se preciso) e marca as não lidas mostradas como lidas. */
  const seen = useCallback(async () => {
    const shown =
      Date.now() - lastLoaded.current < 60_000 ? items : await load();
    const ids = shown.filter((notice) => !notice.read_at).map((n) => n.id);
    if (!ids.length) return;
    const result = await db
      .from('app_notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids);
    if (!result.error) await loadCount();
  }, [db, items, load, loadCount]);

  useResumeRefresh(load);
  // Os ouvintes chamam sempre a versão atual de `load`/`seen`. Antes o efeito
  // dependia de `seen`, que muda a cada carga (depende de `items`): ele rodava
  // de novo, carregava de novo e entrava num ciclo sem fim de consultas.
  const refresh = useEffectEvent(() => {
    if (document.visibilityState === 'visible') void load();
  });
  const show = useEffectEvent(() => {
    setOpen(true);
    void seen();
  });
  const firstLoad = useEffectEvent(() => void load());
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => {
      if (live) firstLoad();
    });
    const onRefresh = () => refresh();
    const onShow = () => show();
    window.addEventListener('vetra:notifications', onRefresh);
    window.addEventListener('vetra:open-notifications', onShow);
    return () => {
      live = false;
      window.removeEventListener('vetra:notifications', onRefresh);
      window.removeEventListener('vetra:open-notifications', onShow);
    };
  }, []);

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) void seen();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="vetra-glass-on-glass relative size-9"
            aria-label={`Notificações${unread ? `, ${unread} não lidas` : ''}`}
          />
        }
      >
        <Bell />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0 right-0 rounded-full bg-foreground px-1 text-[10px] text-background"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={12}
        className="w-[min(calc(100vw-1.5rem),22rem)] gap-0 overflow-hidden rounded-3xl border bg-popover p-0 shadow-2xl ring-0"
      >
        <div className="px-5 pt-4 pb-3">
          <PopoverTitle className="text-base font-semibold tracking-tight">
            Notificações
          </PopoverTitle>
          <PopoverDescription className="mt-0.5 text-xs">
            Avisos do seu dinheiro e dos seus bancos.
          </PopoverDescription>
        </div>

        <div className="border-t py-1">
          {!loaded &&
            [0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 px-5 py-3">
                <Skeleton className="size-9 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          {loaded && error && !items.length && (
            <p role="alert" className="px-5 py-6 text-xs text-muted-foreground">
              Não foi possível carregar as notificações.
            </p>
          )}
          {loaded && !error && !items.length && (
            <p className="px-5 py-6 text-center text-xs text-muted-foreground">
              Nenhuma notificação por enquanto.
            </p>
          )}
          {items.map((notice) => {
            const Icon = noticeIcon(notice);
            const content = (
              <>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted/70">
                  <Icon className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug font-semibold">
                    {notice.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed break-words text-muted-foreground">
                    {notice.body}
                  </span>
                  <time
                    dateTime={notice.created_at}
                    className="mt-1 block text-[11px] text-muted-foreground"
                  >
                    {noticeWhen(notice.created_at)}
                  </time>
                </span>
              </>
            );
            const row =
              'flex items-center gap-3 px-5 py-3 text-left transition-colors';
            return NOTICE_DESTINATIONS.has(notice.href) ? (
              <Link
                key={notice.id}
                href={notice.href}
                onClick={() => setOpen(false)}
                className={`${row} hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none`}
              >
                {content}
              </Link>
            ) : (
              <div key={notice.id} className={row}>
                {content}
              </div>
            );
          })}
        </div>

        <Link
          href="/notificacoes"
          onClick={() => setOpen(false)}
          className="block border-t py-3 text-center text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          Ver todas as notificações
        </Link>
      </PopoverContent>
    </Popover>
  );
}
