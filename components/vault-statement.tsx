'use client';
// Extrato dos cofrinhos: rendimentos, movimentações e prazo do IOF.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Decimal from 'decimal.js';
import {
  ArrowDownRight,
  CircleDollarSign,
  CalendarDays,
  PiggyBank as PiggyBankIcon,
  Settings2,
} from 'lucide-react';
import type { PiggyBank, TransactionRow } from '@/lib/domain';
import { type StatementEarning } from '@/lib/earning-statement';
import { iofExemptionAt } from '@/lib/finance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Private } from '@/components/private-value';
import { money } from '@/lib/money';

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

export type StatementEntry =
  | ({
      type: 'earning';
      id: string;
      bank: PiggyBank;
      date: string;
    } & StatementEarning)
  | {
      type: 'movement';
      id: string;
      bank: PiggyBank;
      transaction: TransactionRow;
    };

export function EarningMovement({
  entry,
}: {
  entry: Extract<StatementEntry, { type: 'earning' }>;
}) {
  return (
    <StatementItem
      title="Rendimentos"
      icon={<CircleDollarSign />}
      bank={entry.bank}
      amount={entry.netAmount}
      date={entry.date}
      status={
        entry.distributed
          ? 'Saldo do banco, dividido por dia'
          : 'Saldo do banco'
      }
    >
      <dl className="divide-y divide-border/60">
        <StatementDetail
          label="Origem"
          value={
            entry.distributed
              ? 'Parte do rendimento entre dois saldos do banco, dividida pelos dias úteis'
              : 'Saldo do dia menos o do dia anterior'
          }
        />
        <StatementDetail
          label="Rendimento líquido"
          value={money(entry.netAmount)}
        />
        <StatementDetail
          label="Rendimento bruto"
          value={
            entry.grossAmount === null
              ? 'Não informado'
              : money(entry.grossAmount)
          }
        />
        <StatementDetail
          label="Imposto de Renda (IR)"
          value={
            entry.incomeTax === undefined
              ? 'Não informado'
              : money(entry.incomeTax)
          }
        />
        <StatementDetail
          label="IOF"
          value={entry.iof === undefined ? 'Não informado' : money(entry.iof)}
        />
        <StatementDetail
          label="Variação total de impostos"
          value={entry.taxes === null ? 'Não informada' : money(entry.taxes)}
        />
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Diferença entre o saldo que o banco informou neste dia e o saldo
        anterior, descontando o que entrou e saiu no intervalo. Se entre os dois
        houve fim de semana ou um dia sem sincronizar, o rendimento do intervalo
        inteiro aparece aqui. IR e IOF são a variação dos impostos que o banco
        reteria num resgate.
      </p>
    </StatementItem>
  );
}

export function Movement({
  bank,
  transaction,
}: {
  bank: PiggyBank;
  transaction: TransactionRow;
}) {
  const meta =
    transaction.kind === 'deposit'
      ? { label: 'Dinheiro reservado', icon: <PiggyBankIcon /> }
      : transaction.kind === 'withdrawal'
        ? { label: 'Retirada', icon: <ArrowDownRight /> }
        : { label: 'Ajuste de saldo', icon: <Settings2 /> };
  const amount = new Decimal(transaction.amount);
  return (
    <StatementItem
      title={meta.label}
      icon={meta.icon}
      bank={bank}
      amount={
        transaction.kind === 'withdrawal' ? amount.abs().negated() : amount
      }
      date={transaction.occurred_at}
      occurredAt={transaction.occurred_at}
      preview={
        transaction.kind === 'deposit' ? (
          <IofCountdown bank={bank} occurredAt={transaction.occurred_at} />
        ) : undefined
      }
    >
      <dl className="divide-y divide-border/60">
        <StatementDetail
          label="Tipo"
          value={transaction.kind === 'deposit' ? 'Aporte' : meta.label}
        />
        <StatementDetail label="Valor registrado" value={money(amount.abs())} />
        <StatementDetail
          label="Registrado em"
          value={statementDate(transaction.created_at, true, true)}
        />
      </dl>
      {transaction.kind === 'deposit' && (
        <section className="rounded-2xl border bg-muted/30 p-4">
          <h3 className="text-sm font-medium">Prazo do IOF deste aporte</h3>
          <IofCountdown bank={bank} occurredAt={transaction.occurred_at} />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {bank.iof_rule}
          </p>
        </section>
      )}
      {transaction.note && (
        <section>
          <h3 className="text-sm font-medium">Observação</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {transaction.note}
          </p>
        </section>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Movimentação lida do banco. Não movimenta dinheiro na sua conta.
      </p>
    </StatementItem>
  );
}

export function statementDate(value: string, withTime = false, full = false) {
  const date = new Date(
    value.length === 10 ? `${value}T12:00:00-03:00` : value,
  );
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    ...(full ? { year: 'numeric' as const } : {}),
  })
    .format(date)
    .replaceAll(' de ', ' ')
    .replace('.', '');
  if (!withTime) return day;
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(':', 'h');
  return `${day}, ${time}`;
}

export function StatementDetail({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        data-private-value
        className="min-w-0 break-words text-right font-medium tabular-nums"
      >
        {value}
      </dd>
    </div>
  );
}

export function StatementItem({
  title,
  icon,
  bank,
  amount,
  date,
  occurredAt,
  status,
  preview,
  onActivate,
  children,
}: {
  title: string;
  icon: ReactNode;
  bank: PiggyBank;
  amount: Decimal;
  date: string;
  occurredAt?: string;
  status?: string;
  preview?: ReactNode;
  onActivate?: () => void;
  children: ReactNode;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formattedAmount = `${amount.isNegative() ? '−' : '+'} ${money(amount.abs())}`;
  const amountColor = amount.gt(0)
    ? 'text-green-700 dark:text-green-400'
    : 'text-foreground';
  const triggerClassName =
    'group grid min-h-24 w-full grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl px-2 py-5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:gap-x-4 sm:px-4 sm:py-6';
  const triggerLabel = `${title}, ${formattedAmount}, ${bank.name}, ${statementDate(occurredAt ?? date, !!occurredAt, true)}. ${onActivate ? 'Editar rendimento' : 'Ver detalhes'}`;
  const triggerContent = (
    <>
      <span className="row-span-2 grid size-10 place-items-center rounded-full border-2 border-foreground/15 text-foreground sm:size-14 [&_svg]:size-5 [&_svg]:stroke-[1.5] sm:[&_svg]:size-7">
        {icon}
      </span>
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-start gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-sm font-semibold leading-snug sm:text-base">
          {title}
        </span>
        <span
          className={`min-w-0 break-all text-right text-sm font-semibold leading-snug tabular-nums sm:text-base ${amountColor}`}
        >
          <Private>{formattedAmount}</Private>
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground sm:text-xs">
          {bank.name}
        </span>
        <span className="text-right text-[11px] text-muted-foreground sm:text-xs">
          {statementDate(occurredAt ?? date, !!occurredAt)}
        </span>
      </span>
      {(status || preview) && (
        <span className="col-start-2 min-w-0">
          {status && (
            <span className="text-[10px] text-muted-foreground">{status}</span>
          )}
          {preview}
        </span>
      )}
    </>
  );
  if (onActivate)
    return (
      <button
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        onClick={onActivate}
      >
        {triggerContent}
      </button>
    );
  return (
    <Dialog>
      <DialogTrigger
        render={<button type="button" aria-label={triggerLabel} />}
        className={triggerClassName}
        aria-label={triggerLabel}
      >
        {triggerContent}
      </DialogTrigger>
      <DialogContent
        initialFocus={titleRef}
        className="rounded-3xl p-5 sm:max-w-xl sm:p-6"
      >
        <DialogHeader>
          <span
            aria-hidden="true"
            className="mb-2 grid size-12 place-items-center rounded-full border-2 border-foreground/15 [&_svg]:size-6 [&_svg]:stroke-[1.5]"
          >
            {icon}
          </span>
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="text-xl outline-none"
          >
            {title}
          </DialogTitle>
          <DialogDescription>
            {bank.bank} · {bank.name}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">
            {status ?? 'Movimentação registrada'}
          </p>
          <p
            className={`mt-1 break-all text-3xl font-semibold tracking-tight tabular-nums ${amountColor}`}
          >
            <Private>{formattedAmount}</Private>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {statementDate(occurredAt ?? date, !!occurredAt, true)}
            {occurredAt ? ' · São Paulo' : ''}
          </p>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function IofCountdown({
  bank,
  occurredAt,
}: {
  bank: PiggyBank;
  occurredAt: string;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const frame = window.requestAnimationFrame(update);
    const timer = window.setInterval(update, 60_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);
  const exempt = bank.iof_rule.toLowerCase().includes('isento');
  const deadline = iofExemptionAt(occurredAt).getTime();
  const remaining = now ? Math.max(0, deadline - now) : 0;
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const finished = exempt || (now > 0 && remaining === 0);
  return (
    <span className="mt-2 inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-[10px] font-medium text-muted-foreground">
      <CalendarDays className="size-3" />
      {finished
        ? 'IOF zerado'
        : now
          ? `IOF zero em ${days}d ${hours}h ${minutes}min`
          : 'Calculando IOF…'}
    </span>
  );
}
