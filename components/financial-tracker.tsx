'use client';
import { ExpenseEntryDialog } from '@/components/expense-entry-dialog';
import Link from '@/components/navigation-link';
import { ArrowRightSymbol } from '@/components/ui/glass-button';
import { useResumeRefresh } from '@/lib/use-resume-refresh';
import { AppHeader } from '@/components/app-header';

import { useCallback, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import {
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  Plus,
  RotateCcwKey,
  Smartphone,
} from 'lucide-react';
import type { FinancialEntry, ShortcutToken } from '@/lib/financial-tracker';
import { createClient } from '@/lib/supabase/client';
import { loadFinancialEntries } from '@/lib/financial-entries-query';
import {
  PAYMENT_METHOD_COLOUR,
  resolvePaymentMethod,
  sortPaymentCardsByUsage,
  type PaymentCard,
  type PaymentMethodId,
} from '@/lib/payment-cards';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { PaymentCardManager } from '@/components/payment-card-manager';
import { EntryDetails } from '@/components/entry-details';
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
import { ExpenseDayList } from '@/components/expense-line';
import { countedAmount } from '@/lib/entry-share';
import { isInstallment, type CardCycle } from '@/lib/expense-insights';
import { invoiceSpendingMonth } from '@/lib/card-invoices';
import { BiometricLockSettings } from '@/components/biometric-lock-settings';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Private } from '@/components/private-value';

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(new Decimal(value || 0).toDecimalPlaces(2).toNumber());
const dateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
const monthKey = (value = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(value);
/** "outubro de 2026", de "2026-10". */
const monthName = (month: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-15T12:00:00Z`));
export function FinancialTracker({
  userId,
  initialEntries,
  initialTokens,
  initialCards,
  initialError,
  settings = false,
  aiEnabled = false,
  cycles = [],
}: {
  userId: string;
  initialEntries: FinancialEntry[];
  initialTokens: ShortcutToken[];
  initialCards: PaymentCard[];
  initialError: string;
  settings?: boolean;
  aiEnabled?: boolean;
  /** Os ciclos de crédito, para pôr cada parcela no mês de gasto da fatura. */
  cycles?: CardCycle[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState(initialEntries);
  const [tokens, setTokens] = useState(initialTokens);
  const [cards, setCards] = useState(initialCards);
  const [entryOpen, setEntryOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<FinancialEntry | null>(
    null,
  );
  const [tokenOpen, setTokenOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [deviceName, setDeviceName] = useState('Meu iPhone');
  const currentMonth = monthKey();
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
  // A lista mostra tudo; as somas, só o que conta (sem "fora das contas"; na
  // dividida, a parte do usuário via `countedAmount`).
  const monthEntries = expenseEntries.filter(
    (entry) =>
      !entry.excluded_from_totals &&
      monthKey(new Date(entry.occurred_at)) === currentMonth &&
      new Date(entry.occurred_at) <= new Date(),
  );
  // `null` = todos.
  const [method, setMethod] = useState<string | null>(null);
  /**
   * Gasto por método no mês, do maior ao menor, a partir dos lançamentos
   * (inclui Pix e o que não é cartão cadastrado).
   */
  const byMethod = useMemo(() => {
    const totals = new Map<string, Decimal>();
    for (const entry of monthEntries)
      totals.set(
        entry.account,
        (totals.get(entry.account) ?? new Decimal(0)).plus(
          countedAmount(entry),
        ),
      );
    return [...totals].sort((a, b) => b[1].comparedTo(a[1]));
  }, [monthEntries]);
  // O filtro pode sobreviver ao método; cai para todos.
  const activeMethod =
    method && byMethod.some(([account]) => account === method) ? method : null;
  const inMethod = (entry: FinancialEntry) =>
    !activeMethod || entry.account === activeMethod;
  const visibleMonthEntries = monthEntries.filter(inMethod);
  const visibleEntries = expenseEntries.filter(inMethod);
  // Gastos por mês, do mais novo ao mais antigo. Parcela fica no mês de gasto
  // da fatura (a data carimbada pelo banco na parcela futura não diz nada).
  const entryMonth = (entry: FinancialEntry) =>
    isInstallment(entry) && entry.invoice_due_override
      ? invoiceSpendingMonth(
          entry.invoice_due_override,
          cycles.find((cycle) => cycle.account === entry.account),
        )
      : monthKey(new Date(entry.occurred_at));
  const months = new Map<string, FinancialEntry[]>();
  for (const entry of [...visibleEntries].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at),
  ))
    months.set(entryMonth(entry), [
      ...(months.get(entryMonth(entry)) ?? []),
      entry,
    ]);
  const byMonth = [...months].sort((a, b) => b[0].localeCompare(a[0]));
  const expense = visibleMonthEntries.reduce(
    (sum, entry) => sum.plus(countedAmount(entry)),
    new Decimal(0),
  );
  const monthTotal = monthEntries.reduce(
    (sum, entry) => sum.plus(countedAmount(entry)),
    new Decimal(0),
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

  // Confirmação no EntryDetails (window.confirm escapa do modo privacidade).
  // A falha sobe para o diálogo mostrar.
  async function deleteEntry(id: string) {
    const result = await supabase
      .from('financial_entries')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (result.error) throw new Error(result.error.message);
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setSelectedEntry(null);
  }

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
            <h1 className="text-xl font-semibold">
              {settings ? 'Configurações' : 'Controle de gastos'}
            </h1>
            {settings && (
              <p className="mt-1 text-sm text-muted-foreground">
                Conexões, automações e segurança do Vetra.
              </p>
            )}
          </div>
          {!settings && (
            <Button variant="glass" onClick={() => setEntryOpen(true)}>
              <Plus />
              Novo lançamento
            </Button>
          )}
        </div>
        {error && (
          <p className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
            {error}
          </p>
        )}
        {!settings && (
          <section className="grid gap-2 sm:grid-cols-2">
            <SummaryCard
              label={
                activeMethod
                  ? `Gastos no mês · ${activeMethod}`
                  : 'Gastos no mês'
              }
              value={expense}
              icon={<ArrowUpRight />}
            />
            <SummaryCard
              label="Média por gasto no mês"
              value={
                visibleMonthEntries.length
                  ? expense.div(visibleMonthEntries.length)
                  : new Decimal(0)
              }
              icon={<Check />}
            />
          </section>
        )}

        {!settings && byMethod.length > 1 && (
          <section className="mt-4">
            <h2 className="mb-2 text-xs uppercase tracking-[.14em] text-muted-foreground">
              No mês, por método de pagamento
            </h2>
            {/* Rolagem horizontal: a lista cresce com os cartões. */}
            <ScrollArea orientation="horizontal" className="-mx-1 w-auto">
              <div className="flex gap-2 px-1 pb-2">
                <MethodChip
                  label="Todos"
                  value={monthTotal}
                  active={!activeMethod}
                  onClick={() => setMethod(null)}
                />
                {byMethod.map(([account, total]) => (
                  <MethodChip
                    key={account}
                    label={account}
                    value={total}
                    bankId={resolvePaymentMethod(account, sortedCards)}
                    active={activeMethod === account}
                    // Tocar no escolhido volta para todos.
                    onClick={() =>
                      setMethod(activeMethod === account ? null : account)
                    }
                  />
                ))}
              </div>
            </ScrollArea>
          </section>
        )}

        {settings ? (
          // Configurações em três grupos, estilo Ajustes do iPhone.
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
                      Crie um token para o seu iPhone. Ele aparece uma única vez
                      e pode ser revogado sem afetar sua senha do Vetra.
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
                          <strong className="block truncate">
                            {token.name}
                          </strong>
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
        ) : (
          <ExpenseAssistant
            aiEnabled={aiEnabled}
            userId={userId}
            entries={expenseEntries}
            cards={sortedCards}
            onChanged={reload}
          />
        )}

        {!settings && (
          <section className="mt-7 overflow-hidden rounded-3xl border bg-card">
            <div className="flex items-center justify-between border-b p-5">
              <div>
                <h2 className="font-semibold">Lançamentos</h2>
                <p className="text-sm text-muted-foreground">
                  Sua planilha viva, atualizada pelo app e pelos Atalhos.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {visibleEntries.length} gastos
                {activeMethod ? ` · ${activeMethod}` : ''}
              </span>
            </div>
            {visibleEntries.length ? (
              // Um bloco por mês: faixa com nome, total e contagem; dias embaixo.
              <div>
                {byMonth.map(([month, items]) => (
                  <section
                    key={month}
                    aria-label={monthName(month)}
                    className="pb-3"
                  >
                    <div className="flex items-baseline justify-between gap-3 border-y bg-muted/40 px-5 py-3 first:border-t-0">
                      <h3 className="text-sm font-semibold first-letter:uppercase">
                        {monthName(month)}
                        {month === currentMonth && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            este mês
                          </span>
                        )}
                      </h3>
                      <p className="shrink-0 text-right text-xs text-muted-foreground">
                        <Private>
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {money(
                              items.reduce(
                                (sum, entry) => sum.plus(countedAmount(entry)),
                                new Decimal(0),
                              ),
                            )}
                          </span>
                        </Private>{' '}
                        · {items.length}{' '}
                        {items.length === 1 ? 'gasto' : 'gastos'}
                      </p>
                    </div>
                    {items.some((entry) => !isInstallment(entry)) && (
                      <div className="px-3 pt-1 md:px-4">
                        <ExpenseDayList
                          entries={items.filter(
                            (entry) => !isInstallment(entry),
                          )}
                          cards={sortedCards}
                          onOpen={setSelectedEntry}
                        />
                      </div>
                    )}
                    {/* Parcelas no fim do mês. */}
                    {items.some(isInstallment) && (
                      <div className="px-3 pt-1 md:px-4">
                        <p className="px-2 pt-3 pb-0.5 text-[11px] font-medium uppercase tracking-[.1em] text-muted-foreground">
                          Parcelas
                        </p>
                        <ExpenseDayList
                          entries={items.filter(isInstallment)}
                          cards={sortedCards}
                          onOpen={setSelectedEntry}
                          days={false}
                        />
                      </div>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhum lançamento ainda.
              </p>
            )}
          </section>
        )}
      </div>

      {selectedEntry && (
        <EntryDetails
          key={selectedEntry.id}
          onDelete={deleteEntry}
          entry={selectedEntry}
          cards={sortedCards}
          onClose={() => setSelectedEntry(null)}
          onRuleApplied={reload}
          onSaved={(updated) =>
            setEntries((previous) =>
              previous.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
            )
          }
        />
      )}
      {entryOpen && (
        <ExpenseEntryDialog
          cards={sortedCards}
          onClose={() => setEntryOpen(false)}
          onSaved={(entry) => setEntries((previous) => [entry, ...previous])}
        />
      )}

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

/** Método de pagamento com o gasto do mês, servindo de filtro (`aria-pressed`). */
function MethodChip({
  label,
  value,
  bankId,
  active,
  onClick,
}: {
  label: string;
  value: Decimal;
  bankId?: PaymentMethodId;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2',
        active ? 'border-foreground bg-muted' : 'hover:bg-muted/50',
      )}
    >
      {bankId && <PaymentMethodDot bankId={bankId} />}
      <span className="text-xs font-medium whitespace-nowrap">{label}</span>
      <span className="text-xs tabular-nums whitespace-nowrap text-muted-foreground">
        <Private>{money(value)}</Private>
      </span>
    </button>
  );
}

/** Marca como ponto colorido (PAYMENT_METHOD_COLOUR). */
function PaymentMethodDot({ bankId }: { bankId: PaymentMethodId }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: PAYMENT_METHOD_COLOUR[bankId] }}
    />
  );
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: Decimal;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label.toUpperCase()}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">
        <Private>{money(value)}</Private>
      </p>
    </div>
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
