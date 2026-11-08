'use client';
// Peças da página do banco (bank-detail.tsx): métricas, extrato, cartão e gráfico.

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CreditCard,
} from 'lucide-react';
import { Private } from '@/components/private-value';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import type { BankDetail, BankTransaction } from '@/lib/pluggy/bank-detail';
import { type PassThrough } from '@/lib/pluggy/bank-flows';
import { cn } from '@/lib/utils';
import { money } from '@/lib/money';

export const shortDay = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});

export function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'in' | 'out';
}) {
  return (
    <div className="rounded-2xl border bg-card p-3.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-sm font-semibold tabular-nums',
          tone === 'in' && 'text-emerald-500',
        )}
      >
        <Private>
          {tone === 'in' ? '+' : '−'}
          {money(Math.abs(value))}
        </Private>
      </p>
    </div>
  );
}

/** Uma linha do extrato: uma transação sozinha ou um repasse. */
export type StatementItem =
  | { transaction: BankTransaction }
  | { pair: PassThrough };

/** Repasse: entrada e saída juntas, saldo zerado. */
export function PassThroughRow({ pair }: { pair: PassThrough }) {
  const line = (transaction: BankTransaction, incoming: boolean) => {
    const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0',
            incoming ? 'text-emerald-500' : 'text-muted-foreground',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {transaction.description}
        </span>
        <span
          className={cn(
            'shrink-0 text-sm tabular-nums',
            incoming && 'text-emerald-500',
          )}
        >
          <Private>
            {incoming ? '+' : '−'}
            {money(Math.abs(transaction.amount))}
          </Private>
        </span>
      </span>
    );
  };
  return (
    <li className="px-4 py-3">
      <span className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <ArrowLeftRight className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Repasse</span>
          <span className="block text-xs text-muted-foreground">
            Entrou e saiu o mesmo valor
            {pair.out.category ? ` · ${pair.out.category}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          <Private>{money(0)}</Private>
        </span>
      </span>
      {/* `minmax(0,1fr)` deixa a coluna encolher; senão descrição longa empurra o valor. */}
      <span className="mt-2.5 ml-12 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 border-l pl-3">
        {line(pair.in, true)}
        {line(pair.out, false)}
      </span>
    </li>
  );
}

export function TransactionRow({
  transaction,
  onOpen,
}: {
  transaction: BankTransaction;
  onOpen: () => void;
}) {
  const incoming = transaction.amount >= 0;
  const internal = transaction.flow === 'internal';
  const Icon = internal
    ? ArrowLeftRight
    : incoming
      ? ArrowDownLeft
      : ArrowUpRight;
  const detail = [transaction.kind, transaction.category]
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join(' · ');
  const content = (
    <>
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-xl',
          internal
            ? 'bg-muted text-muted-foreground'
            : incoming
              ? 'bg-emerald-500/12 text-emerald-500'
              : 'bg-muted',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {transaction.description}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {internal
            ? `Entre suas contas${transaction.kind === 'Reserva' ? ' · cofrinho' : ''}`
            : detail || (incoming ? 'Entrada' : 'Saída')}
          {transaction.pending && ' · pendente'}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          internal ? 'text-muted-foreground' : incoming && 'text-emerald-500',
        )}
      >
        <Private>
          {incoming ? '+' : '−'}
          {money(Math.abs(transaction.amount))}
        </Private>
      </span>
    </>
  );
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {content}
      </button>
    </li>
  );
}

export const longDate = (day: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${day}T12:00:00Z`));

/**
 * Detalhe de uma movimentação. Em entradas que viraram renda, o
 * "Contar no Entrou" decide só se ela conta.
 */
export function BankTransactionDialog({
  transaction,
  bankName,
  counted,
  onCount,
  onClose,
}: {
  transaction: BankTransaction;
  bankName: string;
  counted?: boolean;
  onCount: (value: boolean) => void;
  onClose: () => void;
}) {
  const incoming = transaction.amount >= 0;
  const internal = transaction.flow === 'internal';
  const rows: [string, string][] = [
    ['Data', longDate(transaction.date)],
    ['Banco', bankName],
    ['Tipo', transaction.kind ?? (incoming ? 'Entrada' : 'Saída')],
    ...(transaction.category
      ? [['Categoria', transaction.category] as [string, string]]
      : []),
    [
      'Movimento',
      internal
        ? 'Entre as suas contas'
        : transaction.flow === 'yield'
          ? 'Rendimento'
          : incoming
            ? 'Entrou na conta'
            : 'Saiu da conta',
    ],
    ['Situação', transaction.pending ? 'Pendente' : 'Lançada pelo banco'],
  ];
  const switchId = `contar-${transaction.id}`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words">
            {transaction.description}
          </DialogTitle>
          <DialogDescription>Movimentação no {bankName}</DialogDescription>
        </DialogHeader>
        <p
          className={cn(
            'text-3xl font-semibold tabular-nums',
            internal ? 'text-muted-foreground' : incoming && 'text-emerald-500',
          )}
        >
          <Private>
            {incoming ? '+' : '−'}
            {money(Math.abs(transaction.amount))}
          </Private>
        </p>
        <dl className="divide-y rounded-2xl border">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 px-3 py-2.5 text-sm"
            >
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 text-right first-letter:uppercase">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {counted !== undefined && (
          <div className="flex items-start justify-between gap-4 rounded-2xl border p-3">
            <label htmlFor={switchId} className="grid gap-1 text-sm">
              Contar no Entrou
              <span className="text-xs text-muted-foreground">
                {counted
                  ? 'Conta no “Entrou” do Resumo e da home.'
                  : 'Fica no extrato, mas não conta no “Entrou”.'}
              </span>
            </label>
            <Switch id={switchId} checked={counted} onCheckedChange={onCount} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CardSummary({
  card,
  color,
}: {
  card: NonNullable<BankDetail['card']>;
  color: string;
}) {
  const used =
    card.limit && card.available !== null
      ? Math.min(1, Math.max(0, (card.limit - card.available) / card.limit))
      : null;
  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
          <CreditCard className="size-5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Cartão de crédito</p>
          {card.available !== null && (
            <p className="text-xs text-muted-foreground">
              <Private>{money(card.available)}</Private> disponíveis
            </p>
          )}
        </div>
      </div>
      {used !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(3, used * 100)}%`, background: color }}
          />
        </div>
      )}
      {card.limit !== null && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Limite de <Private>{money(card.limit)}</Private>
        </p>
      )}
      {card.bill && (
        <p className="mt-3 text-xs">
          Fatura de{' '}
          <span className="font-semibold">
            <Private>{money(card.bill.total)}</Private>
          </span>{' '}
          vence em {shortDay.format(new Date(`${card.bill.dueDate}T12:00:00Z`))}
        </p>
      )}
    </section>
  );
}

/**
 * Evolução do saldo: área na cor do banco com o ponto de hoje, sem eixos.
 * Desenhado na largura real (ResizeObserver), curva Catmull-Rom.
 */
export function BalanceChart({
  series,
  color,
}: {
  series: { day: string; balance: number }[];
  color: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = 80;
  const pad = 6;
  const values = series.map((point) => point.balance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = series.map(
    (point, index) =>
      [
        pad + (index / (series.length - 1)) * Math.max(0, width - pad * 2),
        pad + (1 - (point.balance - min) / span) * (height - pad * 2 - 8),
      ] as const,
  );
  // Controles seguem a tendência dos vizinhos, presos ao trecho.
  const clamp = (value: number, a: number, b: number) =>
    Math.min(Math.max(value, Math.min(a, b)), Math.max(a, b));
  let line = '';
  points.forEach(([x, y], index) => {
    if (index === 0) {
      line = `M${x.toFixed(1)} ${y.toFixed(1)}`;
      return;
    }
    const [x0, y0] = points[index - 1];
    const [xp, yp] = points[index - 2] ?? points[index - 1];
    const [xn, yn] = points[index + 1] ?? points[index];
    const c1x = x0 + (x - xp) / 6;
    const c1y = clamp(y0 + (y - yp) / 6, y0, y);
    const c2x = x - (xn - x0) / 6;
    const c2y = clamp(y - (yn - y0) / 6, y0, y);
    line += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const [lastX, lastY] = points[points.length - 1];
  const id = `bank-chart-${color.slice(1)}`;
  return (
    <div ref={ref} className="relative mt-5 h-20 w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.28} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path
            d={`${line} L${lastX.toFixed(1)} ${height} L${pad} ${height} Z`}
            fill={`url(#${id})`}
          />
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={lastX} cy={lastY} r={6} fill={color} opacity={0.2} />
          <circle cx={lastX} cy={lastY} r={3.5} fill={color} />
        </svg>
      )}
    </div>
  );
}
