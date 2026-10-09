'use client';

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import type { FinancialEntry } from '@/lib/financial-tracker';
import type { PaymentCard, PaymentMethodId } from '@/lib/payment-cards';
import { resolvePaymentMethod } from '@/lib/payment-cards';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import { createClient } from '@/lib/supabase/client';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { DateInput } from '@/components/date-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
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
import { Private } from '@/components/private-value';
import { normalizeMerchant } from '@/lib/merchant-names';
import { fullAmount, isSplit } from '@/lib/entry-share';
import { MerchantAliasDialog } from '@/components/merchant-alias-dialog';
import { refreshMountedWidgets } from '@/lib/manual-refresh';

const money = (value: Decimal.Value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value || 0).toNumber(),
  );

const moneyInput = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 15);
  return digits ? money(new Decimal(digits).div(100)) : '';
};

function saoLocalDateTime(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

export function EntryDetails({
  entry,
  cards,
  onClose,
  onSaved,
  onDelete,
  onRuleApplied,
}: {
  entry: FinancialEntry;
  cards: PaymentCard[];
  onClose: () => void;
  onSaved: (entry: FinancialEntry) => void;
  onDelete?: (id: string) => Promise<void>;
  /** Regra de nome mudou várias compras: quem mostra a lista recarrega. */
  onRuleApplied?: () => void | Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  // Valor cheio, mesmo na leitura "dos gastos" (lib/entry-share.ts).
  const [amount, setAmount] = useState(() => money(fullAmount(entry)));
  const [description, setDescription] = useState(entry.description);
  const [category, setCategory] = useState(entry.category);
  const [account, setAccount] = useState(entry.account);
  const [occurredAt, setOccurredAt] = useState(() =>
    saoLocalDateTime(entry.occurred_at),
  );
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [excluded, setExcluded] = useState(!!entry.excluded_from_totals);
  // Compra dividida: por igual entre N pessoas ou com a parte digitada.
  const [split, setSplit] = useState(isSplit(entry));
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>(
    isSplit(entry) && !entry.split_people ? 'custom' : 'equal',
  );
  const [people, setPeople] = useState(entry.split_people ?? 2);
  const [customShare, setCustomShare] = useState(() =>
    isSplit(entry) && !entry.split_people ? money(entry.split_share!) : '',
  );
  const centsOf = (text: string) => {
    const digits = text.replace(/\D/g, '');
    return digits ? new Decimal(digits).div(100) : new Decimal(0);
  };
  const total = centsOf(amount);
  const share =
    splitMode === 'equal'
      ? total.div(people).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : centsOf(customShare);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [creatingRule, setCreatingRule] = useState(false);
  const categories = [...new Set([entry.category, ...EXPENSE_CATEGORIES])];
  const paymentOptions: { account: string; bankId: PaymentMethodId }[] = [
    ...cards.map((card) => ({ account: card.account, bankId: card.bank_id })),
    { account: 'Pix', bankId: 'pix' },
  ];
  if (!paymentOptions.some((option) => option.account === entry.account))
    paymentOptions.unshift({
      account: entry.account,
      bankId: resolvePaymentMethod(entry.account, cards),
    });
  const selectedPayment = paymentOptions.find(
    (option) => option.account === account,
  );

  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const digits = amount.replace(/\D/g, '');
    const value = digits ? new Decimal(digits).div(100) : new Decimal(0);
    if (!description.trim() || value.lte(0))
      return setError('Informe uma descrição e um valor positivo.');
    if (split && entry.entry_type === 'expense' && share.gt(value))
      return setError('A sua parte não pode passar do valor da compra.');
    if (!selectedPayment) return setError('Escolha um cartão ou Pix.');
    setBusy(true);
    setError('');
    // Edited purchases get the place's one name; income keeps what was typed.
    const name =
      entry.entry_type === 'expense'
        ? normalizeMerchant(description)
        : description.trim();
    try {
      const { data, error: failure } = await supabase
        .from('financial_entries')
        .update({
          amount: value.toFixed(2),
          description: name,
          category,
          account: selectedPayment.account,
          occurred_at: new Date(`${occurredAt}:00-03:00`).toISOString(),
          notes: notes.trim(),
          excluded_from_totals: excluded,
          split_share:
            split && entry.entry_type === 'expense' ? share.toFixed(2) : null,
          split_people:
            split && entry.entry_type === 'expense' && splitMode === 'equal'
              ? people
              : null,
        })
        .eq('id', entry.id)
        .eq('user_id', entry.user_id)
        .select('*')
        .single();
      if (failure) throw failure;
      if (
        category !== 'Outros' &&
        (category !== entry.category || name !== entry.description)
      ) {
        await supabase.from('merchant_rules').upsert(
          {
            user_id: entry.user_id,
            merchant: name.toLocaleLowerCase('pt-BR'),
            category,
          },
          { onConflict: 'user_id,merchant' },
        );
      }
      onSaved(data as FinancialEntry);
      onClose();
    } catch {
      setError('Não foi possível salvar. As alterações continuam aqui.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="min-w-0">
          <DialogHeader>
            <DialogTitle>Editar lançamento</DialogTitle>
            <DialogDescription>
              Ajuste os dados que entram nos seus totais e gráficos.
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4">
            <div className="flex items-center gap-4 rounded-2xl border bg-muted/30 p-3">
              <PaymentCardIcon
                bankId={
                  selectedPayment?.bankId ??
                  resolvePaymentMethod(entry.account, cards)
                }
                large
              />
              <label
                htmlFor="detail-amount"
                className="grid min-w-0 flex-1 gap-3 text-sm"
              >
                Valor
                <Input
                  id="detail-amount"
                  required
                  inputMode="numeric"
                  className="h-11 text-lg font-semibold tabular-nums"
                  value={amount}
                  onChange={(event) =>
                    setAmount(moneyInput(event.target.value))
                  }
                />
              </label>
            </div>
            <label htmlFor="detail-description" className="grid gap-3 text-sm">
              Estabelecimento / descrição
              <Input
                id="detail-description"
                required
                maxLength={160}
                className="h-11"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label
                htmlFor="detail-category"
                className="grid min-w-0 gap-3 text-sm"
              >
                Categoria
                <Select
                  value={category}
                  onValueChange={(value) => value && setCategory(value)}
                >
                  <SelectTrigger
                    id="detail-category"
                    className="h-11 w-full min-w-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    side="bottom"
                    alignItemWithTrigger={false}
                    collisionAvoidance={{ side: 'none', align: 'shift' }}
                    className="max-h-[min(16rem,var(--available-height))] overflow-y-auto overscroll-contain"
                  >
                    {categories.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label
                htmlFor="detail-account"
                className="grid min-w-0 gap-3 text-sm"
              >
                Cartão / conta
                <Select
                  value={account}
                  onValueChange={(value) => value && setAccount(value)}
                >
                  <SelectTrigger
                    id="detail-account"
                    className="h-11 w-full min-w-0 overflow-hidden"
                  >
                    {selectedPayment ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <PaymentCardIcon bankId={selectedPayment.bankId} />
                        <span className="truncate">
                          {selectedPayment.account}
                        </span>
                      </span>
                    ) : (
                      <SelectValue />
                    )}
                  </SelectTrigger>
                  <SelectContent
                    side="bottom"
                    alignItemWithTrigger={false}
                    collisionAvoidance={{ side: 'none', align: 'shift' }}
                    className="max-h-[min(16rem,var(--available-height))] overflow-y-auto"
                  >
                    {paymentOptions.map((option) => (
                      <SelectItem key={option.account} value={option.account}>
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
                htmlFor="detail-date"
                className="grid min-w-0 gap-3 text-sm"
              >
                Data
                <DateInput
                  id="detail-date"
                  value={occurredAt.slice(0, 10)}
                  onValueChange={(value) =>
                    setOccurredAt(`${value}T${occurredAt.slice(11)}`)
                  }
                />
              </label>
              <label
                htmlFor="detail-time"
                className="grid min-w-0 gap-3 text-sm"
              >
                Hora (São Paulo)
                <TimeInput
                  id="detail-time"
                  value={occurredAt.slice(11)}
                  onValueChange={(value) =>
                    setOccurredAt(`${occurredAt.slice(0, 10)}T${value}`)
                  }
                />
              </label>
            </div>
            <label htmlFor="detail-notes" className="grid gap-3 text-sm">
              Observação
              <Textarea
                id="detail-notes"
                value={notes}
                maxLength={2000}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Adicione um detalhe sobre esta compra…"
                className="min-h-20 w-full resize-y text-base"
              />
            </label>
            {/* Dividida: a fatura segue cheia; os gastos usam a parte do usuário. */}
            {entry.entry_type === 'expense' && (
              <div className="grid gap-3 rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-4">
                  <label htmlFor="detail-split" className="grid gap-1 text-sm">
                    Dividi esta compra
                    <span className="text-xs text-muted-foreground">
                      A fatura continua com o valor cheio; nos seus gastos entra
                      só a sua parte.
                    </span>
                  </label>
                  <Switch
                    id="detail-split"
                    checked={split}
                    onCheckedChange={setSplit}
                  />
                </div>
                {split && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ['equal', 'Por igual'],
                          ['custom', 'Valor da minha parte'],
                        ] as const
                      ).map(([mode, label]) => (
                        <Button
                          key={mode}
                          type="button"
                          size="sm"
                          variant={splitMode === mode ? 'glass' : 'glass-quiet'}
                          aria-pressed={splitMode === mode}
                          className="rounded-full"
                          onClick={() => setSplitMode(mode)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                    {splitMode === 'equal' ? (
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span>Pessoas, com você</span>
                        <span className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="glass-quiet"
                            aria-label="Uma pessoa a menos"
                            disabled={people <= 2}
                            onClick={() => setPeople((n) => Math.max(2, n - 1))}
                          >
                            −
                          </Button>
                          <span
                            aria-live="polite"
                            className="w-6 text-center font-semibold tabular-nums"
                          >
                            {people}
                          </span>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="glass-quiet"
                            aria-label="Uma pessoa a mais"
                            disabled={people >= 50}
                            onClick={() =>
                              setPeople((n) => Math.min(50, n + 1))
                            }
                          >
                            +
                          </Button>
                        </span>
                      </div>
                    ) : (
                      <label
                        htmlFor="detail-split-share"
                        className="grid gap-2 text-sm"
                      >
                        Minha parte
                        <Input
                          id="detail-split-share"
                          inputMode="numeric"
                          className="h-11 tabular-nums"
                          placeholder="R$ 0,00"
                          value={customShare}
                          onChange={(event) =>
                            setCustomShare(moneyInput(event.target.value))
                          }
                        />
                      </label>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Sua parte:{' '}
                      <span className="font-semibold text-foreground">
                        <Private>{money(share)}</Private>
                      </span>
                      {' · '}dos outros:{' '}
                      <Private>
                        {money(Decimal.max(total.minus(share), 0))}
                      </Private>
                    </p>
                  </>
                )}
              </div>
            )}
            {/* Gasto de outra pessoa sai das contas, mas continua na fatura. */}
            {/* Numa entrada, o interruptor decide se conta no "Entrou". */}
            <div className="flex items-start justify-between gap-4 rounded-2xl border p-3">
              {entry.entry_type === 'income' ? (
                <label htmlFor="detail-excluded" className="grid gap-1 text-sm">
                  Não contar no que entrou
                  <span className="text-xs text-muted-foreground">
                    Continua no extrato, mas sai do &ldquo;Entrou&rdquo; do
                    Resumo e da home.
                  </span>
                </label>
              ) : (
                <label htmlFor="detail-excluded" className="grid gap-1 text-sm">
                  Não contar nos meus gastos
                  <span className="text-xs text-muted-foreground">
                    Continua na fatura, mas sai do resumo, dos gráficos, do
                    calendário e do Vetra AI.
                  </span>
                </label>
              )}
              <Switch
                id="detail-excluded"
                checked={excluded}
                onCheckedChange={setExcluded}
              />
            </div>
            {entry.entry_type === 'expense' && (
              <Button
                type="button"
                variant="glass-quiet"
                className="justify-self-start"
                disabled={busy}
                onClick={() => setCreatingRule(true)}
              >
                Criar regra a partir desta compra
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Origem:{' '}
              {entry.source === 'apple_shortcuts'
                ? 'Apple Atalhos'
                : entry.source === 'pluggy'
                  ? 'banco (Pluggy)'
                  : entry.source === 'benefit_statement'
                    ? 'extrato da Flash'
                    : 'registro manual'}
            </p>
          </div>
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            {onDelete && (
              <Button
                type="button"
                variant="glass-destructive"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                Excluir
              </Button>
            )}
            <Button type="submit" variant="glass" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {creatingRule && (
        <MerchantAliasDialog
          description={entry.description}
          category={entry.category}
          onClose={() => setCreatingRule(false)}
          onApplied={(changed) => {
            setCreatingRule(false);
            void refreshMountedWidgets();
            if (!changed) return onClose();
            if (onRuleApplied) {
              void Promise.resolve(onRuleApplied()).finally(onClose);
              return;
            }
            window.location.reload();
          }}
        />
      )}

      {/* Shared confirmation; AlertDialog rather than window.confirm so privacy
          mode reaches it. */}
      <AlertDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmingDelete(false);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">
                {entry.description}
              </span>
              {' · '}
              <Private>{money(entry.amount)}</Private>
              {' — '}
              some dos seus totais e gráficos. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="glass-destructive"
              disabled={busy}
              onClick={() => {
                if (!onDelete) return;
                setBusy(true);
                setError('');
                onDelete(entry.id)
                  .catch(() => {
                    setError('Não foi possível excluir o lançamento.');
                    setConfirmingDelete(false);
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
