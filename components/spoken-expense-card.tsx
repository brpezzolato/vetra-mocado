'use client';

import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Check, Receipt } from 'lucide-react';
import { Private } from '@/components/private-value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import { refreshMountedWidgets } from '@/lib/manual-refresh';
import { normalizeMerchant } from '@/lib/merchant-names';
import type { PaymentCard } from '@/lib/payment-cards';
import type { SpokenExpense } from '@/lib/spoken-expense';
import { createClient } from '@/lib/supabase/client';

/* Confirmação do gasto falado (lib/spoken-expense.ts): tudo editável, grava
   no "Confirmar" como o formulário (nome normalizado, categoria, origem manual). */

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value).toNumber(),
  );
const moneyInput = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  return digits ? money(new Decimal(digits).div(100)) : '';
};
const DAY_LABEL = ['hoje', 'ontem', 'anteontem'] as const;

/** A conta do app para o meio dito na frase. */
function accountFor(parsed: SpokenExpense, cards: PaymentCard[]) {
  if (parsed.method === 'pix') return 'Pix';
  const ofBank = cards.filter((card) => card.bank_id === parsed.method);
  if (!ofBank.length) return parsed.method === 'mercado-pago' ? 'Pix' : '';
  if (ofBank.length === 1) return ofBank[0].account;
  // Itaú com débito e crédito: o crédito tem "Crédito" no nome.
  const credit = ofBank.find((card) => /cr[eé]dito/i.test(card.account));
  const other = ofBank.find((card) => card !== credit) ?? ofBank[0];
  return parsed.mode === 'credit' && credit ? credit.account : other.account;
}

export function SpokenExpenseCard({
  parsed,
  onDone,
}: {
  parsed: SpokenExpense;
  onDone: (saved: boolean) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [cards, setCards] = useState<PaymentCard[]>([]);
  const [amount, setAmount] = useState(() => money(parsed.amount));
  const [description, setDescription] = useState(parsed.description);
  const [category, setCategory] = useState(parsed.category ?? 'Outros');
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<null | {
    amount: string;
    description: string;
    category: string;
    account: string;
  }>(null);

  useEffect(() => {
    let alive = true;
    void supabase
      .from('payment_cards')
      .select('*')
      .then(({ data }) => {
        if (!alive) return;
        const list = (data ?? []) as PaymentCard[];
        setCards(list);
        setAccount((current) => current || accountFor(parsed, list));
      });
    return () => {
      alive = false;
    };
  }, [parsed, supabase]);

  const accounts = [...new Set([...cards.map((card) => card.account), 'Pix'])];

  async function confirm() {
    const digits = amount.replace(/\D/g, '');
    const value = digits ? new Decimal(digits).div(100) : new Decimal(0);
    if (!description.trim() || value.lte(0))
      return setError('Informe o lugar e um valor positivo.');
    if (!account) return setError('Escolha o cartão ou o Pix.');
    setBusy(true);
    setError('');
    const merchant = normalizeMerchant(description);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Entre novamente para registrar o gasto.');
      let resolved = category;
      if (!categoryTouched && category === 'Outros') {
        try {
          const answer = await fetch('/api/finance/categorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: merchant, account }),
          });
          if (answer.ok) {
            const body = (await answer.json()) as { category?: string };
            if (body.category) resolved = body.category;
          }
        } catch {
          // A categoria automática ajuda, mas não pode impedir o registro.
        }
      }
      const when = new Date(Date.now() - parsed.daysAgo * 86_400_000);
      const { error: failure } = await supabase
        .from('financial_entries')
        .insert({
          user_id: user.id,
          entry_type: 'expense',
          amount: value.toFixed(2),
          description: merchant,
          category: resolved,
          account,
          occurred_at: when.toISOString(),
          source: 'manual',
        });
      if (failure) throw failure;
      if (categoryTouched && resolved !== 'Outros')
        await supabase.from('merchant_rules').upsert(
          {
            user_id: user.id,
            merchant: merchant.toLocaleLowerCase('pt-BR'),
            category: resolved,
          },
          { onConflict: 'user_id,merchant' },
        );
      setSaved({
        amount: value.toFixed(2),
        description: merchant,
        category: resolved,
        account,
      });
      window.dispatchEvent(new Event('vetra:notifications'));
      void refreshMountedWidgets();
      onDone(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Não foi possível registrar.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (saved)
    return (
      <div className="flex max-w-[92%] items-center gap-3 rounded-2xl border bg-emerald-500/10 px-4 py-3 text-sm md:max-w-[88%]">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" />
        </span>
        <span className="min-w-0">
          Registrado: <Private>{money(saved.amount)}</Private> ·{' '}
          {saved.description} · {saved.category} · {saved.account}
        </span>
      </div>
    );

  return (
    <div className="max-w-[92%] rounded-2xl border bg-muted/45 p-4 text-sm md:max-w-[88%]">
      <p className="flex items-center gap-2 font-medium">
        <Receipt className="size-4 shrink-0 text-muted-foreground" />
        Registrar este gasto? ({DAY_LABEL[parsed.daysAgo]})
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Input
          aria-label="Valor"
          inputMode="numeric"
          className="h-11 tabular-nums"
          value={amount}
          onChange={(event) => setAmount(moneyInput(event.target.value))}
        />
        <Input
          aria-label="Lugar"
          maxLength={160}
          className="h-11"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Select
          value={category}
          onValueChange={(value) => {
            if (!value) return;
            setCategory(value);
            setCategoryTouched(true);
          }}
        >
          <SelectTrigger aria-label="Categoria" className="h-11 w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            alignItemWithTrigger={false}
            className="max-h-[min(16rem,var(--available-height))] overflow-y-auto overscroll-contain"
          >
            {EXPENSE_CATEGORIES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={account}
          onValueChange={(value) => value && setAccount(value)}
        >
          <SelectTrigger
            aria-label="Cartão ou Pix"
            className="h-11 w-full min-w-0"
          >
            <SelectValue placeholder="Cartão ou Pix" />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            alignItemWithTrigger={false}
            className="w-auto min-w-(--anchor-width)"
          >
            {accounts.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="glass"
          className="h-10 flex-1"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? 'Registrando…' : 'Confirmar'}
        </Button>
        <Button
          type="button"
          variant="glass-quiet"
          className="h-10"
          disabled={busy}
          onClick={() => onDone(false)}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
