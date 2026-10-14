'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { ptBR } from 'date-fns/locale';
import {
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Minus,
  Pause,
  Pencil,
  Play,
  PiggyBank,
  ReceiptText,
  Repeat2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { createClient } from '@/lib/supabase/client';
import { MATCH_LABEL, type MerchantAlias } from '@/lib/merchant-aliases';
import { IncomeRules } from '@/components/income-rules';
import { MerchantAliasDialog } from '@/components/merchant-alias-dialog';
import { refreshMountedWidgets } from '@/lib/manual-refresh';
import {
  duplicatePairs,
  merchantKey,
  nextMonth,
  recurringCandidates,
  saoDate,
  weeklySummary,
  type RecurringExpense,
} from '@/lib/expense-insights';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { resolveCardBank, type PaymentCard } from '@/lib/payment-cards';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Private } from '@/components/private-value';

type Rule = { merchant: string; category: string };
type NameRule = MerchantAlias;
const money = (v: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(v).toNumber(),
  );
const date = (s: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(s));

export function WeeklyExpenseSummary({
  entries,
  reserveGain,
  framed = true,
}: {
  entries: FinancialEntry[];
  reserveGain?: string;
  /** Sem a moldura de cartão: dentro do cartão das abas da home. */
  framed?: boolean;
}) {
  const s = weeklySummary(entries);
  const difference = new Decimal(s.total).minus(s.previous);
  const total = new Decimal(s.total);
  const spendingIncreased = difference.gt(0);
  const spendingDecreased = difference.lt(0);
  const DifferenceIcon = spendingIncreased
    ? ArrowUpRight
    : spendingDecreased
      ? ArrowDownRight
      : Minus;
  const comparisonLabel = spendingIncreased
    ? `${money(difference.abs())} a mais`
    : spendingDecreased
      ? `${money(difference.abs())} a menos`
      : 'Mesmo valor';
  const dayMonth = (iso: string) =>
    iso.split('-').reverse().slice(0, 2).join('/');
  // No domingo a semana tem um dia só; "27/09 – 27/09" pareceria erro.
  const period =
    s.start === s.end
      ? dayMonth(s.start)
      : `${dayMonth(s.start)} – ${dayMonth(s.end)}`;

  return (
    <section
      className={
        framed
          ? 'overflow-hidden rounded-3xl border bg-card shadow-sm'
          : 'overflow-hidden'
      }
      id="resumo-semanal"
    >
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4 md:px-6">
        <div>
          <h2 className="font-semibold tracking-tight">Resumo semanal</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Esta semana · {period}
          </p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
          <CalendarDays className="size-4" aria-hidden="true" />
        </span>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
        <div className="px-5 py-5 md:px-6 md:py-6">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Total gasto
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums md:text-4xl">
            {money(s.total)}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium">
              <ReceiptText className="size-3.5" aria-hidden="true" />
              {s.count} {s.count === 1 ? 'lançamento' : 'lançamentos'}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                spendingIncreased
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : spendingDecreased
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              <DifferenceIcon className="size-3.5" aria-hidden="true" />
              <Private>{comparisonLabel}</Private>
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {s.previousStart === s.previousEnd
              ? `Comparado ao domingo passado (${dayMonth(s.previousStart)})`
              : `Comparado à semana passada até o mesmo dia (${dayMonth(s.previousStart)} – ${dayMonth(s.previousEnd)})`}
          </p>
        </div>

        <div className="border-t px-5 py-5 md:border-t-0 md:border-l md:px-6 md:py-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Maiores categorias</p>
            <span className="text-[11px] text-muted-foreground">Top 3</span>
          </div>
          {s.categories.length ? (
            <div className="space-y-4">
              {s.categories.slice(0, 3).map((category) => {
                const percentage = total.gt(0)
                  ? new Decimal(category.total).div(total).times(100).toNumber()
                  : 0;
                return (
                  <div key={category.name}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-muted-foreground">
                        {category.name}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {money(category.total)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground transition-[width] duration-500"
                        style={{ width: `${Math.max(percentage, 4)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum gasto registrado neste período.
            </p>
          )}
        </div>
      </div>

      {reserveGain !== undefined && (
        <div className="flex items-center gap-3 border-t bg-muted/25 px-5 py-4 md:px-6">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background">
            <PiggyBank className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              Rendimento dos cofrinhos no período
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              + {money(reserveGain)}
            </p>
          </div>
        </div>
      )}

      <p className="border-t px-5 py-3 text-[11px] leading-relaxed text-muted-foreground md:px-6">
        Considera os lançamentos registrados no Vetra, no horário de São Paulo.
      </p>
    </section>
  );
}

export function ExpenseAssistant({
  userId,
  entries,
  onChanged,
  cards,
  settings = false,
  aiEnabled = false,
  weekly = true,
}: {
  userId: string;
  entries: FinancialEntry[];
  cards: PaymentCard[];
  onChanged: () => Promise<void>;
  settings?: boolean;
  aiEnabled?: boolean;
  /** O resumo semanal (o extrato não repete o da home). */
  weekly?: boolean;
}) {
  const db = useMemo(() => createClient(), []);
  const [rules, setRules] = useState<Rule[]>([]),
    [recurring, setRecurring] = useState<RecurringExpense[]>([]),
    [reviews, setReviews] = useState<string[]>([]),
    [nameRules, setNameRules] = useState<NameRule[]>([]),
    [creatingNameRule, setCreatingNameRule] = useState(false),
    [editingNameRule, setEditingNameRule] = useState<NameRule | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [merchant, setMerchant] = useState(''),
    [category, setCategory] = useState('');
  const [recMerchant, setRecMerchant] = useState(''),
    [recAccount, setRecAccount] = useState(''),
    [recAmount, setRecAmount] = useState(''),
    [recDate, setRecDate] = useState(saoDate(new Date())),
    [calendarOpen, setCalendarOpen] = useState(false);
  const load = useCallback(async () => {
    const results = await Promise.all(
      [
        'merchant_rules',
        'recurring_expenses',
        'expense_reviews',
        'merchant_aliases',
      ].map((t) => db.from(t).select('*')),
    );
    if (results.some((r) => r.error))
      throw new Error(
        'Não foi possível carregar o assistente. Tente atualizar.',
      );
    setRules(results[0].data as Rule[]);
    setRecurring(results[1].data as RecurringExpense[]);
    setReviews((results[2].data ?? []).map((r) => r.pair_key));
    setNameRules(
      ((results[3].data ?? []) as NameRule[]).sort((a, b) =>
        a.name.localeCompare(b.name, 'pt-BR'),
      ),
    );
    setReady(true);
  }, [db]);
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load, entries]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch {
      setError(
        'Não foi possível concluir. Confira a conexão e tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function write(table: string, data: object, conflict?: string) {
    const result = await db
      .from(table)
      .upsert(
        { ...data, user_id: userId },
        conflict ? { onConflict: conflict } : undefined,
      );
    if (result.error) throw result.error;
  }
  const pairs = duplicatePairs(entries).filter((p) => !reviews.includes(p.key));
  const candidates = recurringCandidates(entries).filter(
    (c) =>
      !recurring.some(
        (r) => r.merchant === c.merchant && r.account === c.account,
      ),
  );
  const myRecurring = recurring.filter((item) => item.paid_by_me !== false);
  async function saveRule(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    await run(async () => {
      await write(
        'merchant_rules',
        { merchant: merchantKey(merchant), category: category.trim() },
        'user_id,merchant',
      );
      setMerchant('');
      setCategory('');
    });
  }
  return (
    <div className="mt-7 min-w-0 space-y-5">
      {/* Nas Configurações não: o resumo da semana já está na home. */}
      {!settings && weekly && <WeeklyExpenseSummary entries={entries} />}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive p-3 text-sm"
        >
          {error}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(async () => {})}
          >
            Atualizar
          </Button>
        </p>
      )}
      {settings && (
        <section className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Categorização inteligente</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-xs ${
                aiEnabled
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {aiEnabled ? 'Gemini ativo' : 'Aguardando chave'}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Gastos sem categoria passam primeiro pelas regras que você ensinou e
            depois pela IA. Ao corrigir uma categoria no extrato, o Vetra
            aprende esse estabelecimento para as próximas compras.
          </p>
          {aiEnabled && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              O Gemini recebe só o nome do estabelecimento e a conta, sem
              números de documento ou e-mails. Pix nunca é enviado: a descrição
              é o nome de quem recebeu. No plano gratuito, o Google pode usar o
              que recebe para melhorar seus produtos.
            </p>
          )}
          {!aiEnabled && (
            <p className="mt-3 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
              Configure GEMINI_API_KEY somente no ambiente do servidor para
              ativar. Use um projeto sem faturamento habilitado para permanecer
              na cota gratuita. O app continua funcionando com as regras locais
              enquanto isso não for feito.
            </p>
          )}
        </section>
      )}
      {settings && (
        <details open className="group rounded-2xl border bg-card p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden after:content-[\'＋\'] group-open:after:content-[\'−\']">
            Regras de nome · {nameRules.length}{' '}
            {nameRules.length === 1 ? 'regra' : 'regras'}
          </summary>
          <p className="my-3 text-sm text-muted-foreground">
            Quando o nome de uma compra contiver um texto, ela passa a se chamar
            como você quiser (e, se quiser, cai numa categoria). Vale para toda
            compra nova, do banco, do Atalho ou à mão, e pode corrigir as
            antigas. Também dá para criar a partir de uma compra, em “Criar
            regra a partir desta compra”.
          </p>
          <Button
            type="button"
            variant="glass"
            size="sm"
            className="mb-3"
            disabled={busy}
            onClick={() => setCreatingNameRule(true)}
          >
            Nova regra
          </Button>
          {(creatingNameRule || editingNameRule) && (
            <MerchantAliasDialog
              key={editingNameRule?.id ?? 'nova'}
              rule={editingNameRule ?? undefined}
              onClose={() => {
                setCreatingNameRule(false);
                setEditingNameRule(null);
              }}
              onApplied={(changed) => {
                setCreatingNameRule(false);
                setEditingNameRule(null);
                void refreshMountedWidgets();
                void run(async () => {
                  if (changed) await onChanged();
                });
              }}
            />
          )}
          {nameRules.length ? (
            <ul className="space-y-3">
              {nameRules.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"
                >
                  <span className="min-w-0 break-words">
                    Quando o nome {MATCH_LABEL[r.match]} “{r.pattern}” →{' '}
                    <span className="font-medium">{r.name}</span>
                    {r.category ? ` · ${r.category}` : ''}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setEditingNameRule(r)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const result = await db
                            .from('merchant_aliases')
                            .delete()
                            .eq('id', r.id);
                          if (result.error) throw result.error;
                        })
                      }
                    >
                      Remover regra
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma regra ainda.
            </p>
          )}
        </details>
      )}
      {settings && <IncomeRules />}
      {settings && (
        <details className="group rounded-2xl border bg-card p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden after:content-[\'＋\'] group-open:after:content-[\'−\']">
            Categorias automáticas · {rules.length} regras
          </summary>
          <p className="my-3 text-sm text-muted-foreground">
            Correspondência exata do estabelecimento, ignorando maiúsculas.
            Novos gastos em “Outros” recebem a regra; categorias explícitas são
            preservadas.
          </p>
          <form onSubmit={saveRule} className="grid gap-3 sm:grid-cols-3">
            <Input
              aria-label="Estabelecimento da regra"
              list="vetra-merchants"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              maxLength={160}
              required
              placeholder="Estabelecimento"
            />
            <datalist id="vetra-merchants">
              {[...new Set(entries.map((e) => e.description))].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </datalist>
            <Input
              aria-label="Categoria automática"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={80}
              required
              placeholder="Categoria"
            />
            <Button
              disabled={busy || !ready || !merchant.trim() || !category.trim()}
            >
              Salvar regra
            </Button>
          </form>
          <ul className="mt-3 space-y-3">
            {rules.map((r) => (
              <li
                key={r.merchant}
                className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"
              >
                <span className="break-words">
                  {r.merchant} → {r.category}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setMerchant(r.merchant);
                      setCategory(r.category);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        // A native dialog is drawn by the browser, outside the
                        // page, so privacy mode cannot conceal this figure. It
                        // only appears on a deliberate click.
                        if (
                          !window.confirm(
                            'Aplicar esta categoria aos gastos anteriores deste estabelecimento?',
                          )
                        )
                          return;
                        const ids = entries
                          .filter(
                            (e) =>
                              merchantKey(e.description) === r.merchant &&
                              e.entry_type === 'expense',
                          )
                          .map((e) => e.id);
                        for (
                          let offset = 0;
                          offset < ids.length;
                          offset += 100
                        ) {
                          const result = await db
                            .from('financial_entries')
                            .update({ category: r.category })
                            .in('id', ids.slice(offset, offset + 100))
                            .eq('user_id', userId);
                          if (result.error) throw result.error;
                        }
                        await onChanged();
                      })
                    }
                  >
                    Aplicar ao histórico
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await db
                          .from('merchant_rules')
                          .delete()
                          .eq('user_id', userId)
                          .eq('merchant', r.merchant);
                        if (result.error) throw result.error;
                      })
                    }
                  >
                    Remover regra
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!settings && (
        <details
          className="group overflow-hidden rounded-3xl border bg-card shadow-sm"
          open={pairs.length > 0}
        >
          <summary className="flex cursor-pointer list-none items-center gap-3 p-5 [&::-webkit-details-marker]:hidden md:p-6">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Possíveis duplicatas</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Revise cobranças muito parecidas
              </span>
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums">
              {pairs.length}
            </span>
            <span className="text-muted-foreground group-open:hidden">＋</span>
            <span className="hidden text-muted-foreground group-open:inline">
              −
            </span>
          </summary>
          <p className="border-t px-5 pt-4 text-sm leading-relaxed text-muted-foreground md:px-6">
            Mesmo cartão, estabelecimento e valor em até 5 minutos. Nada é
            excluído automaticamente.
          </p>
          <div className="space-y-3 p-5 md:p-6">
            {pairs.slice(0, 20).map((p) => (
              <div
                key={p.key}
                className="rounded-2xl border bg-background/40 p-4 text-sm"
              >
                <div className="flex items-start gap-3">
                  <PaymentCardIcon
                    bankId={resolveCardBank(p.a.account, cards)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="truncate font-semibold">
                        {p.a.description}
                      </p>
                      <p className="font-semibold tabular-nums">
                        {money(p.a.amount)}
                      </p>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {p.a.account}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 rounded-xl bg-muted/45 p-3 text-xs sm:grid-cols-2">
                  <span className="flex items-center gap-2">
                    <Clock3 className="size-3.5" />
                    {date(p.a.occurred_at)}
                  </span>
                  <span className="flex items-center gap-2">
                    <Clock3 className="size-3.5" />
                    {date(p.b.occurred_at)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await write(
                          'expense_reviews',
                          { pair_key: p.key },
                          'user_id,pair_key',
                        );
                      })
                    }
                  >
                    <CheckCircle2 />
                    São duas compras
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (
                          !window.confirm(
                            `Excluir o lançamento de ${date(p.b.occurred_at)} (${money(p.b.amount)}) e manter o outro?`,
                          )
                        )
                          return;
                        const result = await db
                          .from('financial_entries')
                          .delete()
                          .eq('id', p.b.id)
                          .eq('user_id', userId);
                        if (result.error) throw result.error;
                        await onChanged();
                      })
                    }
                  >
                    <Trash2 />
                    Excluir duplicata
                  </Button>
                </div>
              </div>
            ))}
            {!pairs.length && (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                <CheckCircle2 className="size-5 text-emerald-500" />
                Nenhuma suspeita pendente.
              </div>
            )}
            {pairs.length > 20 && (
              <p className="text-xs text-muted-foreground">
                Mostrando 20 de {pairs.length}. Revise para ver as próximas.
              </p>
            )}
          </div>
        </details>
      )}
      {!settings && (
        <details className="group overflow-hidden rounded-3xl border bg-card shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-5 [&::-webkit-details-marker]:hidden md:p-6">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-600 dark:text-violet-400">
              <Repeat2 className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                Assinaturas e recorrências
              </span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Previsão dos compromissos mensais
              </span>
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums">
              {myRecurring.filter((r) => r.active).length} ativas
            </span>
            <span className="text-muted-foreground group-open:hidden">＋</span>
            <span className="hidden text-muted-foreground group-open:inline">
              −
            </span>
          </summary>
          <div className="border-t p-5 md:p-6">
            <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Sugestões exigem três cobranças mensais semelhantes. Confirme
                antes de acompanhar. Não cria gastos nem cobra valores
                automaticamente.
              </p>
              <div className="rounded-2xl bg-muted/50 px-4 py-3 sm:text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Compromisso anual
                </p>
                <p className="mt-1 font-semibold tabular-nums">
                  {money(
                    myRecurring
                      .filter((r) => r.active)
                      .reduce(
                        (s, r) => s.plus(new Decimal(r.amount).times(12)),
                        new Decimal(0),
                      ),
                  )}
                </p>
              </div>
            </div>
            {candidates.map((c) => (
              <div
                key={JSON.stringify([c.merchant, c.account])}
                className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 text-sm"
              >
                <Sparkles className="size-4 text-violet-500" />
                <PaymentCardIcon bankId={resolveCardBank(c.account, cards)} />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate capitalize">
                    {c.merchant}
                  </strong>
                  <span className="text-xs text-muted-foreground">
                    {c.account} · <Private>{money(c.amount)}</Private>/mês
                  </span>
                </span>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await write(
                        'recurring_expenses',
                        { ...c, active: true },
                        'user_id,merchant,account',
                      );
                    })
                  }
                >
                  Confirmar recorrência
                </Button>
              </div>
            ))}
            <form
              className="mt-5 grid gap-4 rounded-2xl border bg-background/40 p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await write(
                    'recurring_expenses',
                    {
                      merchant: merchantKey(recMerchant),
                      account: recAccount.trim(),
                      amount: new Decimal(recAmount.replace(/\D/g, '') || 0)
                        .div(100)
                        .toFixed(2),
                      next_date: recDate,
                      billing_day: Number(recDate.slice(-2)),
                      active: true,
                    },
                    'user_id,merchant,account',
                  );
                  setRecMerchant('');
                  setRecAmount('');
                });
              }}
            >
              <Input
                aria-label="Nome da assinatura"
                required
                maxLength={160}
                value={recMerchant}
                onChange={(e) => setRecMerchant(e.target.value)}
                placeholder="Nome da assinatura"
              />
              <Select
                value={recAccount}
                onValueChange={(value) => value && setRecAccount(value)}
              >
                <SelectTrigger
                  aria-label="Cartão da assinatura"
                  className="w-full overflow-hidden"
                >
                  {recAccount ? (
                    <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                      <PaymentCardIcon
                        bankId={resolveCardBank(recAccount, cards)}
                      />
                      <span className="truncate">{recAccount}</span>
                    </span>
                  ) : (
                    <SelectValue
                      placeholder={
                        cards.length
                          ? 'Escolha o cartão'
                          : 'Vincule um cartão em Configurações'
                      }
                    />
                  )}
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  alignItemWithTrigger={false}
                  collisionAvoidance={{ side: 'none', align: 'shift' }}
                  className="max-h-64 overflow-y-auto"
                >
                  {cards.map((card) => (
                    <SelectItem key={card.account} value={card.account}>
                      <PaymentCardIcon bankId={card.bank_id} />
                      <span className="truncate">{card.account}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Valor mensal da assinatura"
                inputMode="numeric"
                required
                value={recAmount}
                onChange={(e) => {
                  const n = e.target.value.replace(/\D/g, '').slice(0, 15);
                  setRecAmount(n ? money(new Decimal(n).div(100)) : '');
                }}
                placeholder="R$ 0,00"
              />
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                    />
                  }
                >
                  Próxima: {recDate.split('-').reverse().join('/')}
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    locale={ptBR}
                    selected={new Date(`${recDate}T12:00:00`)}
                    onSelect={(d) => {
                      if (d) {
                        setRecDate(
                          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                        );
                        setCalendarOpen(false);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
              <Button
                className="sm:col-span-2"
                disabled={
                  busy ||
                  !ready ||
                  !recMerchant.trim() ||
                  !recAccount.trim() ||
                  !recAmount
                }
              >
                <Repeat2 />
                Salvar assinatura mensal
              </Button>
            </form>
            {!cards.length && (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <CreditCard className="size-4" /> Vincule seus cartões em
                Configurações para selecionar a forma de pagamento.
              </p>
            )}
            {myRecurring.map((r) => (
              <div key={r.id} className="mt-3 rounded-2xl border p-4 text-sm">
                <div className="flex items-start gap-3">
                  <PaymentCardIcon bankId={resolveCardBank(r.account, cards)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="truncate font-semibold capitalize">
                        {r.merchant}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${r.active ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}
                      >
                        {r.active ? 'Ativa' : 'Pausada'}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {r.account}
                    </p>
                    <p className="mt-2 font-semibold tabular-nums">
                      {money(r.amount)}
                      <span className="font-normal text-muted-foreground">
                        /mês
                      </span>
                    </p>
                  </div>
                </div>
                <p
                  className={`mt-3 flex items-center gap-2 rounded-xl bg-muted/45 p-3 text-xs ${r.next_date < saoDate(new Date()) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                >
                  <CalendarDays className="size-4" />
                  {r.next_date < saoDate(new Date())
                    ? 'Previsão vencida:'
                    : 'Próxima previsão:'}{' '}
                  {r.next_date.split('-').reverse().join('/')}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRecMerchant(r.merchant);
                      setRecAccount(r.account);
                      setRecAmount(money(r.amount));
                      setRecDate(r.next_date);
                    }}
                  >
                    <Pencil />
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await write(
                          'recurring_expenses',
                          { ...r, active: !r.active },
                          'user_id,merchant,account',
                        );
                      })
                    }
                  >
                    {r.active ? <Pause /> : <Play />}
                    {r.active ? 'Pausar' : 'Retomar'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !r.active}
                    onClick={() =>
                      void run(async () => {
                        await write(
                          'recurring_expenses',
                          {
                            ...r,
                            next_date: nextMonth(r.next_date, r.billing_day),
                          },
                          'user_id,merchant,account',
                        );
                      })
                    }
                  >
                    <CalendarDays />
                    Avançar previsão um mês
                  </Button>
                </div>
              </div>
            ))}
            {!myRecurring.length && !candidates.length && (
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                <Repeat2 className="size-5" /> Nenhuma recorrência acompanhada
                ainda.
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
