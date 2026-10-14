'use client';

import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/date-input';
import { Private } from '@/components/private-value';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { loadUnidentifiedSpend } from '@/lib/unidentified-spend-query';
import { refreshWidgetsOnce } from '@/lib/manual-refresh';
import { saoDate } from '@/lib/expense-insights';
import type { SplitPart } from '@/lib/unidentified-spend';

/* Dividir uma compra a chegar: a queda do limite de um dia pode ser várias
   compras, e o dia em que o app viu a queda pode não ser o da compra. As
   partes ficam em pending_spend_splits e somem sozinhas quando as compras
   chegam do banco (applySplits, lib/unidentified-spend.ts). */

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value).toNumber(),
  );
const moneyInput = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  return digits ? money(new Decimal(digits).div(100)) : '';
};
const moneyValue = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits ? new Decimal(digits).div(100) : new Decimal(0);
};
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

type Row = { amount: string; day: string; description: string };

export function PendingSpendDialog({
  account,
  day,
  open,
  onOpenChange,
}: {
  account: string;
  /** Dia em que o app viu a queda do limite (a chave da divisão). */
  day: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useMemo(() => createClient(), []);
  const [total, setTotal] = useState<string | null>(null);
  // Hora da foto que mostrou a queda: a divisão vale até ela.
  const [seenUntil, setSeenUntil] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const [items, split] = await Promise.all([
        loadUnidentifiedSpend(client),
        client
          .from('pending_spend_splits')
          .select('parts, seen_until')
          .eq('account', account)
          .eq('day', day)
          .maybeSingle(),
      ]);
      if (!live) return;
      const mine = items.filter(
        (item) =>
          item.account === account && (item.split?.day ?? item.day) === day,
      );
      const divided = mine.find((item) => item.split);
      const plain = mine.find((item) => !item.split);
      const amount = divided?.split?.total ?? plain?.amount ?? null;
      setTotal(amount);
      setSeenUntil(
        divided ? (split.data?.seen_until ?? divided.at) : (plain?.at ?? null),
      );
      // Divisão já cumprida (as compras chegaram): começa do zero.
      const parts = divided ? ((split.data?.parts ?? []) as SplitPart[]) : [];
      setSaved(parts.length > 0);
      setRows(
        parts.length
          ? parts.map((part) => ({
              amount: money(part.amount),
              day: part.day,
              description: part.description ?? '',
            }))
          : // Começa com duas partes no dia anterior: o caso mais comum é o
            // limite ter caído de noite e só aparecer na leitura da manhã.
            [
              { amount: '', day: addDays(day, -1), description: '' },
              { amount: '', day: addDays(day, -1), description: '' },
            ],
      );
      setError('');
    })();
    return () => {
      live = false;
    };
  }, [open, account, day, client]);

  const sum = rows.reduce(
    (value, row) => value.plus(moneyValue(row.amount)),
    new Decimal(0),
  );
  const rest = total ? new Decimal(total).minus(sum) : new Decimal(0);
  const over = rest.lt(-0.005);
  const done = !over && rest.lte(0.005);
  const distributed = total
    ? Math.min(100, sum.div(total).times(100).toNumber())
    : 0;
  const today = saoDate(new Date());

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  async function save() {
    if (!total) return;
    const parts = rows
      .filter((row) => moneyValue(row.amount).gt(0))
      .map((row) => ({
        amount: moneyValue(row.amount).toFixed(2),
        day: row.day,
        description: row.description.trim().slice(0, 60) || null,
      }));
    if (!parts.length)
      return setError('Informe o valor de pelo menos uma compra.');
    if (rest.lt(-0.05))
      return setError(
        `As partes passam do valor que caiu no limite (${money(total)}).`,
      );
    if (parts.some((part) => part.day > today || part.day < addDays(day, -7)))
      return setError(
        'As datas vão até 7 dias antes da queda do limite, e não depois de hoje.',
      );
    setBusy(true);
    setError('');
    const {
      data: { user },
    } = await client.auth.getUser();
    const { error: failure } = user
      ? await client.from('pending_spend_splits').upsert(
          {
            user_id: user.id,
            account,
            day,
            parts,
            total: new Decimal(total).toFixed(2),
            seen_until: seenUntil,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,account,day' },
        )
      : { error: new Error('sem sessão') };
    setBusy(false);
    if (failure) return setError('Não foi possível salvar. Tente de novo.');
    onOpenChange(false);
    await refreshWidgetsOnce();
  }

  async function undo() {
    setBusy(true);
    const { error: failure } = await client
      .from('pending_spend_splits')
      .delete()
      .eq('account', account)
      .eq('day', day);
    setBusy(false);
    if (failure) return setError('Não foi possível desfazer. Tente de novo.');
    onOpenChange(false);
    await refreshWidgetsOnce();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dividir compra a chegar</DialogTitle>
          <DialogDescription>
            O limite do {account} caiu{' '}
            {total ? <Private>{money(total)}</Private> : 'um valor'} até{' '}
            {shortDay(day)}. Separe as compras e corrija as datas; quando elas
            chegarem do banco, somem daqui sozinhas.
          </DialogDescription>
        </DialogHeader>

        {/* O que falta distribuir desce a cada valor digitado. */}
        {total && (
          <div className="rounded-2xl bg-muted/50 p-4" aria-live="polite">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Total que caiu no limite
              </span>
              <span className="text-sm font-semibold tabular-nums">
                <Private>{money(total)}</Private>
              </span>
            </div>
            <div
              aria-hidden="true"
              className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10"
            >
              <span
                className={`block h-full rounded-full transition-[width] duration-300 ${over ? 'bg-destructive' : 'bg-emerald-500'}`}
                style={{ width: `${distributed}%` }}
              />
            </div>
            <p
              className={`mt-3 text-base font-semibold tracking-tight ${over ? 'text-destructive' : ''}`}
            >
              {over ? (
                <>
                  Passou <Private>{money(rest.negated())}</Private> do total
                </>
              ) : done ? (
                'Tudo distribuído'
              ) : (
                <>
                  Ainda restam <Private>{money(rest)}</Private> para distribuir
                </>
              )}
            </p>
            {!over && !done && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                O que sobrar segue como compra a chegar.
              </p>
            )}
          </div>
        )}

        <ul className="grid gap-3">
          {rows.map((row, index) => (
            <li key={index} className="grid gap-2 rounded-2xl border p-3">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="relative">
                  <Input
                    aria-label={`Valor da compra ${index + 1}`}
                    placeholder={
                      rest.gt(0.005) ? `Restam ${money(rest)}` : 'R$ 0,00'
                    }
                    inputMode="numeric"
                    className={`h-11 tabular-nums ${!row.amount && rest.gt(0.005) ? 'pr-28' : ''}`}
                    value={row.amount}
                    onChange={(event) =>
                      update(index, { amount: moneyInput(event.target.value) })
                    }
                  />
                  {!row.amount && rest.gt(0.005) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute top-1/2 right-1.5 h-8 -translate-y-1/2 px-2.5 text-xs"
                      onClick={() => update(index, { amount: money(rest) })}
                    >
                      Usar o resto
                    </Button>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 text-muted-foreground"
                  aria-label={`Tirar a compra ${index + 1}`}
                  disabled={rows.length === 1}
                  onClick={() =>
                    setRows((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="grid grid-cols-[10.5rem_minmax(0,1fr)] gap-2">
                <DateInput
                  id={`pending-day-${index}`}
                  value={row.day}
                  min={addDays(day, -7)}
                  max={today}
                  onValueChange={(value) => update(index, { day: value })}
                />
                <Input
                  aria-label={`Nome da compra ${index + 1} (opcional)`}
                  placeholder="Nome"
                  maxLength={60}
                  className="h-11"
                  value={row.description}
                  onChange={(event) =>
                    update(index, { description: event.target.value })
                  }
                />
              </div>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="glass-quiet"
          className="w-full gap-1.5"
          disabled={rows.length >= 12}
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                amount: '',
                day: current.at(-1)?.day ?? addDays(day, -1),
                description: '',
              },
            ])
          }
        >
          <Plus className="size-4" />
          Mais uma compra
        </Button>

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2">
          {saved && (
            <Button
              type="button"
              variant="glass-quiet"
              disabled={busy}
              onClick={() => void undo()}
            >
              Desfazer divisão
            </Button>
          )}
          <Button
            type="button"
            variant="glass"
            disabled={busy || !total}
            onClick={() => void save()}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
