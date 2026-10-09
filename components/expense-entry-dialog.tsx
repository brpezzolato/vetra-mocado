'use client';
import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { createClient } from '@/lib/supabase/client';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard, PaymentMethodId } from '@/lib/payment-cards';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { DateInput } from '@/components/date-input';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TimeInput } from '@/components/time-input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { normalizeMerchant } from '@/lib/merchant-names';
const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value || 0).toNumber(),
  );
const localDateTime = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
};
const moneyInput = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 15);
  if (!digits) return '';
  const number = new Decimal(digits).div(100);
  return money(number);
};

export function ExpenseEntryDialog({
  cards,
  onClose,
  onSaved,
}: {
  cards: PaymentCard[];
  onClose: () => void;
  onSaved: (entry: FinancialEntry) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [amount, setAmount] = useState(''),
    [description, setDescription] = useState(''),
    [category, setCategory] = useState('Outros'),
    [categoryTouched, setCategoryTouched] = useState(false),
    [account, setAccount] = useState(cards[0]?.account ?? 'Pix'),
    [occurredAt, setOccurredAt] = useState(localDateTime);
  // Cartão que vem da Pluggy não é lançado à mão (chegaria duas vezes).
  const [bankAccounts, setBankAccounts] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    void supabase
      .from('pluggy_card_links')
      .select('account')
      .then(({ data }) => {
        if (!active || !data) return;
        const linked = new Set(data.map((row) => row.account as string));
        setBankAccounts(linked);
        setAccount((current) =>
          linked.has(current)
            ? (cards.find((card) => !linked.has(card.account))?.account ??
              'Pix')
            : current,
        );
      });
    return () => {
      active = false;
    };
  }, [cards, supabase]);
  const paymentOptions: { account: string; bankId: PaymentMethodId }[] = [
    ...cards
      .filter((card) => !bankAccounts.has(card.account))
      .map((card) => ({ account: card.account, bankId: card.bank_id })),
    // Pix fica: o MP não informa Pix pago com saldo de reserva. O sync só mexe
    // no que ele mesmo trouxe.
    { account: 'Pix', bankId: 'pix' as PaymentMethodId },
  ];
  const selectedPayment =
    paymentOptions.find((option) => option.account === account) ??
    paymentOptions[0];
  async function saveEntry(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const digits = amount.replace(/\D/g, '');
    const value = digits ? new Decimal(digits).div(100) : new Decimal(0);
    if (!description.trim() || value.lte(0))
      return setError('Informe uma descrição e um valor positivo.');
    if (!selectedPayment)
      return setError('Escolha um cartão vinculado ou Pix.');
    setBusy(true);
    setError('');
    // One name per place, the same the Shortcut and the statement import use.
    const merchant = normalizeMerchant(description);
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user)
        throw new Error('Entre novamente para registrar o gasto.');
      let resolvedCategory = category;
      if (!categoryTouched && category === 'Outros') {
        try {
          const suggestion = await fetch('/api/finance/categorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              description: merchant,
              account: selectedPayment.account,
            }),
          });
          if (suggestion.ok) {
            const answer = (await suggestion.json()) as { category?: string };
            if (answer.category) resolvedCategory = answer.category;
          }
        } catch {
          // AI is an enhancement: a network failure must not block the expense.
        }
      }
      const result = await supabase
        .from('financial_entries')
        .insert({
          user_id: user.id,
          entry_type: 'expense',
          amount: value.toFixed(2),
          description: merchant,
          category: resolvedCategory,
          account: selectedPayment.account,
          occurred_at: new Date(`${occurredAt}:00-03:00`).toISOString(),
          source: 'manual',
        })
        .select('*')
        .single();
      if (result.error) throw result.error;
      if (categoryTouched && resolvedCategory !== 'Outros') {
        await supabase.from('merchant_rules').upsert(
          {
            user_id: user.id,
            merchant: merchant.toLocaleLowerCase('pt-BR'),
            category: resolvedCategory,
          },
          { onConflict: 'user_id,merchant' },
        );
      }
      onSaved(result.data as FinancialEntry);
      window.dispatchEvent(new Event('vetra:notifications'));
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Não foi possível salvar.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={saveEntry}>
          <DialogHeader>
            <DialogTitle>Novo lançamento</DialogTitle>
            <DialogDescription>
              Registre uma linha manualmente na sua planilha financeira.
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4">
            <label htmlFor="entry-amount" className="grid gap-4 text-sm">
              Valor
              <Input
                id="entry-amount"
                required
                inputMode="numeric"
                className="h-11"
                placeholder="R$ 0,00"
                value={amount}
                onChange={(event) => setAmount(moneyInput(event.target.value))}
              />
            </label>
            <label htmlFor="entry-description" className="grid gap-4 text-sm">
              Descrição
              <Input
                id="entry-description"
                required
                maxLength={160}
                className="h-11"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {/* Empilhados no celular, lado a lado a partir de `sm` (senão a Categoria
                vazava por cima da Conta). */}
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,.72fr)_minmax(0,1.28fr)]">
              <label
                htmlFor="entry-category"
                className="grid min-w-0 gap-4 text-sm"
              >
                Categoria
                <Select
                  value={category}
                  onValueChange={(value) => {
                    if (!value) return;
                    setCategoryTouched(true);
                    setCategory(value);
                  }}
                >
                  <SelectTrigger
                    id="entry-category"
                    className="h-11 w-full min-w-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    side="bottom"
                    alignItemWithTrigger={false}
                    collisionAvoidance={{ side: 'none', align: 'shift' }}
                    className="max-h-[min(16rem,var(--available-height))] overflow-y-auto"
                  >
                    {EXPENSE_CATEGORIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label
                htmlFor="entry-account"
                className="grid min-w-0 gap-4 text-sm"
              >
                Conta
                <Select
                  value={selectedPayment?.account ?? ''}
                  onValueChange={(value) => value && setAccount(value)}
                >
                  <SelectTrigger
                    id="entry-account"
                    className="h-11 w-full min-w-0 overflow-hidden"
                  >
                    {selectedPayment ? (
                      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                        <PaymentCardIcon bankId={selectedPayment.bankId} />
                        <span className="truncate">
                          {selectedPayment.account}
                        </span>
                      </span>
                    ) : (
                      <SelectValue placeholder="Escolha como pagou" />
                    )}
                  </SelectTrigger>
                  <SelectContent
                    side="bottom"
                    alignItemWithTrigger={false}
                    collisionAvoidance={{ side: 'none', align: 'shift' }}
                    className="max-h-[min(16rem,var(--available-height))] overflow-y-auto"
                  >
                    {paymentOptions.map((option) => (
                      <SelectItem
                        key={option.account}
                        value={option.account}
                        className="min-w-0 overflow-hidden"
                      >
                        <PaymentCardIcon bankId={option.bankId} />
                        <span className="truncate">{option.account}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label
                htmlFor="entry-date"
                className="grid min-w-0 gap-4 text-sm"
              >
                Data
                <DateInput
                  id="entry-date"
                  value={occurredAt.slice(0, 10)}
                  onValueChange={(value) =>
                    setOccurredAt(`${value}T${occurredAt.slice(11)}`)
                  }
                />
              </label>
              <label
                htmlFor="entry-time"
                className="grid min-w-0 gap-4 text-sm"
              >
                Hora (São Paulo)
                <TimeInput
                  id="entry-time"
                  value={occurredAt.slice(11)}
                  onValueChange={(value) =>
                    setOccurredAt(`${occurredAt.slice(0, 10)}T${value}`)
                  }
                />
              </label>
            </div>
          </div>
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" variant="glass" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar lançamento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
