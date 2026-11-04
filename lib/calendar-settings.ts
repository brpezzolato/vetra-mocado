// Aparência e itens do calendário do Resumo, escolhidos pelo Bruno: ícone
// (qualquer um do lucide-react, pelo nome) e cor de cada tipo, quais aparecem,
// dias do salário e do adiantamento e lembretes próprios. Guardado em
// `user_preferences` (chave `calendar`, até 2 KB): só o que difere do padrão.

/** Cores possíveis. Classes escritas por extenso para o Tailwind achar. */
export const CALENDAR_COLORS = {
  violet: {
    label: 'Roxo',
    dot: 'bg-violet-500',
    text: 'text-violet-600 dark:text-violet-400',
    soft: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  },
  indigo: {
    label: 'Anil',
    dot: 'bg-indigo-500',
    text: 'text-indigo-600 dark:text-indigo-400',
    soft: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
  },
  blue: {
    label: 'Azul',
    dot: 'bg-blue-500',
    text: 'text-blue-600 dark:text-blue-400',
    soft: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  },
  sky: {
    label: 'Céu',
    dot: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400',
    soft: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  },
  cyan: {
    label: 'Ciano',
    dot: 'bg-cyan-500',
    text: 'text-cyan-600 dark:text-cyan-400',
    soft: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  },
  teal: {
    label: 'Verde-água',
    dot: 'bg-teal-500',
    text: 'text-teal-600 dark:text-teal-400',
    soft: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  },
  emerald: {
    label: 'Esmeralda',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    soft: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  lime: {
    label: 'Lima',
    dot: 'bg-lime-500',
    text: 'text-lime-600 dark:text-lime-400',
    soft: 'bg-lime-500/15 text-lime-600 dark:text-lime-400',
  },
  yellow: {
    label: 'Amarelo',
    dot: 'bg-yellow-500',
    text: 'text-yellow-600 dark:text-yellow-400',
    soft: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  },
  amber: {
    label: 'Âmbar',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    soft: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  orange: {
    label: 'Laranja',
    dot: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
    soft: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  },
  red: {
    label: 'Vermelho',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    soft: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
  rose: {
    label: 'Rosa',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
    soft: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  },
  pink: {
    label: 'Pink',
    dot: 'bg-pink-500',
    text: 'text-pink-600 dark:text-pink-400',
    soft: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  },
  fuchsia: {
    label: 'Fúcsia',
    dot: 'bg-fuchsia-500',
    text: 'text-fuchsia-600 dark:text-fuchsia-400',
    soft: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  },
  slate: {
    label: 'Cinza',
    dot: 'bg-slate-500',
    text: 'text-slate-600 dark:text-slate-400',
    soft: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  },
} as const;

export type CalendarColor = keyof typeof CALENDAR_COLORS;

export const BUILTIN_ITEMS = [
  'invoice',
  'payment',
  'subscription',
  'benefit',
  'salary',
  'advance',
  'holiday',
] as const;
export type BuiltinItem = (typeof BUILTIN_ITEMS)[number];

/** Um tipo do calendário como aparece: nome, ícone (lucide, kebab-case) e cor. */
export type CalendarItemStyle = {
  label: string;
  icon: string;
  color: CalendarColor;
  hidden: boolean;
};

export const BUILTIN_DEFAULTS: Record<BuiltinItem, CalendarItemStyle> = {
  invoice: {
    label: 'Fatura',
    icon: 'credit-card',
    color: 'violet',
    hidden: false,
  },
  payment: {
    label: 'Pagamento',
    icon: 'circle-check',
    color: 'amber',
    hidden: false,
  },
  subscription: {
    label: 'Assinatura',
    icon: 'repeat-2',
    color: 'sky',
    hidden: false,
  },
  benefit: { label: 'Flash', icon: 'wallet', color: 'emerald', hidden: false },
  salary: { label: 'Salário', icon: 'banknote', color: 'teal', hidden: false },
  advance: {
    label: 'Adiantamento',
    icon: 'hand-coins',
    color: 'cyan',
    hidden: false,
  },
  holiday: {
    label: 'Feriado',
    icon: 'party-popper',
    color: 'rose',
    hidden: false,
  },
};

/** Lembrete próprio: todo mês no dia escolhido (ou no último). */
export type CustomCalendarItem = {
  id: string;
  label: string;
  icon: string;
  color: CalendarColor;
  day: number | 'last';
  /** Se o dia não for útil, vale o dia útil anterior. */
  businessBefore: boolean;
  hidden?: boolean;
};

export const MAX_CUSTOM_ITEMS = 10;

export type CalendarSettings = {
  /** Só o que mudou em cada tipo pronto. */
  builtins?: Partial<
    Record<BuiltinItem, Partial<Omit<CalendarItemStyle, 'label'>>>
  >;
  salaryDay?: 'last-business' | 'last';
  advanceDay?: number;
  custom?: CustomCalendarItem[];
};

/** Chave de estilo de um evento: o tipo pronto ou `custom:<id>`. */
export const itemKey = (kind: string, itemId?: string) =>
  kind === 'custom' && itemId ? `custom:${itemId}` : kind;

const isColor = (value: unknown): value is CalendarColor =>
  typeof value === 'string' && value in CALENDAR_COLORS;

/** Todos os tipos, na ordem da legenda (que decide a cor do número do dia). */
export function calendarItems(settings: CalendarSettings | null) {
  const items = new Map<string, CalendarItemStyle>();
  for (const key of BUILTIN_ITEMS) {
    const own = settings?.builtins?.[key] ?? {};
    const base = BUILTIN_DEFAULTS[key];
    items.set(key, {
      label: base.label,
      icon: typeof own.icon === 'string' && own.icon ? own.icon : base.icon,
      color: isColor(own.color) ? own.color : base.color,
      hidden: own.hidden === true,
    });
  }
  for (const item of settings?.custom ?? [])
    items.set(itemKey('custom', item.id), {
      label: item.label,
      icon: item.icon,
      color: isColor(item.color) ? item.color : 'slate',
      hidden: item.hidden === true,
    });
  return items;
}

/** Dias do salário e do adiantamento no formato do motor do calendário. */
export function incomeSchedule(settings: CalendarSettings | null) {
  const day = settings?.advanceDay;
  return {
    salary: {
      enabled: settings?.builtins?.salary?.hidden !== true,
      day: settings?.salaryDay === 'last' ? 'last' : 'last-business',
    },
    advance: {
      enabled: settings?.builtins?.advance?.hidden !== true,
      day: Number.isInteger(day) && day! >= 1 && day! <= 28 ? day! : 15,
    },
  } as const;
}

/** Grava a mudança de um tipo pronto só se diferir do padrão. */
export function withBuiltin(
  settings: CalendarSettings,
  key: BuiltinItem,
  change: Partial<Omit<CalendarItemStyle, 'label'>>,
): CalendarSettings {
  const base = BUILTIN_DEFAULTS[key];
  const merged = { ...settings.builtins?.[key], ...change };
  const own: Partial<Omit<CalendarItemStyle, 'label'>> = {};
  if (merged.icon && merged.icon !== base.icon) own.icon = merged.icon;
  if (merged.color && merged.color !== base.color) own.color = merged.color;
  if (merged.hidden) own.hidden = true;
  const builtins = { ...settings.builtins };
  if (Object.keys(own).length) builtins[key] = own;
  else delete builtins[key];
  return { ...settings, builtins };
}
