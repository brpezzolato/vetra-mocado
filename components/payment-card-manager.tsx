'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BILLING_RULES } from '@/lib/card-billing';
import Decimal from 'decimal.js';
import type { FinancialEntry } from '@/lib/financial-tracker';
import { invoiceFor, saoDate, type CardCycle } from '@/lib/expense-insights';
import { Check, CreditCard, Plus } from 'lucide-react';
import {
  CARD_BANKS,
  cardAccounts,
  resolveCardBank,
  resolvePaymentMethod,
  type CardBankId,
  type PaymentCard,
} from '@/lib/payment-cards';
import { createClient } from '@/lib/supabase/client';
import { PaymentCardIcon } from '@/components/payment-card-icon';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
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
import {
  ChevronLeftSymbol,
  ChevronRightSymbol,
} from '@/components/ui/glass-button';

export function PaymentCardManager({
  userId,
  accounts,
  cards,
  onSaved,
  entries = [],
}: {
  userId: string;
  accounts: string[];
  cards: PaymentCard[];
  onSaved: (card: PaymentCard) => void;
  entries?: FinancialEntry[];
}) {
  const client = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState('');
  const [existing, setExisting] = useState(false);
  const [bankId, setBankId] = useState<CardBankId>('other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cycles, setCycles] = useState<CardCycle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<CardCycle['kind']>('credit');
  const [due, setDue] = useState('');
  const [closing, setClosing] = useState('');
  const [automatic, setAutomatic] = useState(true);
  const [showInInvoices, setShowInInvoices] = useState(true);
  const [activeCard, setActiveCard] = useState(0);
  const carousel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    void client
      .from('card_cycles')
      .select('*')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(
            'Não foi possível carregar os ciclos. Reabra a tela para tentar novamente.',
          );
          return;
        }
        setCycles(data ?? []);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [client, userId]);
  const names = cardAccounts(
    [...accounts, ...cycles.map((c) => c.account)],
    cards,
  );
  // Débito e crédito do mesmo plástico (`same_card_as`) dividem um slide; no
  // app seguem duas contas.
  const slides = useMemo(() => {
    const grouped = new Set<string>();
    const result: string[][] = [];
    for (const name of names) {
      if (grouped.has(name)) continue;
      const partner = cards.find((card) => card.account === name)?.same_card_as;
      if (partner && partner !== name && names.includes(partner)) {
        grouped.add(partner);
        result.push([name, partner]);
      } else result.push([name]);
    }
    return result;
  }, [names, cards]);
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    accounts.forEach((name) => {
      const key = name.trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [accounts]);
  const visibleCard = Math.min(activeCard, Math.max(0, slides.length - 1));
  function goToCard(index: number) {
    const next = Math.max(0, Math.min(index, slides.length - 1));
    setActiveCard(next);
    const viewport = carousel.current;
    if (viewport)
      viewport.scrollTo({
        left: viewport.clientWidth * next,
        behavior: 'smooth',
      });
  }
  const rule = BILLING_RULES[bankId];
  function chooseBank(nextBank: CardBankId) {
    setBankId(nextBank);
    setKind(nextBank === 'flash' ? 'benefit' : 'credit');
    setAutomatic(nextBank !== 'flash');
    setClosing('');
    setDue('');
  }
  function edit(name: string) {
    setAccount(name);
    setExisting(Boolean(name));
    setBankId(resolveCardBank(name, cards));
    const cycle = cycles.find((c) => c.account === name);
    setKind(
      cycle?.kind ??
        (resolveCardBank(name, cards) === 'flash' ? 'benefit' : 'credit'),
    );
    setDue(cycle?.kind === 'credit' ? String(cycle.due_day) : '');
    setClosing(cycle?.kind === 'credit' ? String(cycle.closing_day) : '');
    setAutomatic(!cycle || cycle.closing_offset_days != null);
    setShowInInvoices(
      cards.find((card) => card.account === name)?.show_in_invoices !== false,
    );
    setError('');
    setOpen(true);
  }
  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const name = account.trim();
    if (!CARD_BANKS.some((bank) => bank.id === bankId)) {
      setError('Escolha o banco do cartão.');
      return;
    }
    if (!name || name.length > 80 || name === 'Não informada') {
      setError('Informe o nome do cartão como ele chega do Atalho.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data, error: saveError } = await client.rpc(
        'save_payment_card_settings',
        {
          p_account: name,
          p_bank: bankId,
          p_kind: kind,
          p_due: due ? Number(due) : null,
          p_closing: closing ? Number(closing) : null,
          p_automatic: automatic,
        },
      );
      if (saveError) throw saveError;
      // Ligado ou desligado nas faturas: fica no próprio cartão.
      const { error: showError } = await client
        .from('payment_cards')
        .update({ show_in_invoices: showInInvoices })
        .eq('user_id', userId)
        .eq('account', name);
      if (showError) throw showError;
      onSaved({ ...(data as PaymentCard), show_in_invoices: showInInvoices });
      if (kind !== 'credit' || due)
        setCycles((previous) => [
          ...previous.filter((c) => c.account !== name),
          {
            account: name,
            kind,
            due_day: kind === 'credit' ? Number(due) : 1,
            closing_day: Number(closing) || 1,
            closing_offset_days:
              kind === 'credit' && automatic
                ? BILLING_RULES[bankId].days
                : null,
          },
        ]);
      setOpen(false);
    } catch {
      setError('Não foi possível salvar o cartão e o ciclo. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="mt-7 min-w-0 rounded-3xl border bg-card p-5 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <CreditCard className="size-5" />
            Seus cartões
          </h2>
          <Button
            disabled={!loaded}
            variant="outline"
            size="sm"
            onClick={() => edit('')}
          >
            <Plus className="size-4" />
            Vincular
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Ícone e datas da fatura, juntos. Toque no cartão para editar.
        </p>
        {names.length ? (
          <div className="mt-5 min-w-0">
            <div
              ref={carousel}
              className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible"
              onScroll={(event) => {
                const viewport = event.currentTarget;
                if (viewport.clientWidth)
                  setActiveCard(
                    Math.min(
                      slides.length - 1,
                      Math.max(
                        0,
                        Math.round(viewport.scrollLeft / viewport.clientWidth),
                      ),
                    ),
                  );
              }}
            >
              {slides.map((group) => {
                const status = (name: string) => {
                  const cycle = cycles.find((item) => item.account === name);
                  return cycle?.kind === 'credit'
                    ? `Vence dia ${cycle.due_day}${
                        cards.find((card) => card.account === name)
                          ?.show_in_invoices === false
                          ? ' · fora das faturas'
                          : ''
                      } · editar`
                    : cycle
                      ? 'Sem fatura · editar'
                      : 'Configurar cartão e datas';
                };
                const usageText = (count: number) =>
                  count
                    ? `${count} ${count === 1 ? 'uso' : 'usos'} registrado${count === 1 ? '' : 's'}`
                    : 'Ainda sem uso registrado';
                const [name] = group;
                if (group.length === 1)
                  return (
                    <div
                      key={name}
                      className="w-full shrink-0 snap-center px-0.5 lg:px-0"
                    >
                      <button
                        type="button"
                        disabled={!loaded}
                        onClick={() => edit(name)}
                        className="mx-auto flex min-h-64 w-full max-w-md min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border p-6 text-center transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-4"
                      >
                        {/* PaymentMethodId knows Pix (resolveCardBank doesn't); the edit form still
                            uses resolveCardBank because it writes payment_cards.bank_id. */}
                        <PaymentCardIcon
                          bankId={resolvePaymentMethod(name, cards)}
                          large
                        />
                        <span className="w-full truncate text-sm font-semibold">
                          {name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {status(name)}
                        </span>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                          {usageText(usage.get(name) ?? 0)}
                        </span>
                      </button>
                    </div>
                  );
                // Débito primeiro; crédito é o lado com ciclo (ou "Crédito" no nome).
                const isCredit = (side: string) =>
                  cycles.find((item) => item.account === side)?.kind ===
                    'credit' || /cr[ée]dito$/i.test(side);
                const sides = [...group].sort(
                  (a, b) => Number(isCredit(a)) - Number(isCredit(b)),
                );
                const title = name
                  .replace(/\s+(cr[ée]dito|d[ée]bito)$/i, '')
                  .trim();
                return (
                  <div
                    key={group.join('|')}
                    className="w-full shrink-0 snap-center px-0.5 lg:px-0"
                  >
                    <div className="mx-auto flex min-h-64 w-full max-w-md min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border p-6 text-center">
                      <PaymentCardIcon
                        bankId={resolvePaymentMethod(name, cards)}
                        large
                      />
                      <span className="grid w-full gap-1">
                        <span className="truncate text-sm font-semibold">
                          {title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Débito e crédito · o mesmo cartão
                        </span>
                      </span>
                      <span className="grid w-full gap-2">
                        {sides.map((side) => (
                          <button
                            key={side}
                            type="button"
                            disabled={!loaded}
                            onClick={() => edit(side)}
                            className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <span className="text-sm font-medium">
                              {isCredit(side) ? 'Crédito' : 'Débito'}
                            </span>
                            <span className="min-w-0 truncate text-right text-xs text-muted-foreground">
                              {status(side)} ·{' '}
                              {usageText(usage.get(side) ?? 0).toLowerCase()}
                            </span>
                          </button>
                        ))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-center gap-3 lg:hidden">
              <Button
                type="button"
                variant="glass-quiet"
                size="icon"
                disabled={visibleCard === 0}
                aria-label="Cartão anterior"
                onClick={() => goToCard(visibleCard - 1)}
              >
                <ChevronLeftSymbol />
              </Button>
              <div
                className="flex items-center gap-1.5"
                aria-label={`Cartão ${visibleCard + 1} de ${slides.length}`}
              >
                {slides.map((group, index) => (
                  <button
                    key={group.join('|')}
                    type="button"
                    aria-label={`Ver cartão ${index + 1}`}
                    aria-current={index === visibleCard ? 'true' : undefined}
                    onClick={() => goToCard(index)}
                    className={`h-1.5 rounded-full transition-all ${
                      index === visibleCard
                        ? 'w-6 bg-foreground'
                        : 'w-1.5 bg-muted-foreground/35 hover:bg-muted-foreground/60'
                    }`}
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="glass-quiet"
                size="icon"
                disabled={visibleCard === slides.length - 1}
                aria-label="Próximo cartão"
                onClick={() => goToCard(visibleCard + 1)}
              >
                <ChevronRightSymbol />
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">
            Os nomes aparecerão após suas primeiras compras. Você também pode
            vincular um cartão agora.
          </p>
        )}
      </section>
      {error && !open && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Editar cartão</DialogTitle>
              <DialogDescription>
                O vínculo usa o campo “conta” enviado pelo Atalho. Não informe o
                número completo, validade ou código de segurança.
              </DialogDescription>
            </DialogHeader>
            <label
              htmlFor="payment-card-account"
              className="mt-5 grid gap-4 text-sm"
            >
              Nome recebido do Apple Pay
              <Input
                id="payment-card-account"
                required
                maxLength={80}
                readOnly={existing}
                disabled={busy}
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="Ex.: Nubank final 1234"
                className="h-11"
              />
            </label>
            <fieldset disabled={busy} className="mt-5">
              <legend className="mb-3 text-sm font-medium">
                Escolha o banco
              </legend>
              <RadioGroup
                value={bankId}
                onValueChange={(value) => value && chooseBank(value as never)}
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              >
                {CARD_BANKS.map((bank) => (
                  <label
                    key={bank.id}
                    // Cartão em cima e nome embaixo, para o nome não quebrar.
                    className={`relative flex min-w-0 cursor-pointer flex-col items-center gap-2.5 rounded-xl border px-3 pt-4 pb-3 text-center has-[:focus-visible]:outline-2 ${bankId === bank.id ? 'border-foreground bg-muted' : 'hover:bg-muted/40'}`}
                  >
                    {/* Radio invisível: a arte do cartão mostra a escolha; o shadcn dá foco,
                        setas e ARIA. */}
                    <RadioGroupItem value={bank.id} className="sr-only" />
                    <PaymentCardIcon bankId={bank.id} />
                    <span className="w-full truncate text-xs font-medium">
                      {bank.short}
                    </span>
                    {bankId === bank.id && (
                      <Check
                        aria-hidden="true"
                        className="absolute top-2 right-2 size-3.5 shrink-0"
                      />
                    )}
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            {existing &&
              cycles.find((c) => c.account === account)?.kind === 'credit' && (
                <section className="mt-5 rounded-xl border p-4 text-sm">
                  <h3 className="font-medium">
                    Compras por vencimento · estimativa
                  </h3>
                  {(() => {
                    const cycle = cycles.find((c) => c.account === account)!;
                    const grouped = new Map<string, Decimal>();
                    entries
                      .filter(
                        (e) =>
                          e.account === account && e.entry_type === 'expense',
                      )
                      .forEach((e) => {
                        const date = invoiceFor(
                          saoDate(e.occurred_at),
                          cycle,
                        ).due;
                        grouped.set(
                          date,
                          (grouped.get(date) ?? new Decimal(0)).plus(e.amount),
                        );
                      });
                    return [...grouped]
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([date, total]) => (
                        <p key={date} className="mt-2">
                          {date.split('-').reverse().join('/')} ·{' '}
                          {new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(total.toNumber())}
                        </p>
                      ));
                  })()}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Usa a configuração salva e apenas compras registradas no
                    Vetra; não desconta pagamentos de fatura. Compras na data do
                    fechamento entram no próximo ciclo estimado. Mudanças de
                    data no banco podem ter regras de transição.
                  </p>
                </section>
              )}
            <fieldset disabled={busy} className="mt-6 space-y-4 border-t pt-5">
              <legend className="px-2 text-sm font-medium">
                Fatura e vencimento
              </legend>
              <label
                htmlFor="card-kind-credit"
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  id="card-kind-credit"
                  checked={kind === 'credit'}
                  onCheckedChange={(checked) =>
                    setKind(
                      checked
                        ? 'credit'
                        : bankId === 'flash'
                          ? 'benefit'
                          : 'debit',
                    )
                  }
                  disabled={bankId === 'flash'}
                />
                Cartão com fatura de crédito
              </label>
              <p className="text-sm text-muted-foreground">
                {rule.label}{' '}
                {rule.url && (
                  <a
                    className="underline"
                    href={rule.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Regra do banco
                  </a>
                )}
              </p>
              {kind === 'credit' && (
                <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
                  <label
                    htmlFor="card-show-invoices"
                    className="grid gap-1 text-sm"
                  >
                    Mostrar em Faturas
                    <span className="text-xs text-muted-foreground">
                      Desligado, o cartão some das Faturas, do calendário, da
                      página do banco e do Vetra AI. As compras continuam no
                      extrato e nos seus gastos.
                    </span>
                  </label>
                  <Switch
                    id="card-show-invoices"
                    checked={showInInvoices}
                    onCheckedChange={setShowInInvoices}
                  />
                </div>
              )}
              {kind === 'credit' && (
                <>
                  {rule.dueDays ? (
                    <label htmlFor="card-due" className="grid gap-4 text-sm">
                      Dia do vencimento no PicPay
                      <Select
                        value={due}
                        onValueChange={(value) => value && setDue(value)}
                      >
                        <SelectTrigger id="card-due" className="h-11 w-full">
                          <SelectValue placeholder="Escolha 5, 10, 15, 20 ou 25" />
                        </SelectTrigger>
                        <SelectContent
                          side="bottom"
                          alignItemWithTrigger={false}
                        >
                          {rule.dueDays.map((day) => (
                            <SelectItem key={day} value={String(day)}>
                              Dia {day}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ) : (
                    <label htmlFor="card-due" className="grid gap-4 text-sm">
                      Dia do vencimento mostrado no banco
                      <Input
                        id="card-due"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={31}
                        step={1}
                        required
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                        placeholder="Ex.: 10"
                        className="h-11"
                      />
                    </label>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Informe uma vez o dia escolhido no banco. O Apple Pay não
                    envia essa informação. As próximas datas serão calculadas
                    automaticamente, sem alterar seu cartão no banco.
                  </p>
                  <label
                    htmlFor="card-cycle-automatic"
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id="card-cycle-automatic"
                      checked={automatic}
                      onCheckedChange={(checked) => setAutomatic(!!checked)}
                    />
                    Calcular fechamento pela regra do banco
                  </label>
                  {!automatic && (
                    <label
                      htmlFor="card-closing"
                      className="grid gap-4 text-sm"
                    >
                      Dia de fechamento confirmado
                      <Input
                        id="card-closing"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={31}
                        step={1}
                        required
                        value={closing}
                        onChange={(e) => setClosing(e.target.value)}
                        className="h-11"
                      />
                    </label>
                  )}
                  {Number(due) >= 1 &&
                    Number(due) <= 31 &&
                    (automatic ||
                      (Number(closing) >= 1 && Number(closing) <= 31)) && (
                      <p className="rounded-xl bg-muted p-3 text-sm">
                        Próximo ciclo estimado:{' '}
                        {(() => {
                          const next = invoiceFor(saoDate(new Date()), {
                            account,
                            kind,
                            due_day: Number(due),
                            closing_day: Number(closing) || 1,
                            closing_offset_days: automatic ? rule.days : null,
                          });
                          return `fecha ${next.closing.split('-').reverse().join('/')} · vence ${next.due.split('-').reverse().join('/')}`;
                        })()}
                        <span className="mt-2 block text-xs text-muted-foreground">
                          Datas nominais; confirme a fatura oficial,
                          especialmente feriados, fins de semana e mudanças de
                          vencimento.
                        </span>
                      </p>
                    )}
                </>
              )}
            </fieldset>
            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button type="submit" variant="glass" disabled={busy}>
                Salvar cartão
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
