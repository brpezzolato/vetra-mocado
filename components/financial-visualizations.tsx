'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { NavigationBackButton } from '@/components/navigation-back-button';
import { Private } from '@/components/private-value';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/select';
import type { FinancialEntry } from '@/lib/financial-tracker';
import {
  availableMonths,
  availableYears,
  buildFinancialVisualizations,
  monthLabel,
  type FinancialVisualizations as Data,
} from '@/lib/financial-visualizations';
import { PAYMENT_METHOD_COLOUR, type PaymentCard } from '@/lib/payment-cards';
import { cn } from '@/lib/utils';
import { money } from '@/lib/money';
import {
  accentFill,
  percent,
  dayMonth,
  periodName,
  ofPeriod,
  previousName,
  weekdayName,
  PaceChart,
  WeekdayChart,
  DailyChart,
  MonthlyChart,
  InstalmentsChart,
  CategoryPie,
  BarList,
  Changes,
  ChartCard,
} from '@/components/financial-charts';

export function FinancialVisualizations({
  entries,
  cards,
}: {
  entries: FinancialEntry[];
  cards: PaymentCard[];
}) {
  const router = useRouter();
  const months = useMemo(() => availableMonths(entries), [entries]);
  const years = useMemo(() => availableYears(entries), [entries]);
  // Widest to narrowest: history, years, months.
  const periods = useMemo(() => ['all', ...years, ...months], [years, months]);
  const [selected, setSelected] = useState(months[0]);
  // A period can vanish after a refresh; fall back to the current month.
  const period = periods.includes(selected) ? selected : months[0];
  const data = useMemo(
    () => buildFinancialVisualizations(entries, { period, cards }),
    [entries, period, cards],
  );
  const shortMonth =
    data.kind === 'month'
      ? monthLabel(data.month, 'long')
      : data.kind === 'year'
        ? data.year
        : 'todo o histórico';

  return (
    <main className="min-h-dvh bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AppHeader onRefresh={() => router.refresh()} />
      <div className="app-container space-y-6 py-7 md:py-10">
        <NavigationBackButton />
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[.18em] text-muted-foreground">
              Raio-x dos gastos
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Para onde seu dinheiro está indo
            </h1>
          </div>
          {/* One control scoping every card below. */}
          {periods.length > 1 && (
            <Select
              value={period}
              onValueChange={(value) => value && setSelected(value)}
            >
              {/* Liquid glass: exceção registrada no AGENTS.md. `.vetra-glass` sem camada faz
                  borda, fundo e raio cederem sozinhos. */}
              <SelectTrigger
                aria-label="Período"
                className="vetra-glass h-10 min-w-44 px-4"
              >
                <span>{periodName(period)}</span>
              </SelectTrigger>
              <SelectContent className="w-auto min-w-(--anchor-width)">
                <SelectItem value="all">{periodName('all')}</SelectItem>
                {years.map((item) => (
                  <SelectItem key={item} value={item}>
                    {periodName(item)}
                  </SelectItem>
                ))}
                <SelectSeparator />
                {months.map((item) => (
                  <SelectItem key={item} value={item}>
                    {periodName(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </header>

        <Headline data={data} shortMonth={shortMonth} />
        <Highlights data={data} />

        {data.kind === 'month' ? (
          <ChartCard
            title="Ritmo do mês"
            subtitle={
              data.isCurrentMonth
                ? 'Quanto já saiu, dia a dia, e onde o mês termina se continuar assim'
                : 'Quanto saiu, acumulado dia a dia'
            }
          >
            <PaceChart data={data} />
          </ChartCard>
        ) : (
          // Year/history: the monthly chart takes the top slot.
          <ChartCard
            title="Mês a mês"
            subtitle={
              data.kind === 'year'
                ? `Cada mês de ${data.year} desde que você começou a registrar`
                : 'Cada mês desde que você começou a registrar'
            }
          >
            <MonthlyChart data={data} />
          </ChartCard>
        )}

        <section className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Por categoria"
            subtitle={`Participação no total de ${shortMonth}`}
          >
            <CategoryPie data={data} />
          </ChartCard>

          <ChartCard
            title="Onde mais gasta"
            subtitle={`Os oito estabelecimentos que mais pesaram ${data.kind === 'month' ? 'no mês' : data.kind === 'year' ? `em ${data.year}` : 'no histórico'}`}
          >
            <BarList
              items={data.merchants.slice(0, 8).map((item) => ({
                name: item.name,
                value: item.total,
                detail: `${item.count} ${item.count === 1 ? 'compra' : 'compras'} · ${percent(item.share)}%`,
              }))}
            />
          </ChartCard>

          <ChartCard
            title="Por cartão ou conta"
            subtitle="Com que meio de pagamento o mês foi pago"
          >
            <BarList
              items={data.accounts.map((item) => ({
                name: item.name,
                value: item.total,
                detail: `${percent(item.share)}% · ${item.count} ${item.count === 1 ? 'compra' : 'compras'}`,
                // Brand colour, always with the name beside it.
                colour: PAYMENT_METHOD_COLOUR[item.method],
              }))}
            />
          </ChartCard>

          {data.comparison.available && (
            <ChartCard
              title="O que mudou"
              subtitle={`Contra o mesmo período de ${previousName(data)}, maiores variações primeiro`}
            >
              <Changes items={data.categoryChanges} />
            </ChartCard>
          )}

          <ChartCard
            title="Dia da semana"
            subtitle={`Média gasta em cada dia · ${data.weekdayWindowDays} dias ${
              data.kind === 'month'
                ? data.weekdayWindowDays < 90
                  ? 'desde o primeiro registro'
                  : 'mais recentes'
                : data.kind === 'year'
                  ? `registrados em ${data.year}`
                  : 'de histórico'
            }`}
          >
            <WeekdayChart data={data} />
          </ChartCard>

          <ChartCard
            title="Dia a dia"
            subtitle={
              data.daily.length < 14
                ? `Desde o primeiro registro, ${dayMonth(data.daily[0]?.day ?? data.referenceDay)}`
                : 'Os últimos 14 dias'
            }
          >
            <DailyChart data={data} />
          </ChartCard>

          {data.kind === 'month' && data.monthly.length > 1 && (
            <ChartCard
              title="Mês a mês"
              subtitle="Total de cada mês desde que você começou a registrar"
            >
              <MonthlyChart data={data} />
            </ChartCard>
          )}

          <ChartCard
            title="Parcelas a vencer"
            subtitle="Compromissos já registrados, a partir de hoje"
          >
            <InstalmentsChart data={data} />
          </ChartCard>
        </section>
      </div>
    </main>
  );
}

// ---- Headline ---------------------------------------------------------------

function Headline({ data, shortMonth }: { data: Data; shortMonth: string }) {
  const { comparison, projection, payers, instalments } = data;
  const lastInstalment = instalments.months.at(-1);
  return (
    <section
      aria-label="Resumo do período"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <StatTile
        label={
          data.kind === 'all'
            ? 'Gasto em todo o histórico'
            : `Gasto em ${shortMonth}`
        }
        value={data.total}
        detail={
          <>
            {data.count} {data.count === 1 ? 'compra' : 'compras'}
            {data.kind === 'all' && data.trackingStart
              ? ` desde ${dayMonth(data.trackingStart)}/${data.trackingStart.slice(0, 4)}`
              : (data.isCurrentMonth || data.kind === 'year') &&
                ` até ${dayMonth(data.referenceDay)}`}
          </>
        }
        trend={
          comparison.available && comparison.changePercent !== null ? (
            <Trend
              value={comparison.changePercent}
              label={`vs. ${previousName(data, 'short')}`}
            />
          ) : null
        }
      />
      {projection ? (
        <StatTile
          label="Projeção para o fim do mês"
          value={projection.total}
          detail={
            <>
              no ritmo de <Private>{money(projection.dailyPace)}</Private> por
              dia
              {projection.scheduled > 0 && (
                <>
                  , com <Private>{money(projection.scheduled)}</Private> já
                  agendados
                </>
              )}
              {projection.tentative && ' · estimativa inicial'}
            </>
          }
        />
      ) : data.kind !== 'month' ? (
        // Year/history: per-day and per-month cost instead of per-purchase.
        <StatTile
          label="Média por dia"
          value={data.dailyAverage}
          detail={
            <>
              cerca de <Private>{money(data.dailyAverage * 30)}</Private> por
              mês · {data.countedDays} dias registrados
            </>
          }
        />
      ) : (
        <StatTile
          label="Média por compra"
          value={data.average}
          detail={
            data.largest ? (
              <>
                maior: <Private>{money(data.largest.amount)}</Private>
              </>
            ) : (
              'nenhuma compra no mês'
            )
          }
        />
      )}
      <StatTile
        label="Do seu bolso"
        value={payers.own}
        detail={
          payers.benefit > 0 || payers.otherPayer > 0 ? (
            <>
              {payers.benefit > 0 && (
                <>
                  <Private>{money(payers.benefit)}</Private> do benefício
                </>
              )}
              {payers.benefit > 0 && payers.otherPayer > 0 && ' · '}
              {payers.otherPayer > 0 && (
                <>
                  <Private>{money(payers.otherPayer)}</Private> pagos por outra
                  pessoa
                </>
              )}
            </>
          ) : (
            'tudo saiu do seu dinheiro'
          )
        }
      />
      <StatTile
        label="Parcelas a vencer"
        value={instalments.total}
        detail={
          lastInstalment
            ? `até ${monthLabel(lastInstalment.month, 'long')}`
            : 'nenhuma parcela futura'
        }
      />
    </section>
  );
}

function StatTile({
  label,
  value,
  detail,
  trend,
}: {
  label: string;
  value: number;
  detail: React.ReactNode;
  trend?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {/* Proportional figures: tabular digits look loose at this size. */}
      <p className="mt-2 text-2xl font-semibold tracking-tight">
        <Private>{money(value)}</Private>
      </p>
      {trend && <div className="mt-1">{trend}</div>}
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

/** Up is red, down is green; always with arrow and sign. */
function Trend({ value, label }: { value: number; label: string }) {
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        up
          ? 'text-red-500'
          : value < 0
            ? 'text-emerald-500'
            : 'text-muted-foreground',
      )}
    >
      {value !== 0 && <Icon className="size-3.5" />}
      <Private>
        {value > 0 ? '+' : ''}
        {percent(value)}%
      </Private>
      <span className="ml-1 font-normal text-muted-foreground">{label}</span>
    </span>
  );
}

// ---- Highlights -------------------------------------------------------------

/** Three plain-language findings above the charts. */
function Highlights({ data }: { data: Data }) {
  const lines: React.ReactNode[] = [];
  const top = data.merchants[0];
  if (top)
    lines.push(
      <>
        <strong className="font-medium">{top.name}</strong> é para onde mais vai
        dinheiro: {top.count} {top.count === 1 ? 'compra' : 'compras'},{' '}
        <Private>{money(top.total)}</Private> ({percent(top.share)}%{' '}
        {ofPeriod(data)}).
      </>,
    );
  if (data.largest)
    lines.push(
      <>
        A maior compra foi{' '}
        <strong className="font-medium">{data.largest.description}</strong>,{' '}
        <Private>{money(data.largest.amount)}</Private>, em{' '}
        {dayMonth(data.largest.day)}.
      </>,
    );
  // Under two weeks a weekday pattern is one purchase.
  const busiest = [...data.weekdays].sort((a, b) => b.average - a.average)[0];
  if (busiest && busiest.average > 0 && data.weekdayWindowDays >= 14)
    lines.push(
      <>
        <strong className="font-medium">{weekdayName(busiest.day)}</strong> é o
        dia mais caro da semana: em média{' '}
        <Private>{money(busiest.average)}</Private>.
      </>,
    );
  if (
    !data.comparison.available &&
    data.comparison.from &&
    data.kind === 'year'
  )
    lines.push(
      <>
        A comparação com o ano anterior aparece em {data.comparison.from}: é o
        primeiro ano em que o anterior foi registrado do começo ao fim.
      </>,
    );
  else if (!data.comparison.available && data.comparison.from)
    lines.push(
      <>
        A comparação com o mês anterior aparece a partir de{' '}
        {monthLabel(data.comparison.from, 'long')}: é o primeiro mês em que o
        anterior foi registrado do começo ao fim.
      </>,
    );
  if (!lines.length) return null;
  return (
    <section
      aria-label="Destaques"
      className="rounded-3xl border bg-card p-5 md:p-6"
    >
      <h2 className="font-semibold">Destaques</h2>
      <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
        {lines.map((line, index) => (
          <li key={index} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className={cn('mt-2 size-1.5 shrink-0 rounded-full', accentFill)}
            />
            <span className="[&_strong]:text-foreground">{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
