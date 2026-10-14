'use client';
import Link from '@/components/navigation-link';
import { ArrowRightSymbol } from '@/components/ui/glass-button';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import { AppHeader } from '@/components/app-header';

import { useCallback, useMemo, useState } from 'react';
import { Check, Copy, KeyRound, RotateCcwKey, Smartphone } from 'lucide-react';
import type { FinancialEntry, ShortcutToken } from '@/lib/financial-tracker';
import { createClient } from '@/lib/supabase/client';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import { sortPaymentCardsByUsage, type PaymentCard } from '@/lib/payment-cards';
import { PaymentCardManager } from '@/components/payment-card-manager';
import { ExpenseAssistant } from '@/components/expense-assistant';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BiometricLockSettings } from '@/components/biometric-lock-settings';
import { NavigationBackButton } from '@/components/navigation-back-button';

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
export function FinancialTracker({
  userId,
  initialEntries,
  initialTokens,
  initialCards,
  initialError,
  aiEnabled = false,
}: {
  userId: string;
  initialEntries: FinancialEntry[];
  initialTokens: ShortcutToken[];
  initialCards: PaymentCard[];
  initialError: string;
  aiEnabled?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState(initialEntries);
  const [tokens, setTokens] = useState(initialTokens);
  const [cards, setCards] = useState(initialCards);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [deviceName, setDeviceName] = useState('Meu iPhone');
  const expenseEntries = useMemo(
    () => entries.filter((entry) => entry.entry_type === 'expense'),
    [entries],
  );
  const sortedCards = useMemo(
    () =>
      sortPaymentCardsByUsage(
        cards,
        expenseEntries.map((entry) => entry.account),
      ),
    [cards, expenseEntries],
  );
  const endpoint = `${typeof window === 'undefined' ? '' : window.location.origin}/api/shortcuts/entries`;

  const reload = useCallback(async () => {
    const [entryResult, tokenResult, cardResult] = await Promise.all([
      loadFinancialEntries(supabase, { includeExcluded: true }),
      supabase
        .from('shortcut_tokens')
        .select('id,name,last_used_at,revoked_at,created_at')
        .order('created_at', { ascending: false }),
      supabase.from('payment_cards').select('*').order('account'),
    ]);
    if (entryResult.error || tokenResult.error || cardResult.error)
      throw entryResult.error ?? tokenResult.error ?? cardResult.error;
    setEntries((entryResult.data ?? []) as FinancialEntry[]);
    setTokens((tokenResult.data ?? []) as ShortcutToken[]);
    setCards((cardResult.data ?? []) as PaymentCard[]);
  }, [supabase]);

  const refresh = useCallback(() => {
    return reload()
      .then(() => setError(''))
      .catch(() => setError('Não foi possível atualizar. Tente novamente.'));
  }, [reload]);
  useResumeRefresh(refresh);

  async function createToken() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { data, error: tokenError } = await supabase.rpc(
        'create_shortcut_token',
        { p_name: deviceName.trim() || 'Meu iPhone' },
      );
      if (tokenError) throw tokenError;
      const created = (data as { token: string }[] | null)?.[0];
      if (!created?.token) throw new Error('A API não retornou o token.');
      setSecret(created.token);
      setTokenOpen(true);
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível criar o token.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(id: string) {
    try {
      const { data, error: revokeError } = await supabase.rpc(
        'revoke_shortcut_token',
        { p_token_id: id },
      );
      if (revokeError || !data)
        return setError(revokeError?.message ?? 'Token não encontrado.');
      await reload();
    } catch {
      setError('Não foi possível atualizar os tokens.');
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copie o token selecionando o texto do campo.');
    }
  }

  return (
    <main className="min-h-dvh bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AppHeader onRefresh={refresh} />
      <div className="app-container pt-3">
        <NavigationBackButton />
      </div>

      <div className="app-container py-6 md:py-9">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Configurações</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Conexões, automações e segurança do Vetra.
            </p>
          </div>
        </div>
        {error && (
          <p className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
            {error}
          </p>
        )}
        {/* Configurações em três grupos, estilo Ajustes do iPhone. */}
        <div className="space-y-10">
          <SettingsGroup
            title="Bancos e cartões"
            description="De onde vêm os seus dados e como cada cartão fecha a fatura."
          >
            <section className="flex items-center gap-3 rounded-3xl border bg-card px-5 py-4 shadow-sm md:px-6">
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">Conexão com os bancos</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Robô do Meu Pluggy: conectar, testar e desconectar.
                </p>
              </div>
              <Link
                href="/conexoes"
                className="vetra-glass inline-flex min-h-9 shrink-0 items-center gap-1.5 px-3 text-xs font-medium"
              >
                Abrir
                <ArrowRightSymbol className="size-3.5" />
              </Link>
            </section>
            <PaymentCardManager
              entries={expenseEntries}
              userId={userId}
              accounts={expenseEntries.map((entry) => entry.account)}
              cards={sortedCards}
              onSaved={(card) =>
                setCards((current) => [
                  ...current.filter((item) => item.account !== card.account),
                  card,
                ])
              }
            />
          </SettingsGroup>
          <SettingsGroup
            title="Automação"
            description="O que entra sozinho no Vetra e como cada gasto ganha categoria."
          >
            <section className="mt-7 rounded-3xl border bg-card p-5 md:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2">
                    <Smartphone className="size-5" />
                    <h2 className="font-semibold">Apple Atalhos</h2>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Crie um token para o seu iPhone. Ele aparece uma única vez e
                    pode ser revogado sem afetar sua senha do Vetra.
                  </p>
                </div>
                {/* Campo e botão do mesmo tamanho. */}
                <div className="grid w-full grid-cols-2 gap-2 sm:w-80">
                  <Input
                    value={deviceName}
                    maxLength={80}
                    onChange={(event) => setDeviceName(event.target.value)}
                    className="h-11 w-full"
                    aria-label="Nome do dispositivo"
                  />
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={createToken}
                    className="h-11 w-full"
                  >
                    <KeyRound />
                    Gerar token
                  </Button>
                </div>
              </div>
              <div className="mt-5 space-y-2">
                {tokens
                  .filter((token) => !token.revoked_at)
                  .map((token) => (
                    <div
                      key={token.id}
                      className="flex items-center gap-3 rounded-xl border p-3 text-sm"
                    >
                      <Smartphone className="size-4" />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate">{token.name}</strong>
                        <span className="text-xs text-muted-foreground">
                          {token.last_used_at
                            ? `Usado em ${dateTime(token.last_used_at)}`
                            : 'Ainda não utilizado'}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => revokeToken(token.id)}
                        aria-label={`Revogar ${token.name}`}
                      >
                        <RotateCcwKey />
                      </Button>
                    </div>
                  ))}
              </div>
            </section>
            <ExpenseAssistant
              settings
              aiEnabled={aiEnabled}
              userId={userId}
              entries={expenseEntries}
              cards={sortedCards}
              onChanged={reload}
            />
          </SettingsGroup>
          <SettingsGroup
            title="Segurança"
            description="Quem consegue abrir o Vetra neste aparelho."
          >
            <BiometricLockSettings />
          </SettingsGroup>
        </div>
      </div>

      <Dialog
        open={tokenOpen}
        onOpenChange={(open) => {
          setTokenOpen(open);
          if (!open) setSecret('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token criado</DialogTitle>
            <DialogDescription>
              Copie agora. Por segurança, ele não será exibido novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-4">
            <div className="flex gap-2">
              <Input readOnly value={secret} className="font-mono text-xs" />
              <Button
                size="icon"
                variant="outline"
                onClick={() => copy(secret)}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <div className="rounded-xl bg-muted p-4 text-xs leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">URL</strong>
                <br />
                {endpoint}
              </p>
              <p className="mt-3">
                <strong className="text-foreground">Cabeçalho</strong>
                <br />
                Authorization: Bearer SEU_TOKEN
              </p>
              <p className="mt-3">
                <strong className="text-foreground">Corpo JSON</strong>
                <br />
                tipo, valor, descricao, categoria, conta, data e id_externo.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="glass"
              onClick={() => {
                setTokenOpen(false);
                setSecret('');
              }}
            >
              Já copiei
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** Grupo das Configurações; o espaçamento é do grupo (`*:mt-0`). */
function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h2 className="text-xs font-medium uppercase tracking-[.14em] text-muted-foreground">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-4 *:mt-0">{children}</div>
    </section>
  );
}
