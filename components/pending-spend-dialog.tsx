'use client';

import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { createClient } from '@/lib/supabase/client';
import { loadUnidentifiedSpend } from '@/lib/unidentified-spend-query';
import { refreshWidgetsOnce } from '@/lib/manual-refresh';
import { saoDate } from '@/lib/expense-insights';
import type { SplitPart } from '@/lib/unidentified-spend';
import { money } from '@/lib/money';

/* Compra a chegar: o limite caiu e a compra ainda não veio do banco. Abre com
   uma compra só (o valor todo, no dia da queda); "Separar outra compra" cria a
   seguinte já com o que falta, e o que nenhuma pegou segue a chegar. As
   compras ficam em pending_spend_splits e somem sozinhas quando chegam do
   banco (applySplits, lib/unidentified-spend.ts). */

/** Digitação em centavos: "1234" vira "R$ 12,34". */
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

type Row = {
  /** Chave estável: tirar uma compra não troca os campos das outras. */
  id: number;
  amount: string;
  day: string;
  description: string;
  /** "Fora das contas" desde já (`SplitPart.excluded`). */
  excluded: boolean;
};

let nextId = 0;
const newRow = (row: Omit<Row, 'id'>): Row => ({ id: ++nextId, ...row });

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
  // Passou de 3 dias úteis sem chegar: o usuário decide se tira.
  const [overdue, setOverdue] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
      const now = saoDate(new Date());
      setTotal(amount);
      setOverdue(mine.some((item) => item.overdue));
      setSeenUntil(
        divided ? (split.data?.seen_until ?? divided.at) : (plain?.at ?? null),
      );
      // Divisão já cumprida (as compras chegaram): começa do zero.
      const parts = divided ? ((split.data?.parts ?? []) as SplitPart[]) : [];
      setSaved(parts.length > 0);
      setRows(
        parts.length
          ? parts.map((part) =>
              newRow({
                amount: money(part.amount),
                day: part.day,
                description: part.description ?? '',
                excluded: part.excluded === true,
              }),
            )
          : [
              newRow({
                amount: amount ? money(amount) : '',
                day: day > now ? now : day,
                description: '',
                excluded: false,
              }),
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
  const over = rest.lt(-0.05);
  const today = saoDate(new Date());
  const earliest = addDays(day, -7);
  const single = rows.length === 1;

  const update = (id: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  // A próxima compra já vem com o que falta distribuir.
  const addRow = () =>
    setRows((current) => [
      ...current,
      newRow({
        amount: rest.gt(0.005) ? money(rest) : '',
        day: current.at(-1)?.day ?? day,
        description: '',
        excluded: false,
      }),
    ]);

  async function save() {
    if (!total) return;
    const parts = rows
      .filter((row) => moneyValue(row.amount).gt(0))
      .map((row) => ({
        amount: moneyValue(row.amount).toFixed(2),
        day: row.day,
        description: row.description.trim().slice(0, 60) || null,
        ...(row.excluded && { excluded: true }),
      }));
    if (!parts.length) return setError('Informe o valor da compra.');
    if (over)
      return setError(
        `As compras passam do valor que caiu no limite (${money(total)}).`,
      );
    if (parts.some((part) => part.day > today || part.day < earliest))
      return setError(
        `A data vai de ${shortDay(earliest)} até hoje; a compra não pode ser de depois.`,
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

  async function dismiss() {
    setBusy(true);
    const { error: failure } = await client
      .from('pending_spend_dismissals')
      .upsert({ account, day }, { onConflict: 'user_id,account,day' });
    setBusy(false);
    setConfirming(false);
    if (failure)
      return setError('Não foi possível tirar a compra. Tente de novo.');
    onOpenChange(false);
    await refreshWidgetsOnce();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Compra a chegar</DialogTitle>
            <DialogDescription>
              O limite do {account} caiu{' '}
              {total ? <Private>{money(total)}</Private> : 'um valor'} em{' '}
              {shortDay(day)} e a compra ainda não veio do banco. Dê um nome,
              acerte a data ou separe em várias compras; quando chegarem, somem
              daqui sozinhas.
            </DialogDescription>
          </DialogHeader>

          {overdue && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Clock className="size-4 text-amber-600 dark:text-amber-400" />
                Passou de 3 dias e não chegou
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Alguns bancos, como o PicPay, demoram até 7 dias. Se você sabe
                que ela não vai chegar, toque em “Não vai chegar”.
              </p>
            </div>
          )}

          <ul className="grid gap-3">
            {rows.map((row, index) => {
              const label = single ? 'da compra' : `da compra ${index + 1}`;
              return (
                <li key={row.id} className="grid gap-3 rounded-2xl border p-3">
                  {!single && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        Compra {index + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-my-1 h-8 gap-1 px-2 text-xs text-muted-foreground"
                        onClick={() =>
                          setRows((current) =>
                            current.filter((item) => item.id !== row.id),
                          )
                        }
                      >
                        <Trash2 className="size-3.5" />
                        Tirar
                      </Button>
                    </div>
                  )}
                  <Input
                    aria-label={`Nome ${label} (opcional)`}
                    placeholder="Nome (ex.: Padaria)"
                    maxLength={60}
                    className="h-11"
                    value={row.description}
                    onChange={(event) =>
                      update(row.id, { description: event.target.value })
                    }
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      aria-label={`Valor ${label}`}
                      placeholder="R$ 0,00"
                      inputMode="numeric"
                      className="h-11 tabular-nums"
                      value={row.amount}
                      onChange={(event) =>
                        update(row.id, {
                          amount: moneyInput(event.target.value),
                        })
                      }
                    />
                    <DateInput
                      id={`pending-day-${row.id}`}
                      value={row.day}
                      min={earliest}
                      max={today}
                      onValueChange={(value) => update(row.id, { day: value })}
                    />
                  </div>
                  {/* Segue na fatura, sai dos gastos; chega do banco já assim. */}
                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor={`pending-excluded-${row.id}`}
                      className="grid gap-0.5 text-sm font-normal"
                    >
                      Fora das contas
                      <span className="text-xs text-muted-foreground">
                        Fica na fatura, mas não conta como gasto
                      </span>
                    </Label>
                    <Switch
                      id={`pending-excluded-${row.id}`}
                      checked={row.excluded}
                      onCheckedChange={(checked) =>
                        update(row.id, { excluded: checked })
                      }
                    />
                  </div>
                </li>
              );
            })}

            {/* O que nenhuma compra pegou: segue a chegar, sem conta a fazer. */}
            {total && rest.gt(0.005) && (
              <li className="flex items-center justify-between gap-3 rounded-2xl border border-dashed px-3 py-2.5 text-sm">
                <span className="text-muted-foreground">
                  Resto, continua a chegar
                </span>
                <span className="font-medium tabular-nums">
                  <Private>{money(rest)}</Private>
                </span>
              </li>
            )}
          </ul>

          {over && total && (
            <p role="alert" className="text-xs text-destructive">
              As compras passam <Private>{money(rest.negated())}</Private> do
              valor que caiu no limite. Diminua algum valor.
            </p>
          )}

          <Button
            type="button"
            variant="glass-quiet"
            className="w-full gap-1.5"
            disabled={rows.length >= 12 || !total}
            onClick={addRow}
          >
            <Plus className="size-4" />
            Separar outra compra
          </Button>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 text-destructive hover:text-destructive sm:mr-auto"
              disabled={busy || !total}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-4" />
              Não vai chegar
            </Button>
            {saved && (
              <Button
                type="button"
                variant="glass-quiet"
                disabled={busy}
                onClick={() => void undo()}
              >
                Voltar ao original
              </Button>
            )}
            <Button
              type="button"
              variant="glass"
              disabled={busy || !total || over}
              onClick={() => void save()}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tirar esta compra a chegar?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela sai da lista e das contas. Se a compra chegar do banco depois,
              entra normalmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="glass-destructive"
              disabled={busy}
              onClick={() => void dismiss()}
            >
              Tirar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
