'use client';
// Rendimento, gráfico e resumo da tela dos cofrinhos (vetra-dashboard.tsx).

import Decimal from 'decimal.js';
import { Landmark } from 'lucide-react';
import { bankPolicy, type DailyRate, type PiggyBank } from '@/lib/domain';
import type { ClosedSummary, MonthYield } from '@/lib/vault-history';
import {
  buildPortfolioSeries as portfolioSeries,
  calculateRealized,
} from '@/lib/portfolio';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Private } from '@/components/private-value';
import { money } from '@/lib/money';
import { shortDate } from '@/lib/vault-display';

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

export const monthLabel = (month: string) => {
  const label = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: SAO_PAULO_TIME_ZONE,
  }).format(new Date(`${month}-15T12:00:00-03:00`));
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/** "Quanto você já ganhou" por mês, discreto: é consulta. */
export function YieldOverview({
  months,
  total,
  closed,
}: {
  months: MonthYield[];
  total: Decimal;
  closed: ClosedSummary[];
}) {
  return (
    <section className="mb-6 rounded-2xl border border-border/60 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium text-muted-foreground">
          QUANTO VOCÊ JÁ GANHOU
        </h2>
        <p className="text-sm font-medium tabular-nums">
          <Private>+ {money(total)}</Private>
        </p>
      </div>
      <dl className="mt-1 divide-y divide-border/40 text-xs">
        {months.map((item) => (
          <div
            key={item.month}
            className="flex items-center justify-between gap-3 py-1.5"
          >
            <dt className="text-muted-foreground">{monthLabel(item.month)}</dt>
            <dd className="tabular-nums">
              <Private>+ {money(item.total)}</Private>
            </dd>
          </div>
        ))}
      </dl>
      {closed.length > 0 && (
        <div className="mt-2 border-t border-border/40 pt-2">
          <h3 className="text-[11px] font-medium text-muted-foreground">
            ENCERRADOS
          </h3>
          <ul className="divide-y divide-border/40 text-xs">
            {closed.map((item) => (
              <li
                key={item.key}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {item.label} · {item.detail.toLowerCase()}
                </span>
                <span className="shrink-0 tabular-nums">
                  <Private>+ {money(item.total)}</Private>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function Empty() {
  return (
    <section className="grid min-h-[360px] place-items-center rounded-3xl border bg-card p-8 text-center">
      <div>
        <Landmark className="mx-auto size-7" />
        <h2 className="mt-4 text-xl font-semibold">Nenhum cofrinho ainda</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Os cofrinhos vêm do banco: aparecem aqui sozinhos na próxima
          sincronização.
        </p>
      </div>
    </section>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-5 md:p-6">
      <p className="text-xs font-medium text-muted-foreground">
        {label.toUpperCase()}
      </p>
      <p data-private-value className="mt-3 text-lg font-semibold">
        {value}
      </p>
    </div>
  );
}

export function PeriodMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-3 sm:p-4">
      <p className="truncate text-[9px] font-medium text-muted-foreground sm:text-[10px]">
        {label.toUpperCase()}
      </p>
      <p
        data-private-value
        className="mt-2 truncate text-xs font-semibold sm:text-base"
      >
        +{value}
      </p>
    </div>
  );
}

/**
 * Gráfico de rendimento dos cofrinhos: rendimento líquido de hoje, saldo
 * em linha pequena e colunas por dia útil (hoje em cor, passado em tom
 * médio, previsto apagado). Tocar mostra o valor. 7 colunas no celular, 14
 * no computador.
 */
export function PortfolioChart({
  label,
  total,
  series,
  accent,
}: {
  label: string;
  total: Decimal;
  series: ReturnType<typeof portfolioSeries>;
  /** Coluna de hoje: o card é escuro nos dois temas, então a cor tem de ler no escuro. */
  accent: string;
}) {
  const TODAY = 6;
  // Só dias úteis: o IOF do fim de semana cai na segunda.
  const rows = series.points.map((point, index) => {
    const previous = series.points[index - 1];
    const gapDays = previous
      ? Math.round(
          (point.date.getTime() - previous.date.getTime()) / 86_400_000,
        )
      : 1;
    return {
      label: index === TODAY ? 'Hoje' : shortDate(point.date),
      gain: point.dailyNetGain.toNumber(),
      projected: point.projected,
      today: index === TODAY,
      weekend: gapDays > 1,
    };
  });
  const todayGain = series.points[TODAY].dailyNetGain;
  // Every column starts at zero; a small floor keeps a zero day visible.
  const peak = Math.max(...rows.map((row) => row.gain), 0);

  return (
    <section className="mb-7 overflow-hidden rounded-3xl bg-hero p-5 text-hero-foreground sm:p-6 md:p-8">
      <p className="text-xs text-hero-foreground/55">{label}</p>
      <p className="mt-2 text-3xl font-semibold">
        <Private>+{money(todayGain)}</Private>
      </p>
      <p className="mt-1 text-sm text-hero-foreground/55">
        {series.points[TODAY].projected ? 'Previsto para hoje' : 'Rendeu hoje'}{' '}
        · saldo <Private>{money(total)}</Private>
      </p>

      <div className="mt-6 grid grid-cols-7 items-end gap-2 md:grid-cols-14 md:gap-3">
        {rows.map((row, index) => {
          const height = peak ? Math.max(6, (row.gain / peak) * 100) : 6;
          return (
            <div
              key={index}
              className={`${index < TODAY - 3 || index > TODAY + 3 ? 'hidden md:grid' : 'grid'} min-w-0 gap-2`}
            >
              <div className="flex h-28 items-end md:h-40">
                {/* Popover, não Tooltip: o tooltip do Base UI não abre no toque. */}
                <Popover>
                  <PopoverTrigger
                    openOnHover
                    delay={0}
                    render={
                      <button
                        aria-label={`${row.label}${row.projected ? ', previsto' : ''}: ${money(row.gain)}`}
                        className={`w-full rounded-t-md ${row.today ? '' : row.projected ? 'bg-hero-foreground/10' : 'bg-hero-foreground/25'}`}
                        style={{
                          height: `${height}%`,
                          background: row.today ? accent : undefined,
                        }}
                      />
                    }
                  />
                  <PopoverContent
                    side="top"
                    className="w-auto gap-0.5 p-2 text-xs"
                  >
                    <span className="font-medium">
                      {row.label}
                      {row.projected && ' · previsto'}
                    </span>
                    <span>
                      <Private>+{money(row.gain)}</Private>
                      {row.weekend && ' (com o fim de semana)'}
                    </span>
                  </PopoverContent>
                </Popover>
              </div>
              <span
                className={`block truncate text-center text-[10px] tabular-nums ${row.today ? 'font-semibold text-hero-foreground' : 'text-hero-foreground/50'}`}
              >
                {row.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-5 text-xs text-hero-foreground/55">
        Próximos 7 dias úteis:{' '}
        <span className="font-medium text-hero-foreground">
          <Private>+{money(series.projectedGain)}</Private>
        </span>{' '}
        previsto
      </p>
    </section>
  );
}

export function Summary({
  banks,
  rates,
  viewName,
}: {
  banks: PiggyBank[];
  rates: DailyRate[];
  viewName: string;
}) {
  const total = banks.reduce(
    (sum, bank) => sum.plus(calculateRealized(bank, rates).netBalance),
    new Decimal(0),
  );
  return (
    <aside className="space-y-4">
      <div className="rounded-3xl border bg-card p-5">
        <p className="text-xs text-muted-foreground">
          COMPOSIÇÃO · {viewName.toUpperCase()}
        </p>
        <div className="mt-5 space-y-5">
          {banks.map((bank) => {
            const value = calculateRealized(bank, rates).netBalance;
            const share = total.gt(0)
              ? value.div(total).mul(100)
              : new Decimal(0);
            return (
              <div key={bank.id}>
                <div className="flex justify-between text-sm">
                  <span>{bank.bank}</span>
                  <strong>{share.toDecimalPlaces(0).toString()}%</strong>
                </div>
                <div className="mt-2 h-1 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${share.toNumber()}%`,
                      background: bankPolicy(bank.bank).color,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {bank.name} · <Private>{money(value)}</Private>
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
