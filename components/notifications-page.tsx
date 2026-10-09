'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  CheckCheck,
  ExternalLink,
  Mail,
  MailOpen,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  NOTICE_DESTINATIONS,
  noticeIcon,
  noticeWhen,
  type Notice,
} from '@/lib/notifications';
import { cn } from '@/lib/utils';

/* Central de notificações (aberta pelo sininho): filtro e, por notificação,
   lida/não lida, arquivar, abrir e excluir. Arquivada sai do sininho. */

type Filter = 'all' | 'unread' | 'archived';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'unread', label: 'Não lidas' },
  { value: 'archived', label: 'Arquivadas' },
];

const LIMIT = 200;

/** Avisa o sininho para recontar. */
const ping = () => window.dispatchEvent(new Event('vetra:notifications'));

export function NotificationsPage() {
  const db = useMemo(() => createClient(), []);
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<Notice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Notice | 'archived' | null>(null);

  const load = useCallback(async () => {
    let query = db
      .from('app_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id')
      .limit(LIMIT);
    query =
      filter === 'archived'
        ? query.not('archived_at', 'is', null)
        : query.is('archived_at', null);
    if (filter === 'unread') query = query.is('read_at', null);
    const result = await query;
    if (result.error)
      setError('Não foi possível carregar as notificações. Tente de novo.');
    else {
      setItems((result.data ?? []) as Notice[]);
      setError('');
    }
    setLoaded(true);
  }, [db, filter]);

  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => {
      if (live) return load();
    });
    return () => {
      live = false;
    };
  }, [load]);

  /** Muda campos de uma ou mais notificações e recarrega. */
  const patch = async (
    ids: string[],
    values: Partial<Pick<Notice, 'read_at' | 'archived_at'>>,
  ) => {
    if (!ids.length || busy) return;
    setBusy(true);
    const result = await db
      .from('app_notifications')
      .update(values)
      .in('id', ids);
    if (result.error) setError('Não foi possível salvar. Tente de novo.');
    await load();
    ping();
    setBusy(false);
  };

  const remove = async () => {
    if (!confirm || busy) return;
    const ids =
      confirm === 'archived' ? items.map((notice) => notice.id) : [confirm.id];
    setBusy(true);
    const result = await db.from('app_notifications').delete().in('id', ids);
    if (result.error) setError('Não foi possível excluir. Tente de novo.');
    setConfirm(null);
    await load();
    ping();
    setBusy(false);
  };

  const now = () => new Date().toISOString();
  const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader onRefresh={() => window.location.reload()} />
      <div className="app-container mx-auto max-w-2xl py-6 md:py-9">
        <NavigationBackButton fallback="/" className="mb-5" />
        <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Avisos do seu dinheiro e dos seus bancos.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? 'glass' : 'glass-quiet'}
              aria-pressed={filter === option.value}
              onClick={() => {
                setLoaded(false);
                setFilter(option.value);
              }}
            >
              {option.label}
            </Button>
          ))}
          <span className="flex-1" />
          {filter !== 'archived' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !unreadIds.length}
              onClick={() => void patch(unreadIds, { read_at: now() })}
            >
              <CheckCheck className="size-4" />
              Marcar todas como lidas
            </Button>
          )}
          {filter === 'archived' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !items.length}
              onClick={() => setConfirm('archived')}
            >
              <Trash2 className="size-4" />
              Esvaziar arquivadas
            </Button>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}

        <section className="mt-4 overflow-hidden rounded-3xl border bg-card">
          {!loaded &&
            [0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <Skeleton className="size-10 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-56" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          {loaded && !items.length && (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              {filter === 'archived'
                ? 'Nenhuma notificação arquivada.'
                : filter === 'unread'
                  ? 'Você está em dia: nenhuma não lida.'
                  : 'Nenhuma notificação por enquanto.'}
            </p>
          )}
          {loaded &&
            items.map((notice) => {
              const Icon = noticeIcon(notice);
              const canOpen = NOTICE_DESTINATIONS.has(notice.href);
              return (
                <article
                  key={notice.id}
                  className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
                >
                  <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-muted/70">
                    <Icon className="size-4 text-muted-foreground" />
                    {!notice.read_at && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-foreground"
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2
                      className={cn(
                        'text-sm leading-snug',
                        notice.read_at ? 'font-medium' : 'font-semibold',
                      )}
                    >
                      {notice.title}
                      {!notice.read_at && (
                        <span className="sr-only"> (não lida)</span>
                      )}
                    </h2>
                    <p className="mt-0.5 text-xs leading-relaxed break-words text-muted-foreground">
                      {notice.body}
                    </p>
                    <time
                      dateTime={notice.created_at}
                      className="mt-1 block text-[11px] text-muted-foreground"
                    >
                      {noticeWhen(notice.created_at)}
                    </time>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 shrink-0"
                          aria-label={`Ações de ${notice.title}`}
                          disabled={busy}
                        />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {canOpen && (
                        <DropdownMenuItem
                          onClick={() => {
                            if (!notice.read_at)
                              void patch([notice.id], { read_at: now() });
                            router.push(notice.href);
                          }}
                        >
                          <ExternalLink />
                          Abrir
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() =>
                          void patch([notice.id], {
                            read_at: notice.read_at ? null : now(),
                          })
                        }
                      >
                        {notice.read_at ? <Mail /> : <MailOpen />}
                        {notice.read_at
                          ? 'Marcar como não lida'
                          : 'Marcar como lida'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          void patch([notice.id], {
                            archived_at: notice.archived_at ? null : now(),
                          })
                        }
                      >
                        {notice.archived_at ? <ArchiveRestore /> : <Archive />}
                        {notice.archived_at ? 'Desarquivar' : 'Arquivar'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setConfirm(notice)}
                      >
                        <Trash2 />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </article>
              );
            })}
        </section>
        {items.length >= LIMIT && (
          <p className="mt-3 text-xs text-muted-foreground">
            Mostrando as {LIMIT} mais recentes.
          </p>
        )}
      </div>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'archived'
                ? 'Esvaziar arquivadas?'
                : 'Excluir notificação?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'archived'
                ? `As ${items.length} notificações arquivadas serão excluídas de vez.`
                : 'Ela será excluída de vez. Para só tirar da frente, use Arquivar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="glass-destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
