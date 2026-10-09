'use client';

/* oxlint-disable jsx-a11y/prefer-tag-over-role -- A semantic form field makes iOS show its native navigation accessory; the editor remains labelled, focusable, and keyboard-operable. */

import { demoChatFetch } from '@/lib/demo/demo-chat';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  History,
  LoaderCircle,
  Plus,
  RotateCcw,
  SendHorizonal,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MarkdownResponse } from '@/components/markdown-response';
import { ThinkingAurora } from '@/components/thinking-aurora';
import { VetraMascot } from '@/components/vetra-mascot';
import { splitFollowUps } from '@/lib/finance-chat';
import { parseSpokenExpense, type SpokenExpense } from '@/lib/spoken-expense';
import { SpokenExpenseCard } from '@/components/spoken-expense-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};
type DataPolicy = 'blocked' | 'free-acknowledged' | 'paid-no-training';
type Conversation = {
  id: string;
  title: string;
  status: 'idle' | 'processing' | 'error';
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const suggestions = [
  'Estou gastando mais que no mês passado?',
  'Onde mais gastei este mês?',
  'Quanto meus cofrinhos renderam este mês?',
  'O saldo do Flash dura até o próximo depósito?',
];

const thinkingMessages = [
  'Lendo seus lançamentos…',
  'Conferindo cartões e faturas…',
  'Calculando padrões financeiros…',
  'Analisando cofrinhos e rendimentos…',
  'Organizando os pontos mais importantes…',
];

/**
 * Onde a conversa é renderizada, e quem rola:
 * - `inline`: seção que cresce com o conteúdo.
 * - `sheet`: caixa fixa que rola; composer absoluto dentro dela.
 * - `page`: tela própria; o documento rola e o composer é sticky (único
 *   arranjo que o iOS trata bem com o teclado aberto).
 */
export type ChatLayout = 'inline' | 'sheet' | 'page';

export function FinancialChat({ layout = 'inline' }: { layout?: ChatLayout }) {
  /** Layouts enquadrados: barra da conversa, padding menor, composer em barra. */
  const compact = layout !== 'inline';
  const sheet = layout === 'sheet';
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] =
    useState<Conversation | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [question, setQuestion] = useState('');
  /**
   * Gastos falados (lib/spoken-expense.ts) aguardando confirmação. Só na
   * tela: não viram mensagem nem vão para a IA.
   */
  const [drafts, setDrafts] = useState<
    { id: string; text: string; parsed: SpokenExpense; open: boolean }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [dataPolicy, setDataPolicy] = useState<DataPolicy>('free-acknowledged');
  const [error, setError] = useState('');
  /** Pergunta sem resposta, oferecida de volta no balão de erro. */
  const [failedQuestion, setFailedQuestion] = useState('');
  /** Só a leitura mais nova escreve na tela. */
  const loadTicket = useRef(0);
  /**
   * Durante o envio nenhuma leitura pode dizer que a IA parou de pensar
   * (o servidor ainda não tem a pergunta).
   */
  const sending = useRef(false);
  const inputRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);

  async function loadConversation(
    conversationId?: string,
    { silent = false }: { silent?: boolean } = {},
  ) {
    if (!silent) setHistoryLoading(true);
    const ticket = ++loadTicket.current;
    try {
      const query = conversationId
        ? `?conversationId=${encodeURIComponent(conversationId)}`
        : '';
      const response = await demoChatFetch(`/api/finance/chat${query}`, {
        cache: 'no-store',
      });
      if (response.status === 423) {
        window.location.replace('/desbloquear');
        return;
      }
      const payload = (await response.json().catch(() => null)) as {
        conversations?: Conversation[];
        activeConversation?: Conversation | null;
        messages?: Message[];
        dataPolicy?: DataPolicy;
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(
          payload?.error ?? 'Não foi possível abrir suas conversas.',
        );
      // Resposta velha: há leitura mais nova ou envio em curso.
      if (ticket !== loadTicket.current || sending.current) return;
      setConversations(payload?.conversations ?? []);
      setActiveConversation(payload?.activeConversation ?? null);
      setMessages(payload?.messages ?? []);
      setBusy(payload?.activeConversation?.status === 'processing');
      const failure = payload?.activeConversation?.last_error ?? '';
      setError(failure);
      setFailedQuestion(
        failure
          ? ((payload?.messages ?? [])
              .filter((message) => message.role === 'user')
              .at(-1)?.content ?? '')
          : '',
      );
      if (payload?.dataPolicy) setDataPolicy(payload.dataPolicy);
    } catch (cause) {
      if (ticket !== loadTicket.current || sending.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível abrir suas conversas.',
      );
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void loadConversation());
  }, []);

  // `busy` é a tela; o status é o servidor. Olhar os dois mantém a checagem.
  const processing = busy || activeConversation?.status === 'processing';
  useEffect(() => {
    if (!processing || !activeConversation?.id) return;
    const conversationId = activeConversation.id;
    const interval = window.setInterval(
      () => void loadConversation(conversationId, { silent: true }),
      1600,
    );
    return () => window.clearInterval(interval);
  }, [activeConversation?.id, processing]);

  useEffect(() => {
    // Rola quem é dono da rolagem: a lista no sheet, o documento na página.
    if (!sheet) {
      if (layout === 'page')
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: 'smooth',
        });
      return;
    }
    // Depois do quadro, para o balão novo já ter altura.
    const frame = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, drafts, busy, error, sheet, layout]);

  useEffect(() => {
    if (!busy) return;
    const interval = window.setInterval(
      () =>
        setThinkingStep((current) => (current + 1) % thinkingMessages.length),
      2200,
    );
    return () => window.clearInterval(interval);
  }, [busy]);

  /**
   * O composer flutua sobre a lista; mede a altura dele para a lista terminar
   * acima (padding fixo não acompanha várias linhas nem a barra de gestos).
   */
  useEffect(() => {
    const shell = shellRef.current;
    const composer = composerRef.current;
    if (!sheet || !shell || !composer) return;
    const publish = () =>
      shell.style.setProperty(
        '--vetra-composer-height',
        `${Math.round(composer.getBoundingClientRect().height)}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [sheet]);

  async function newChat() {
    setError('');
    try {
      const response = await demoChatFetch('/api/finance/chat', {
        method: 'PUT',
      });
      const payload = (await response.json().catch(() => null)) as {
        conversation?: Conversation;
        error?: string;
      } | null;
      if (!response.ok || !payload?.conversation)
        throw new Error(payload?.error ?? 'Não foi possível criar a conversa.');
      setConversations((current) => [
        payload.conversation!,
        ...current.filter((item) => item.id !== payload.conversation!.id),
      ]);
      setActiveConversation(payload.conversation);
      setMessages([]);
      setQuestion('');
      if (inputRef.current) inputRef.current.textContent = '';
      setBusy(false);
      setHistoryOpen(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível criar a conversa.',
      );
    }
  }

  async function deleteConversation(conversation: Conversation) {
    if (deletingConversation) return;
    setDeletingConversation(true);
    setError('');
    try {
      const response = await demoChatFetch(
        `/api/finance/chat?conversationId=${encodeURIComponent(conversation.id)}`,
        { method: 'DELETE' },
      );
      if (response.status === 423) {
        window.location.replace('/desbloquear');
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          payload?.error ?? 'Não foi possível excluir a conversa.',
        );
      }

      const remaining = conversations.filter(
        (item) => item.id !== conversation.id,
      );
      setConversations(remaining);
      setConversationToDelete(null);
      if (activeConversation?.id === conversation.id) {
        const nextConversation = remaining[0];
        if (nextConversation) await loadConversation(nextConversation.id);
        else {
          setActiveConversation(null);
          setMessages([]);
          setBusy(false);
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível excluir a conversa.',
      );
    } finally {
      setDeletingConversation(false);
    }
  }

  async function send(value = question) {
    const content = value.trim();
    if (!content || busy || historyLoading) return;
    // Gasto falado é registrado aqui, com confirmação, sem IA.
    const spoken = parseSpokenExpense(content);
    if (spoken) {
      setDrafts((current) => [
        ...current,
        { id: crypto.randomUUID(), text: content, parsed: spoken, open: true },
      ]);
      setQuestion('');
      if (inputRef.current) inputRef.current.textContent = '';
      setError('');
      return;
    }
    const optimisticId = `local-${crypto.randomUUID()}`;
    const nextMessages: Message[] = [
      ...messages,
      {
        id: optimisticId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      },
    ];
    setMessages(nextMessages);
    setQuestion('');
    if (inputRef.current) inputRef.current.textContent = '';
    setThinkingStep(0);
    setBusy(true);
    setError('');
    setFailedQuestion('');
    sending.current = true;
    let accepted = false;
    try {
      const response = await demoChatFetch('/api/finance/chat', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          conversationId: activeConversation?.id,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        conversation?: Conversation;
        message?: Message;
        error?: string;
      } | null;
      if (response.status === 423) {
        window.location.replace('/desbloquear');
        return;
      }
      if (!response.ok || !payload?.conversation || !payload.message)
        throw new Error(payload?.error ?? 'Não foi possível responder agora.');
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimisticId),
        payload.message!,
      ]);
      setActiveConversation(payload.conversation);
      setConversations((current) => [
        payload.conversation!,
        ...current.filter((item) => item.id !== payload.conversation!.id),
      ]);
      accepted = true;
      // Descarta checagens anteriores ao aceite da pergunta.
      loadTicket.current += 1;
    } catch (cause) {
      setMessages((current) =>
        current.filter((message) => message.id !== optimisticId),
      );
      // A pergunta volta como sugestão no balão de erro, não no campo.
      setFailedQuestion(content);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível responder agora.',
      );
    } finally {
      sending.current = false;
      if (!accepted) setBusy(false);
    }
  }

  return (
    <div
      ref={shellRef}
      className={cn(
        'flex flex-col',
        layout === 'sheet' && 'relative h-full min-h-0 overflow-hidden',
        // Sem altura máxima nem overflow: o documento é quem rola.
        layout === 'page' && 'flex-1',
        layout === 'inline' && 'mx-auto min-h-0 max-w-3xl py-6 md:py-9',
      )}
    >
      <div
        className={cn(
          'flex flex-1 flex-col',
          layout !== 'page' && 'min-h-0',
          compact ? '' : 'rounded-3xl border bg-card p-5 md:p-7',
        )}
      >
        {!compact && (
          <div className="flex items-start gap-4">
            <VetraMascot className="size-11 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[.14em] text-muted-foreground">
                Vetra AI
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Conversar sobre suas finanças
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Pergunte sobre gastos, categorias e movimentos recentes. A
                resposta usa seus dados registrados no Vetra.
              </p>
            </div>
          </div>
        )}

        {compact && (
          // Na página, a barra gruda sob o cabeçalho (altura publicada pela
          // AssistantScreen). No sheet já fica parada.
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 border-b px-4 py-2.5',
              layout === 'page' &&
                'sticky top-[var(--vetra-assistant-header,0px)] z-20 bg-background',
            )}
          >
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {activeConversation?.title?.trim() || 'Nova conversa'}
            </p>
            <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Abrir histórico de conversas"
                    title="Conversas"
                  />
                }
              >
                <History />
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(22rem,calc(100vw-2rem))] p-2"
              >
                <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
                  Conversas recentes
                </p>
                {/* Limite no viewport, não na raiz. */}
                <ScrollArea
                  className="overflow-hidden"
                  viewportClassName="max-h-[45dvh] space-y-1 overscroll-contain"
                >
                  {conversations.length ? (
                    conversations.map((conversation) => (
                      <div
                        key={conversation.id}
                        className="flex items-center gap-1 rounded-xl hover:bg-muted"
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
                          onClick={() => {
                            setHistoryOpen(false);
                            void loadConversation(conversation.id);
                          }}
                        >
                          {conversation.status === 'processing' ? (
                            <LoaderCircle className="size-4 shrink-0 animate-spin" />
                          ) : activeConversation?.id === conversation.id ? (
                            <Check className="size-4 shrink-0" />
                          ) : (
                            <span className="size-4 shrink-0" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {conversation.title?.trim() ||
                              'Conversa sem título'}
                          </span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="mr-1 shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Excluir ${conversation.title?.trim() || 'conversa'}`}
                          title="Excluir conversa"
                          onClick={() => {
                            setHistoryOpen(false);
                            setConversationToDelete(conversation);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      Nenhuma conversa ainda.
                    </p>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void newChat()}
              aria-label="Criar nova conversa"
              title="Novo chat"
            >
              <Plus />
            </Button>
          </div>
        )}

        {historyLoading && (
          <div
            className={cn(
              'min-h-0 flex-1 space-y-3 px-5 py-5',
              sheet && 'pb-[calc(var(--vetra-composer-height,6rem)+1rem)]',
            )}
            aria-label="Carregando histórico"
          >
            <Skeleton className="ml-auto h-14 w-3/4 rounded-2xl" />
            <Skeleton className="h-24 w-4/5 rounded-2xl" />
          </div>
        )}

        {!historyLoading && !messages.length && !drafts.length && (
          <div
            ref={messageListRef}
            className={cn(
              layout === 'sheet' &&
                'grid min-h-0 flex-1 content-start gap-2 overflow-x-hidden overflow-y-auto px-4 pt-4 pb-[calc(var(--vetra-composer-height,6rem)+1rem)]',
              layout === 'page' && 'grid content-start gap-2 px-4 pt-4 pb-4',
              layout === 'inline' && 'mt-6 flex flex-wrap content-start gap-2',
            )}
          >
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                disabled={busy}
                onClick={() => void send(suggestion)}
                className={cn(
                  compact &&
                    'h-auto min-h-11 w-full justify-start whitespace-normal px-3 py-2.5 text-left leading-snug',
                )}
              >
                <Sparkles className="shrink-0" />
                <span className="min-w-0">{suggestion}</span>
              </Button>
            ))}
          </div>
        )}

        {(messages.length > 0 || drafts.length > 0) && (
          <div
            ref={messageListRef}
            className={cn(
              'space-y-4',
              layout === 'sheet' &&
                'min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-4 pb-[calc(var(--vetra-composer-height,6rem)+1rem)]',
              layout === 'page' && 'flex-1 px-5 pt-4 pb-4',
              layout === 'inline' && 'mt-7',
            )}
            aria-live="polite"
          >
            {messages.map((message, index) => {
              // Cada resposta termina com três perguntas ocultas; viram botões só na última.
              const { body, followUps } =
                message.role === 'assistant'
                  ? splitFollowUps(message.content)
                  : { body: message.content, followUps: [] };
              const latest = index === messages.length - 1;
              return (
                <div key={message.id || `${message.role}-${index}`}>
                  <article
                    className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed break-words md:max-w-[88%] ${
                      message.role === 'user'
                        ? 'ml-auto bg-foreground text-background whitespace-pre-wrap'
                        : 'border bg-muted/45'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      <MarkdownResponse>{body}</MarkdownResponse>
                    ) : (
                      body
                    )}
                  </article>
                  {latest && !busy && followUps.length > 0 && (
                    <div className="mt-2.5 flex max-w-[92%] flex-wrap gap-2 md:max-w-[88%]">
                      {followUps.map((followUp) => (
                        <Button
                          key={followUp}
                          variant="glass-quiet"
                          size="sm"
                          // `max-w-full` + `shrink`: pergunta longa quebra em vez de arrastar a tela.
                          className="h-auto min-h-8 max-w-full shrink justify-start whitespace-normal rounded-full px-3 py-1.5 text-left leading-snug"
                          onClick={() => void send(followUp)}
                        >
                          <Sparkles className="shrink-0" />
                          <span className="min-w-0 break-words">
                            {followUp}
                          </span>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {drafts.map((draft) => (
              <div key={draft.id} className="space-y-2">
                <article className="ml-auto max-w-[92%] rounded-2xl bg-foreground px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-background md:max-w-[88%]">
                  {draft.text}
                </article>
                {draft.open && (
                  <SpokenExpenseCard
                    parsed={draft.parsed}
                    onDone={(saved) => {
                      if (saved) return;
                      setDrafts((current) =>
                        current.map((item) =>
                          item.id === draft.id
                            ? { ...item, open: false }
                            : item,
                        ),
                      );
                    }}
                  />
                )}
                {!draft.open && (
                  <p className="text-xs text-muted-foreground">
                    Não registrado.
                  </p>
                )}
              </div>
            ))}
            {busy && (
              <output className="flex max-w-[92%] items-center gap-3 rounded-2xl border bg-muted/45 px-4 py-3 text-sm text-muted-foreground md:max-w-[80%]">
                <ThinkingAurora className="size-8 shrink-0" />
                <span
                  key={thinkingStep}
                  className="vetra-ai-thinking-copy min-w-0"
                >
                  {thinkingMessages[thinkingStep]}
                </span>
              </output>
            )}
          </div>
        )}

        {error && (
          // Erro como balão do assistente, onde a resposta apareceria.
          <div
            role="alert"
            className={cn(
              'mt-1',
              compact && 'shrink-0 px-5 pb-1',
              layout === 'inline' && 'mt-4',
            )}
          >
            <article className="max-w-[92%] rounded-2xl border border-destructive/35 bg-destructive/8 px-4 py-3 text-sm leading-relaxed md:max-w-[88%]">
              <p className="flex items-start gap-2 font-medium text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                Não consegui responder agora
              </p>
              <p className="mt-1.5 text-muted-foreground">{error}</p>
            </article>
            {failedQuestion && (
              <div className="mt-2.5 flex max-w-[92%] flex-wrap gap-2 md:max-w-[88%]">
                <Button
                  variant="glass-quiet"
                  size="sm"
                  disabled={busy}
                  className="h-auto min-h-8 whitespace-normal rounded-full px-3 py-1.5 text-left leading-snug"
                  onClick={() => void send(failedQuestion)}
                >
                  <RotateCcw className="shrink-0" />
                  {failedQuestion}
                </Button>
              </div>
            )}
          </div>
        )}
        <form
          ref={composerRef}
          data-chat-composer
          className={cn(
            'flex gap-2',
            compact &&
              'z-20 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
            layout === 'sheet' && 'absolute inset-x-0 bottom-0 bg-popover',
            // Sticky, não fixed: o iOS move o documento quando o teclado abre.
            layout === 'page' && 'sticky bottom-0 mt-auto bg-background',
            layout === 'inline' && 'mt-7',
          )}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {/* contenteditable de texto puro evita a barra anterior/próximo do iOS. */}
          <div
            ref={inputRef}
            role="textbox"
            tabIndex={0}
            aria-multiline="true"
            contentEditable={
              busy || historyLoading ? false : ('plaintext-only' as const)
            }
            suppressContentEditableWarning
            inputMode="text"
            enterKeyHint="send"
            aria-disabled={busy || historyLoading}
            data-placeholder="Ex.: Em que eu mais gastei?"
            onInput={(event) => {
              const editor = event.currentTarget;
              const next = (editor.textContent ?? '').slice(0, 1000);
              if (editor.textContent !== next) editor.textContent = next;
              setQuestion(next);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              if (!busy && !historyLoading && question.trim()) void send();
            }}
            onFocus={() => {
              window.requestAnimationFrame(() => {
                const list = messageListRef.current;
                if (list) list.scrollTop = list.scrollHeight;
              });
            }}
            aria-label="Pergunta para a IA financeira"
            className={cn(
              'field-sizing-content w-full border border-input bg-transparent outline-none transition-colors empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
              compact &&
                'min-h-12 max-h-28 min-w-0 overflow-y-auto rounded-2xl px-4 py-3 text-base leading-6',
              (busy || historyLoading) &&
                'pointer-events-none bg-input/50 opacity-50',
            )}
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || historyLoading || !question.trim()}
            aria-label="Enviar pergunta"
            className={cn(compact && 'size-12 shrink-0 rounded-2xl')}
          >
            <SendHorizonal />
          </Button>
        </form>
        {!compact && (
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            A IA não cria nem altera lançamentos. Confira informações
            importantes antes de tomar decisões financeiras.{' '}
            {dataPolicy === 'paid-no-training'
              ? 'O projeto está no nível pago, sem uso do conteúdo para melhorar os modelos.'
              : dataPolicy === 'blocked'
                ? 'O envio de dados ao Gemini está bloqueado.'
                : 'No nível gratuito, o Google pode usar o conteúdo enviado e as respostas para melhorar seus produtos.'}
          </p>
        )}
      </div>
      <AlertDialog
        open={Boolean(conversationToDelete)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deletingConversation) setConversationToDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              O histórico desta conversa será apagado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingConversation}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="glass-destructive"
              disabled={deletingConversation || !conversationToDelete}
              onClick={() => {
                if (conversationToDelete)
                  void deleteConversation(conversationToDelete);
              }}
            >
              {deletingConversation ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
