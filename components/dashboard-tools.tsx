'use client';

import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import { CalendarClock } from 'lucide-react';
import type { DailyRate, PiggyBank } from '@/lib/domain';
import { calculateRealized } from '@/lib/portfolio';
import { iofExemptionAt } from '@/lib/finance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Private } from '@/components/private-value';

const money = (value: Decimal | string | number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    new Decimal(value || 0).toDecimalPlaces(2).toNumber(),
  );
const dateBR = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(`${value.slice(0, 10)}T12:00:00-03:00`),
  );

export function VaultDetailsDialog({
  open,
  onOpenChange,
  bank,
  rates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank: PiggyBank;
  rates: DailyRate[];
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => setNow(Date.now()));
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [open]);
  // O valor de agora é o do último saldo do banco (lib/portfolio.ts).
  const result = calculateRealized(bank, rates);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{bank.name}</DialogTitle>
          <DialogDescription>
            {bank.bank} · {bank.product}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-4">
          <DetailMetric label="Investido" value={money(result.principal)} />
          <DetailMetric
            label="Rendimento bruto"
            value={
              result.reconciled || !result.taxDetailsIncomplete
                ? money(result.grossProfit)
                : 'Não informado'
            }
          />
          {/* Imposto só o que o banco informou. */}
          <DetailMetric
            label="IR"
            value={
              result.taxesFromBank && !result.taxDetailsIncomplete
                ? money(result.incomeTax)
                : 'Não informado'
            }
          />
          <DetailMetric
            label="IOF"
            value={result.taxesFromBank ? money(result.iof) : 'Não informado'}
          />
          <DetailMetric
            label="Saldo líquido"
            value={money(result.netBalance)}
          />
        </div>
        {/* Os números vêm do banco; as regras do produto, do site dele. */}
        <div className="rounded-2xl border bg-muted/30 p-4 text-sm">
          <a
            href={
              bank.bank === 'Mercado Pago'
                ? 'https://www.mercadopago.com.br/cofrinhos'
                : 'https://nubank.com.br/nu/caixinhas'
            }
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs underline underline-offset-4"
          >
            Consultar regras oficiais do produto
          </a>
        </div>
        <div>
          <p className="mb-3 text-sm font-medium">Aportes ativos</p>
          <div className="space-y-2">
            {result.lots.length === 0 ? (
              <p className="rounded-xl border p-4 text-sm text-muted-foreground">
                Nenhum aporte ativo.
              </p>
            ) : (
              result.lots.map((lot) => {
                const deadline = iofExemptionAt(
                  lot.transaction.occurred_at,
                ).getTime();
                const remaining = Math.max(0, deadline - now);
                const days = Math.floor(remaining / 86400000);
                const hours = Math.floor((remaining % 86400000) / 3600000);
                const exempt = bank.iof_rule.toLowerCase().includes('isento');
                const finished = exempt || (now > 0 && remaining === 0);
                return (
                  <div
                    key={lot.transaction.id}
                    className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        <Private>{money(lot.remaining)}</Private> ·{' '}
                        {lot.transaction.id.startsWith('credit-')
                          ? 'crédito líquido de'
                          : 'aporte de'}{' '}
                        {dateBR(lot.transaction.occurred_at)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Líquido{' '}
                        <Private>{money(lot.settled.netBalance)}</Private> ·{' '}
                        {lot.taxDetailsIncomplete
                          ? 'bruto e IR não informados pelo banco'
                          : `bruto ${money(lot.settled.grossBalance)} · rendimento ${money(lot.settled.grossProfit)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground sm:text-right">
                      <CalendarClock className="size-4" />
                      {finished
                        ? 'IOF zerado'
                        : now
                          ? `${days}d ${hours}h para IOF zero`
                          : 'Calculando prazo…'}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[10px] text-muted-foreground">{label.toUpperCase()}</p>
      <p data-private-value className="mt-2 text-sm font-semibold">
        {value}
      </p>
    </div>
  );
}
