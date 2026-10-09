'use client';

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { resolvePaymentMethod, type PaymentCard } from '@/lib/payment-cards';
import { reviewKey, reviewQueue, type ReviewCard } from '@/lib/review-queue';
import { createClient } from '@/lib/supabase/client';

/* Fila de revisão (lib/review-queue.ts), uma carta por vez. Salvar vira regra
   (`save_merchant_alias`) e corrige as compras existentes e as próximas. */

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value).toNumber(),
  );
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const CATEGORIES = EXPENSE_CATEGORIES.filter((value) => value !== 'Outros');

export function ReviewQueueView({
  entries,
  cards,
  skipped: initialSkipped,
  taught: initialTaught,
}: {
  entries: FinancialEntry[];
  cards: PaymentCard[];
  skipped: string[];
  /** Nomes com regra de categoria (`merchant_rules`), em minúsculas. */
  taught: string[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [skipped, setSkipped] = useState(() => new Set(initialSkipped));
  const taught = useMemo(() => new Set(initialTaught), [initialTaught]);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const queue = useMemo(
    () =>
      reviewQueue(entries, skipped, undefined, taught).filter(
        (card) => !done.has(card.key),
      ),
    [done, entries, skipped, taught],
  );
  const total = useMemo(
    () =>
      reviewQueue(entries, new Set(initialSkipped), undefined, taught).length,
    [entries, initialSkipped, taught],
  );
  const card = queue[0];
  const [message, setMessage] = useState('');

  return (
    <main className="min-h-dvh overflow-x-clip bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AppHeader onRefresh={() => window.location.reload()} />
      <div className="app-container min-w-0 max-w-xl py-6 md:py-9">
        <NavigationBackButton className="mb-5" />
        <h1 className="text-2xl font-semibold tracking-tight">
          Revisar compras
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Compras sem categoria ou com nome estranho. Cada uma que você resolve
          vira regra: as próximas já chegam certas.
        </p>
        {message && (
          <output className="mt-4 block rounded-2xl border bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            {message}
          </output>
        )}
        {card ? (
          <ReviewCardPanel
            key={card.key}
            card={card}
            position={total - queue.length + 1}
            total={total}
            cards={cards}
            onSaved={async (name, category) => {
              const { data, error } = await supabase.rpc(
                'save_merchant_alias',
                {
                  p_match: 'exact',
                  p_pattern: card.description,
                  p_name: name,
                  p_category: category,
                  p_apply: true,
                  p_preview: false,
                },
              );
              if (error) throw error;
              // Resolvida: não volta mais à fila (o nome antigo e o novo).
              const {
                data: { user },
              } = await supabase.auth.getUser();
              if (user)
                await supabase.from('expense_reviews').upsert(
                  [card.description, name].map((value) => ({
                    user_id: user.id,
                    pair_key: reviewKey(value),
                  })),
                  { onConflict: 'user_id,pair_key', ignoreDuplicates: true },
                );
              const changed = Number(data ?? 0);
              setDone((current) => new Set([...current, card.key]));
              setMessage(
                `${name}: ${changed === 1 ? '1 compra atualizada' : `${changed} compras atualizadas`}. As próximas já chegam assim.`,
              );
            }}
            onSkip={async () => {
              const {
                data: { user },
              } = await supabase.auth.getUser();
              if (user)
                await supabase
                  .from('expense_reviews')
                  .upsert(
                    { user_id: user.id, pair_key: reviewKey(card.description) },
                    { onConflict: 'user_id,pair_key', ignoreDuplicates: true },
                  );
              setSkipped((current) => new Set([...current, card.key]));
              setMessage('');
            }}
          />
        ) : (
          <section className="mt-8 grid min-h-48 place-items-center rounded-3xl border bg-card p-6 text-center">
            <div>
              <p className="text-3xl">🎉</p>
              <h2 className="mt-2 font-semibold">Tudo revisado</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Quando chegar uma compra sem categoria ou com nome estranho, ela
                aparece aqui.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ReviewCardPanel({
  card,
  position,
  total,
  cards,
  onSaved,
  onSkip,
}: {
  card: ReviewCard;
  position: number;
  total: number;
  cards: PaymentCard[];
  onSaved: (name: string, category: string | null) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [name, setName] = useState(card.description);
  const [category, setCategory] = useState<string | null>(
    card.category === 'Outros' ? null : card.category,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changedName = name.trim() !== card.description;
  const canSave = Boolean(name.trim()) && (category !== null || changedName);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError('Não foi possível salvar. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border bg-card p-5 shadow-sm md:p-6">
      <p className="text-xs text-muted-foreground tabular-nums">
        {position} de {total}
      </p>
      <div className="mt-3 flex items-center gap-3.5">
        <PaymentCardIcon bankId={resolvePaymentMethod(card.account, cards)} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{card.description}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {card.count === 1 ? '1 compra' : `${card.count} compras`} ·{' '}
            <Private>{money(card.total)}</Private> · última em{' '}
            {shortDay(card.lastDay)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {card.reasons.map((reason) => (
          <span
            key={reason}
            className="rounded-full bg-amber-500/12 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400"
          >
            {reason}
          </span>
        ))}
      </div>

      <label htmlFor="review-name" className="mt-5 grid gap-2 text-sm">
        Chamar de
        <Input
          id="review-name"
          maxLength={160}
          className="h-11"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm">Categoria</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={category === value ? 'glass' : 'glass-quiet'}
              aria-pressed={category === value}
              className="rounded-full"
              onClick={() => setCategory(category === value ? null : value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <Button
          type="button"
          variant="glass"
          className="h-11 flex-1"
          disabled={busy || !canSave}
          onClick={() => void run(() => onSaved(name.trim(), category))}
        >
          {busy ? 'Salvando…' : 'Salvar e ensinar'}
        </Button>
        <Button
          type="button"
          variant="glass-quiet"
          className="h-11"
          disabled={busy}
          onClick={() => void run(onSkip)}
        >
          Pular
        </Button>
      </div>
    </section>
  );
}
