'use client';
// Gráficos de /graficos (financial-visualizations.tsx): ritmo, dia da
// semana, mês, parcelas e categorias.

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  Rectangle,
  type RectangleProps,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Private } from '@/components/private-value';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  monthLabel,
  type FinancialVisualizations as Data,
} from '@/lib/financial-visualizations';
import { cn } from '@/lib/utils';
import { money } from '@/lib/money';

// One accent for the subject, one gray for context. Dark mode uses its own
// step of the same blue.
export const ACCENT = { light: '#2a78d6', dark: '#3987e5' };
export const CONTEXT = { light: '#b3b1aa', dark: '#6b6a65' };
export const config = {
  total: { label: 'Gasto', theme: ACCENT },
  current: { label: 'Este mês', theme: ACCENT },
  projected: { label: 'Projeção', theme: ACCENT },
  previous: { label: 'Mês anterior', theme: CONTEXT },
  average: { label: 'Média por dia', theme: ACCENT },
  context: { label: 'Contexto', theme: CONTEXT },
} satisfies ChartConfig;
// The same blue for HTML bars, which the chart config does not reach.
export const accentFill = 'bg-[#2a78d6] dark:bg-[#3987e5]';

export const percent = (value: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
export const dayMonth = (day: string) =>
  `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** How a period is named in the selector and in the headline. */
export const periodName = (period: string) =>
  period === 'all'
    ? 'Todo o histórico'
    : /^\d{4}$/.test(period)
      ? `Acumulado de ${period}`
      : monthName(period);
/** "de setembro", "de 2026", "do histórico" — for sentences about the period. */
export const ofPeriod = (data: Data) =>
  data.kind === 'month'
    ? `de ${monthLabel(data.month, 'long')}`
    : data.kind === 'year'
      ? `de ${data.year}`
      : 'do histórico';
/** The previous period a comparison points at, as a word. */
export const previousName = (data: Data, style: 'short' | 'long' = 'long') =>
  data.comparison.available
    ? data.kind === 'month'
      ? monthLabel(data.comparison.previous, style)
      : data.comparison.previous
    : '';
export const monthName = (month: string) => {
  const name = monthLabel(month, 'long');
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${month.slice(0, 4)}`;
};

export const weekdayName = (short: string) =>
  ({
    Seg: 'Segunda',
    Ter: 'Terça',
    Qua: 'Quarta',
    Qui: 'Quinta',
    Sex: 'Sexta',
    Sáb: 'Sábado',
    Dom: 'Domingo',
  })[short] ?? short;

// ---- Charts -----------------------------------------------------------------

export const tooltip = (
  <ChartTooltipContent
    formatter={(value, name) => (
      <div className="flex w-full items-center justify-between gap-4">
        <span className="text-muted-foreground">
          {config[name as keyof typeof config]?.label ?? name}
        </span>
        <span className="font-medium tabular-nums">{money(Number(value))}</span>
      </div>
    )}
    indicator="dot"
  />
);

export function PaceChart({ data }: { data: Data }) {
  if (!data.total && !data.projection?.scheduled) return <EmptyState />;
  const last = data.pace.length;
  const ticks = ['01', '05', '10', '15', '20', '25', String(last)];
  return (
    <>
      <Legend
        items={[
          { label: 'Gasto acumulado', swatch: 'solid' },
          ...(data.projection
            ? [{ label: 'Projeção', swatch: 'dashed' as const }]
            : []),
          ...(data.comparison.available
            ? [
                {
                  label: previousName(data),
                  swatch: 'context' as const,
                },
              ]
            : []),
        ]}
      />
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <LineChart data={data.pace} margin={{ left: 4, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis hide />
          <ChartTooltip content={tooltip} />
          {data.comparison.available && (
            <Line
              dataKey="previous"
              type="monotone"
              stroke="var(--color-previous)"
              strokeWidth={2}
              dot={false}
            />
          )}
          {data.projection && (
            <Line
              dataKey="projected"
              type="monotone"
              stroke="var(--color-projected)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
            />
          )}
          <Line
            dataKey="current"
            type="monotone"
            stroke="var(--color-current)"
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ChartContainer>
      <SrTable
        caption="Gasto acumulado por dia"
        columns={['Dia', 'Acumulado']}
        rows={data.pace
          .filter((point) => point.current !== null)
          .map((point) => [point.day, money(point.current!)])}
      />
    </>
  );
}

export function WeekdayChart({ data }: { data: Data }) {
  if (data.weekdays.every((item) => item.average === 0)) return <EmptyState />;
  // Same two-week threshold as the highlight.
  if (data.weekdayWindowDays < 14)
    return (
      <EmptyState
        message={`São ${data.weekdayWindowDays} dias registrados. Com duas semanas, cada dia da semana aparece pelo menos duas vezes e a média começa a dizer algo.`}
      />
    );
  // Most expensive day in the accent, the rest as backdrop.
  const top = Math.max(...data.weekdays.map((item) => item.average));
  return (
    <>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart data={data.weekdays} margin={{ left: 0, right: 0, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis hide />
          <ChartTooltip content={tooltip} />
          <Bar
            dataKey="average"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            // `shape` in place of <Cell>, which this recharts deprecates.
            shape={(props: unknown) => {
              const bar = props as RectangleProps & {
                payload: { average: number };
              };
              return (
                <Rectangle
                  {...bar}
                  fill={
                    bar.payload.average === top
                      ? 'var(--color-average)'
                      : 'var(--color-context)'
                  }
                />
              );
            }}
          />
        </BarChart>
      </ChartContainer>
      <SrTable
        caption="Média gasta por dia da semana"
        columns={['Dia', 'Média', 'Compras']}
        rows={data.weekdays.map((item) => [
          weekdayName(item.day),
          money(item.average),
          String(item.count),
        ])}
      />
    </>
  );
}

export function DailyChart({ data }: { data: Data }) {
  if (data.daily.every((item) => item.total === 0)) return <EmptyState />;
  return (
    <>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart data={data.daily} margin={{ left: 0, right: 0, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis hide />
          <ChartTooltip content={tooltip} />
          <Bar
            dataKey="total"
            fill="var(--color-total)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
      <SrTable
        caption="Gasto por dia"
        columns={['Dia', 'Gasto']}
        rows={data.daily.map((item) => [item.label, money(item.total)])}
      />
    </>
  );
}

export function MonthlyChart({ data }: { data: Data }) {
  const rows = data.monthly.map((item) => ({
    ...item,
    // Rest of the running month as a faint projection on top.
    remaining:
      item.projected !== null ? Math.max(0, item.projected - item.total) : 0,
    tick: item.partial ? `${item.label}*` : item.label,
  }));
  const start = data.monthly.find((item) => item.partial === 'start');
  return (
    <>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart data={rows} margin={{ left: 0, right: 0, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="tick"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis hide />
          <ChartTooltip content={tooltip} />
          <Bar
            dataKey="total"
            stackId="month"
            fill="var(--color-total)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="remaining"
            name="projected"
            stackId="month"
            fill="var(--color-projected)"
            fillOpacity={0.28}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        * Mês incompleto.
        {start &&
          data.trackingStart &&
          ` ${monthLabel(start.month, 'long').replace(/^./, (c) => c.toUpperCase())} começa em ${dayMonth(data.trackingStart)}, quando o registro começou.`}
        {data.monthly.some((item) => item.partial === 'current') &&
          (data.monthly.some((item) => item.projected !== null)
            ? ' O mês atual vai até hoje; a parte clara é a projeção.'
            : ' O mês atual vai até hoje.')}
      </p>
      <SrTable
        caption="Total por mês"
        columns={['Mês', 'Gasto']}
        rows={data.monthly.map((item) => [
          monthLabel(item.month, 'long'),
          money(item.total),
        ])}
      />
    </>
  );
}

export function InstalmentsChart({ data }: { data: Data }) {
  if (!data.instalments.total)
    return <EmptyState message="Nenhuma parcela futura registrada." />;
  return (
    <>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart
          data={data.instalments.months}
          margin={{ left: 0, right: 0, top: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis hide />
          <ChartTooltip content={tooltip} />
          <Bar
            dataKey="total"
            fill="var(--color-total)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
      <SrTable
        caption="Parcelas por mês"
        columns={['Mês', 'Parcelas']}
        rows={data.instalments.months.map((item) => [
          monthLabel(item.month, 'long'),
          money(item.total),
        ])}
      />
    </>
  );
}

// ---- Category pie -----------------------------------------------------------

// Colour follows the all-time category rank (`categoryRanking`), stable across
// months. Five slots so neighbours stay distinguishable; the rest is gray.
export const CATEGORY_SLOTS = [
  { light: '#2a78d6', dark: '#3987e5' },
  { light: '#eb6834', dark: '#d95926' },
  { light: '#1baf7a', dark: '#199e70' },
  { light: '#eda100', dark: '#c98500' },
  { light: '#e87ba4', dark: '#d55181' },
];
export const categoryConfig = {
  ...Object.fromEntries(
    CATEGORY_SLOTS.map((theme, index) => [
      `slot${index}`,
      { label: '', theme },
    ]),
  ),
  other: { label: 'Outros', theme: CONTEXT },
} satisfies ChartConfig;
// The same colours for the HTML legend, which the chart config does not reach.
export const SLOT_DOT = [
  'bg-[#2a78d6] dark:bg-[#3987e5]',
  'bg-[#eb6834] dark:bg-[#d95926]',
  'bg-[#1baf7a] dark:bg-[#199e70]',
  'bg-[#eda100] dark:bg-[#c98500]',
  'bg-[#e87ba4] dark:bg-[#d55181]',
];
export const OTHER_DOT = 'bg-[#b3b1aa] dark:bg-[#6b6a65]';

/**
 * Five slices plus "Outros" (merged with the real one), in all-time rank
 * order. The legend carries the figures, no hover needed.
 */
export function CategoryPie({ data }: { data: Data }) {
  const slices = useMemo(() => {
    const colored = data.categoryRanking.slice(0, CATEGORY_SLOTS.length);
    const rows = colored.flatMap((name, index) => {
      const item = data.categories.find((category) => category.name === name);
      return item
        ? [{ ...item, key: `slot${index}`, dot: SLOT_DOT[index] }]
        : [];
    });
    const rest = data.categories.filter((item) => !colored.includes(item.name));
    if (rest.length)
      rows.push({
        name: 'Outros',
        key: 'other',
        dot: OTHER_DOT,
        total: rest.reduce((sum, item) => sum + item.total, 0),
        count: rest.reduce((sum, item) => sum + item.count, 0),
        share: rest.reduce((sum, item) => sum + item.share, 0),
      });
    return rows;
  }, [data.categories, data.categoryRanking]);
  if (!slices.length) return <EmptyState />;
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="relative mx-auto aspect-square w-full max-w-56">
        <ChartContainer
          config={categoryConfig}
          className="aspect-square h-full w-full"
        >
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  hideLabel
                  nameKey="key"
                  formatter={(value, _name, item) => (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        {(item.payload as { name: string }).name}
                      </span>
                      <span className="font-medium tabular-nums">
                        {money(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Pie
              data={slices.map((slice) => ({
                ...slice,
                fill: `var(--color-${slice.key})`,
              }))}
              dataKey="total"
              nameKey="key"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              // Surface-coloured seam between slices.
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </PieChart>
        </ChartContainer>
        {/* The total in the hole: the one number the pie is a share of. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[11px] text-muted-foreground">Total</p>
            <p className="text-base font-semibold tracking-tight">
              <Private>{money(data.total)}</Private>
            </p>
          </div>
        </div>
      </div>
      <ul className="space-y-2.5">
        {slices.map((slice) => (
          <li
            key={slice.key}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={cn('size-2.5 shrink-0 rounded-full', slice.dot)}
              />
              <span className="truncate">{slice.name}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="font-medium tabular-nums">
                <Private>{money(slice.total)}</Private>
              </span>
              <span className="ml-2 inline-block w-9 text-xs text-muted-foreground tabular-nums">
                <Private>{percent(slice.share)}%</Private>
              </span>
            </span>
          </li>
        ))}
      </ul>
      <SrTable
        caption="Gasto por categoria"
        columns={['Categoria', 'Gasto', 'Participação']}
        rows={slices.map((slice) => [
          slice.name,
          money(slice.total),
          `${percent(slice.share)}%`,
        ])}
      />
    </div>
  );
}

// ---- Building blocks --------------------------------------------------------

/** Ranked list with value and a thin bar scaled to the largest item. */
export function BarList({
  items,
}: {
  items: { name: string; value: number; detail: string; colour?: string }[];
}) {
  if (!items.length) return <EmptyState />;
  const max = Math.max(...items.map((item) => item.value));
  return (
    <ul className="space-y-3.5">
      {items.map((item) => (
        <li key={item.name}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {item.colour && (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: item.colour }}
                />
              )}
              <span className="truncate">{item.name}</span>
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              <Private>{money(item.value)}</Private>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', !item.colour && accentFill)}
              style={{
                width: `${max ? Math.max(2, (item.value / max) * 100) : 0}%`,
                backgroundColor: item.colour,
              }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            <Private>{item.detail}</Private>
          </p>
        </li>
      ))}
    </ul>
  );
}

export function Changes({ items }: { items: Data['categoryChanges'] }) {
  if (!items.length)
    return (
      <EmptyState message="Nenhuma categoria mudou em relação ao mês anterior." />
    );
  return (
    <ul className="divide-y">
      {items.slice(0, 7).map((item) => {
        const up = item.delta > 0;
        const Icon = up ? ArrowUpRight : ArrowDownRight;
        return (
          <li
            key={item.name}
            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                antes <Private>{money(item.previous)}</Private> · agora{' '}
                <Private>{money(item.total)}</Private>
              </p>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-0.5 text-sm font-medium',
                up ? 'text-red-500' : 'text-emerald-500',
              )}
            >
              <Icon className="size-3.5" />
              <Private>
                {up ? '+' : '−'}
                {money(Math.abs(item.delta))}
              </Private>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function Legend({
  items,
}: {
  items: { label: string; swatch: 'solid' | 'dashed' | 'context' }[];
}) {
  if (items.length < 2) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="18" height="6" className="shrink-0">
            <line
              x1="1"
              x2="17"
              y1="3"
              y2="3"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={item.swatch === 'dashed' ? '4 3' : undefined}
              className={
                item.swatch === 'context'
                  ? 'stroke-[#b3b1aa] dark:stroke-[#6b6a65]'
                  : 'stroke-[#2a78d6] dark:stroke-[#3987e5]'
              }
            />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Screen-reader table twin of a chart. */
export function SrTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, index) => (
              <td key={index} data-private-value>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-3xl border bg-card p-5 md:p-6">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 mb-5 text-xs leading-relaxed text-muted-foreground">
        {subtitle}
      </p>
      {children}
    </section>
  );
}

export function EmptyState({
  message = 'Nenhum gasto registrado neste período.',
}: {
  message?: string;
}) {
  return (
    <div className="grid h-40 place-items-center rounded-2xl border border-dashed px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
