'use client';
// Blocos do /resumo (period-summary-view.tsx): manchete, quanto dá para
// gastar hoje e divisões.

import Decimal from 'decimal.js';
import { BlueDaysBadge } from '@/components/streak-badge';
import { Private } from '@/components/private-value';
import {
  daysInTheBlue,
  provisionalSince,
  settlesOn,
  type AllowanceDay,
} from '@/lib/daily-allowance';
import { cn } from '@/lib/utils';
import { cardBankName, suggestedCardBank } from '@/lib/payment-cards';
import { type UnidentifiedSpend } from '@/lib/unidentified-spend';
import { money } from '@/lib/money';

/** "Minha Reserva +R$ 0,46": dica do resumo do dia. O <Private> do Headline mascara. */
export const vaultLabel = (item: { name: string; net: Decimal }) =>
  `${item.name} +${money(item.net)}`;

export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date(`${day}T12:00:00Z`));

export const shiftDay = (day: string, by: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
};

export const shiftMonth = (month: string, by: number) => {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export type Tone = 'default' | 'positive' | 'negative';

export const toneClass = (tone: Tone = 'default') =>
  tone === 'positive'
    ? 'text-emerald-500'
    : tone === 'negative'
      ? 'text-destructive'
      : '';

export type Stat = {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
};

/** Número principal grande; secundários numa faixa embaixo. */

export function Headline({
  caption,
  value,
  tone,
  stats,
}: {
  caption: string;
  value: string;
  tone?: Tone;
  stats: Stat[];
}) {
  return (
    <>
      <p className="mt-4 text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {caption}
      </p>
      <p
        className={`mt-1 text-4xl font-semibold tabular-nums md:text-5xl ${toneClass(tone)}`}
      >
        <Private>{value}</Private>
      </p>
      {stats.length > 0 && (
        <dl
          className={`mt-6 grid gap-4 border-t pt-5 sm:gap-6 ${
            stats.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
          }`}
        >
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd
                className={`mt-1 text-lg font-semibold tabular-nums ${toneClass(stat.tone)}`}
              >
                <Private>{stat.value}</Private>
              </dd>
              {/* Private: a dica carrega números. */}
              {stat.hint && (
                <dd className="mt-0.5 text-xs text-muted-foreground">
                  <Private>{stat.hint}</Private>
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

/**
 * Valor do dia no resumo diário: quanto dava para gastar, termômetro e
 * sequência no azul. Provisório nos 3 dias úteis em que compras ainda chegam.
 */
export function DayAllowance({
  day,
  today,
  allowances,
  spentByDay,
  pending,
}: {
  day: string;
  today: string;
  allowances: AllowanceDay[];
  spentByDay: Record<string, Decimal>;
  pending: UnidentifiedSpend[];
}) {
  const stored = allowances.find((item) => item.day === day);
  if (!stored) {
    if (!allowances.length) return null;
    return (
      <p className="rounded-2xl border border-dashed p-4 text-xs text-muted-foreground">
        Sem valor do dia: o Vetra não foi aberto neste dia, então ele não entra
        na sequência no azul.
      </p>
    );
  }
  const allowance = new Decimal(stored.allowance);
  const spent = spentByDay[day] ?? new Decimal(0);
  const over = spent.gt(allowance);
  const percent = allowance.gt(0)
    ? Math.min(100, spent.div(allowance).times(100).toNumber())
    : spent.gt(0)
      ? 100
      : 0;
  const blueDays = daysInTheBlue({
    today: day,
    now: today,
    allowances,
    spentByDay,
  });
  const provisional = day >= provisionalSince(today);
  const settles = settlesOn(day);
  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {day === today ? 'Hoje você pode' : 'Neste dia dava para gastar'}
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
            <Private>{money(allowance)}</Private>
          </p>
        </div>
        <p className="shrink-0 text-right text-xs text-muted-foreground">
          {blueDays.total > 0 ? (
            <BlueDaysBadge
              total={blueDays.total}
              provisional={blueDays.provisional}
            />
          ) : (
            'Nenhum dia no azul ainda'
          )}
          <br />
          {day === today ? 'até agora' : 'até este dia'}
        </p>
      </div>
      <div
        aria-hidden="true"
        className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10"
      >
        <span
          className={cn(
            'block h-full rounded-full',
            over ? 'bg-destructive' : 'bg-emerald-500',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p
        className={cn(
          'mt-2 text-xs',
          over ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {over ? (
          <>
            Passou <Private>{money(spent.minus(allowance))}</Private> do valor
            do dia · este dia não soma no azul
          </>
        ) : (
          <>
            Gastou <Private>{money(spent)}</Private> · sobraram{' '}
            <Private>{money(allowance.minus(spent))}</Private>
          </>
        )}
      </p>
      {pending.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          * Inclui{' '}
          {pending.map((item, index) => (
            <span key={item.account}>
              {index > 0 && ' e '}
              <Private>{money(item.amount)}</Private> no{' '}
              {cardBankName(suggestedCardBank(item.account))}
            </span>
          ))}{' '}
          que o limite já mostra, mas a compra ainda não chegou.
        </p>
      )}
      {provisional && (
        <p className="mt-3 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          Provisório até {settles.slice(8, 10)}/{settles.slice(5, 7)}: compras
          no cartão levam até 3 dias úteis para chegar, e o gasto, o valor e a
          sequência deste dia ainda podem mudar.
        </p>
      )}
    </section>
  );
}

/** Nada aqui ainda — dito sem uma caixa vazia do tamanho de um cartão. */
export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/** Ranking com barra proporcional à maior fatia (não a 100%). */
export function Breakdown({
  title,
  rows,
  empty,
  bare = false,
  counts = false,
}: {
  title: string;
  rows: { name: string; total: string; count: number; share: number }[];
  empty: string;
  /** Sem caixa própria, para ir dentro de outro cartão. */
  bare?: boolean;
  /** Mostra quantas compras somam o valor, junto da porcentagem. */
  counts?: boolean;
}) {
  const largest = Math.max(...rows.map((row) => Number(row.total)), 0);
  return (
    <section className={bare ? undefined : 'rounded-2xl border bg-card p-4'}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length ? (
        <ul className="mt-3 space-y-2.5">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{row.name}</span>
                <span className="shrink-0 tabular-nums">
                  <Private>{money(row.total)}</Private>
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  aria-hidden="true"
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{
                      width: `${largest ? (Number(row.total) / largest) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {counts &&
                    `${row.count} ${row.count === 1 ? 'compra' : 'compras'} · `}
                  <span className="inline-block w-9">
                    {row.share.toFixed(0)}%
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}
