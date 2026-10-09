'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Check, Plus, X } from 'lucide-react';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { spentByDayOf, type AllowanceDay } from '@/lib/daily-allowance';
import { saoDate } from '@/lib/expense-insights';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { createClient } from '@/lib/supabase/client';
import { leftoverByDay, wishProgress, type WishlistItem } from '@/lib/wishlist';

/* Lista de desejos: sobra já juntada por desejo e dias que faltam (lib/wishlist.ts). */

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value).toNumber(),
  );

const moneyInput = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  return digits ? money(new Decimal(digits).div(100)) : '';
};

export function WishlistCard({
  entries,
  flat = false,
}: {
  entries: FinancialEntry[];
  /** Sem moldura: dentro da aba Cofrinhos da home. */
  flat?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [allowances, setAllowances] = useState<AllowanceDay[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [wishes, days] = await Promise.all([
      supabase
        .from('wishlist_items')
        .select('id, name, price, created_at, bought_at')
        .is('bought_at', null)
        .order('created_at'),
      supabase.from('daily_allowances').select('day, allowance'),
    ]);
    setItems((wishes.data ?? []) as WishlistItem[]);
    setAllowances((days.data ?? []) as AllowanceDay[]);
  }, [supabase]);

  useEffect(() => {
    // Na volta da promessa, não no corpo do efeito (React Compiler).
    void Promise.resolve().then(load);
  }, [load]);

  const today = saoDate(new Date());
  const leftover = useMemo(
    () =>
      leftoverByDay({
        today,
        allowances,
        spentByDay: spentByDayOf(entries),
      }),
    [allowances, entries, today],
  );

  async function add(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = price.replace(/\D/g, '');
    const value = digits ? new Decimal(digits).div(100) : new Decimal(0);
    if (!name.trim() || value.lte(0))
      return setError('Diga o que é e quanto custa.');
    setBusy(true);
    setError('');
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: failure } = user
      ? await supabase.from('wishlist_items').insert({
          user_id: user.id,
          name: name.trim().slice(0, 80),
          price: value.toFixed(2),
        })
      : { error: new Error('sem sessão') };
    setBusy(false);
    if (failure) return setError('Não foi possível salvar. Tente de novo.');
    setName('');
    setPrice('');
    setAdding(false);
    await load();
  }

  async function finish(id: string, bought: boolean) {
    setItems((current) => current?.filter((item) => item.id !== id) ?? null);
    const { error: failure } = bought
      ? await supabase
          .from('wishlist_items')
          .update({ bought_at: new Date().toISOString() })
          .eq('id', id)
      : await supabase.from('wishlist_items').delete().eq('id', id);
    if (failure) await load();
  }

  if (items === null) return null;

  return (
    <section
      className={
        flat ? 'min-w-0' : 'rounded-3xl border bg-card p-5 shadow-sm md:p-6'
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={flat ? 'text-[15px] font-semibold' : 'font-semibold'}>
            Lista de desejos
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Juntando a sobra do valor de cada dia.
          </p>
        </div>
        {!adding &&
          (flat ? (
            <Button
              type="button"
              variant="glass-quiet"
              size="icon"
              aria-label="Adicionar desejo"
              className="size-9 shrink-0 rounded-full"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="glass-quiet"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-3.5" />
              Adicionar
            </Button>
          ))}
      </div>

      {adding && (
        <form
          onSubmit={add}
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_9rem_auto]"
        >
          <Input
            aria-label="O que você quer comprar"
            placeholder="Ex.: Fone"
            maxLength={80}
            className="h-11"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            aria-label="Quanto custa"
            placeholder="R$ 0,00"
            inputMode="numeric"
            className="h-11 tabular-nums"
            value={price}
            onChange={(event) => setPrice(moneyInput(event.target.value))}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="glass"
              className="h-11 flex-1"
              disabled={busy}
            >
              Salvar
            </Button>
            <Button
              type="button"
              variant="glass-quiet"
              className="h-11"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setError('');
              }}
            >
              Cancelar
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive sm:col-span-3">
              {error}
            </p>
          )}
        </form>
      )}

      {items.length ? (
        <ul className="mt-4 grid gap-4">
          {items.map((item) => {
            const progress = wishProgress({ item, today, leftover });
            return (
              <li key={item.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {item.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="text-sm tabular-nums">
                      <Private>{money(item.price)}</Private>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Comprei: ${item.name}`}
                      title="Comprei"
                      className="text-muted-foreground"
                      onClick={() => void finish(item.id, true)}
                    >
                      <Check />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Tirar da lista: ${item.name}`}
                      title="Tirar da lista"
                      className="-mr-2 text-muted-foreground"
                      onClick={() => void finish(item.id, false)}
                    >
                      <X />
                    </Button>
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10"
                >
                  <span
                    className="block h-full rounded-full bg-emerald-500"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {progress.ready ? (
                    'Pronto: dá para comprar sem apertar ✨'
                  ) : (
                    <>
                      <Private>{money(progress.saved)}</Private> de sobra ·{' '}
                      {progress.daysLeft === null
                        ? 'sobre um pouco do valor do dia para começar'
                        : progress.daysLeft === 1
                          ? 'falta ~1 dia'
                          : `faltam ~${progress.daysLeft} dias`}
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        !adding && (
          <p
            className={
              flat
                ? 'mt-4 rounded-2xl border border-dashed px-4 py-3.5 text-sm text-muted-foreground'
                : 'mt-4 text-sm text-muted-foreground'
            }
          >
            Adicione algo que você quer comprar: o Vetra conta quantos dias de
            sobra faltam para chegar lá sem apertar.
          </p>
        )
      )}
    </section>
  );
}
