'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { CalendarIcon, iconNames } from '@/components/calendar-icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  BUILTIN_ITEMS,
  CALENDAR_COLORS,
  MAX_CUSTOM_ITEMS,
  calendarItems,
  incomeSchedule,
  withBuiltin,
  type BuiltinItem,
  type CalendarColor,
  type CalendarSettings,
  type CustomCalendarItem,
} from '@/lib/calendar-settings';
import { cn } from '@/lib/utils';

/** O que vale guardar (o banco recusa acima de 2 KB). */
const FITS = 1900;

/** Os nomes dos ícones são em inglês; algumas palavras comuns em português. */
const ALIASES: Record<string, string[]> = {
  casa: ['house', 'home'],
  aluguel: ['house', 'key'],
  carro: ['car'],
  dinheiro: ['banknote', 'coins', 'wallet'],
  cartao: ['credit-card'],
  pagamento: ['credit-card', 'receipt', 'circle-check'],
  conta: ['receipt', 'file-text'],
  luz: ['lightbulb', 'zap'],
  energia: ['zap', 'plug'],
  agua: ['droplet', 'droplets'],
  gas: ['flame'],
  internet: ['wifi', 'globe'],
  celular: ['smartphone'],
  telefone: ['phone'],
  saude: ['heart-pulse', 'stethoscope', 'pill'],
  remedio: ['pill'],
  academia: ['dumbbell'],
  escola: ['school', 'graduation-cap', 'book'],
  estudo: ['book', 'graduation-cap'],
  mercado: ['shopping-cart', 'shopping-basket'],
  compra: ['shopping-bag', 'shopping-cart'],
  comida: ['utensils', 'pizza', 'sandwich'],
  viagem: ['plane', 'luggage', 'map'],
  presente: ['gift'],
  festa: ['party-popper', 'cake'],
  aniversario: ['cake', 'gift'],
  pet: ['dog', 'cat', 'paw-print'],
  cachorro: ['dog', 'paw-print'],
  gato: ['cat', 'paw-print'],
  investimento: ['trending-up', 'piggy-bank', 'chart-line'],
  cofrinho: ['piggy-bank'],
  salario: ['banknote', 'briefcase'],
  trabalho: ['briefcase'],
  imposto: ['landmark', 'receipt'],
  banco: ['landmark'],
  lembrete: ['bell', 'alarm-clock'],
  alerta: ['bell', 'triangle-alert'],
  estrela: ['star'],
  coracao: ['heart'],
  musica: ['music'],
  filme: ['film', 'clapperboard'],
  jogo: ['gamepad-2'],
  assinatura: ['repeat-2', 'calendar-sync'],
  calendario: ['calendar', 'calendar-days'],
};

/** Sugestões com a busca vazia. */
const SUGGESTED = [
  'bell',
  'house',
  'key',
  'car',
  'zap',
  'droplet',
  'wifi',
  'smartphone',
  'heart-pulse',
  'pill',
  'dumbbell',
  'graduation-cap',
  'shopping-cart',
  'utensils',
  'plane',
  'gift',
  'cake',
  'paw-print',
  'piggy-bank',
  'trending-up',
  'landmark',
  'receipt',
  'credit-card',
  'banknote',
  'hand-coins',
  'coins',
  'wallet',
  'briefcase',
  'circle-check',
  'repeat-2',
  'party-popper',
  'star',
  'heart',
  'music',
  'film',
  'gamepad-2',
];

const unaccent = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function searchIcons(query: string) {
  const term = unaccent(query);
  if (!term) return SUGGESTED;
  const aliased = Object.entries(ALIASES)
    .filter(([word]) => word.startsWith(term))
    .flatMap(([, names]) => names);
  const named = iconNames.filter((name) => name.includes(term));
  return [...new Set([...aliased, ...named])].slice(0, 120);
}

const DAY_LABEL = (day: CustomCalendarItem['day']) =>
  day === 'last' ? 'Último dia do mês' : `Dia ${day}`;

export function CalendarSettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: CalendarSettings;
  onChange: (next: CalendarSettings) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const items = useMemo(() => calendarItems(settings), [settings]);
  const custom = settings.custom ?? [];
  const schedule = incomeSchedule(settings);
  const icons = useMemo(() => searchIcons(query), [query]);

  const save = (next: CalendarSettings) => {
    if (JSON.stringify(next).length > FITS) {
      setError('Não cabe mais nada: apague um lembrete ou encurte um nome.');
      return;
    }
    setError('');
    onChange(next);
  };
  const isBuiltin = (key: string): key is BuiltinItem =>
    (BUILTIN_ITEMS as readonly string[]).includes(key);
  const customOf = (key: string) =>
    custom.find((item) => `custom:${item.id}` === key);
  const updateCustom = (id: string, change: Partial<CustomCalendarItem>) =>
    save({
      ...settings,
      custom: custom.map((item) =>
        item.id === id ? { ...item, ...change } : item,
      ),
    });
  const change = (
    key: string,
    value: { icon?: string; color?: CalendarColor; hidden?: boolean },
  ) => {
    if (isBuiltin(key)) save(withBuiltin(settings, key, value));
    else {
      const item = customOf(key);
      if (item) updateCustom(item.id, value);
    }
  };
  const add = () => {
    const item: CustomCalendarItem = {
      id: Math.random().toString(36).slice(2, 8),
      label: 'Lembrete',
      icon: 'bell',
      color: 'orange',
      day: 10,
      businessBefore: false,
    };
    save({ ...settings, custom: [...custom, item] });
    setQuery('');
    setEditing(`custom:${item.id}`);
  };
  const remove = (id: string) => {
    save({ ...settings, custom: custom.filter((item) => item.id !== id) });
    setEditing(null);
  };

  const current = editing ? items.get(editing) : undefined;
  const currentCustom = editing ? customOf(editing) : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setEditing(null);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {editing && current ? (
          <>
            <DialogHeader>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 w-fit"
                onClick={() => setEditing(null)}
              >
                <ChevronLeft /> Calendário
              </Button>
              <DialogTitle className="flex items-center gap-2">
                <span
                  className={cn(
                    'grid size-7 place-items-center rounded-full text-white',
                    CALENDAR_COLORS[current.color].dot,
                  )}
                >
                  <CalendarIcon name={current.icon} className="size-4" />
                </span>
                {current.label || 'Lembrete'}
              </DialogTitle>
              <DialogDescription>
                O número do dia no calendário fica nesta cor.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-5">
              {currentCustom && (
                <div className="grid gap-2">
                  <Label htmlFor="calendar-item-name">Nome</Label>
                  <Input
                    id="calendar-item-name"
                    value={currentCustom.label}
                    maxLength={40}
                    onChange={(event) =>
                      updateCustom(currentCustom.id, {
                        label: event.target.value,
                      })
                    }
                  />
                </div>
              )}
              {editing === 'salary' && (
                <div className="grid gap-2">
                  <Label htmlFor="calendar-salary-day">Dia</Label>
                  <Select
                    value={schedule.salary.day}
                    onValueChange={(day) =>
                      day &&
                      save({
                        ...settings,
                        salaryDay: day === 'last' ? 'last' : undefined,
                      })
                    }
                  >
                    <SelectTrigger id="calendar-salary-day" className="w-full">
                      <SelectValue>
                        {schedule.salary.day === 'last'
                          ? 'Último dia do mês'
                          : 'Último dia útil do mês'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="last-business">
                        Último dia útil do mês
                      </SelectItem>
                      <SelectItem value="last">Último dia do mês</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {editing === 'advance' && (
                <div className="grid gap-2">
                  <Label htmlFor="calendar-advance-day">
                    Dia (se não for dia útil, o dia útil anterior)
                  </Label>
                  <Select
                    value={String(schedule.advance.day)}
                    onValueChange={(day) =>
                      day &&
                      save({
                        ...settings,
                        advanceDay: day === '15' ? undefined : Number(day),
                      })
                    }
                  >
                    <SelectTrigger id="calendar-advance-day" className="w-full">
                      <SelectValue>Dia {schedule.advance.day}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 28 }, (_, index) => (
                        <SelectItem key={index} value={String(index + 1)}>
                          Dia {index + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {currentCustom && (
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="calendar-item-day">Todo mês</Label>
                    <Select
                      value={String(currentCustom.day)}
                      onValueChange={(day) =>
                        day &&
                        updateCustom(currentCustom.id, {
                          day: day === 'last' ? 'last' : Number(day),
                        })
                      }
                    >
                      <SelectTrigger id="calendar-item-day" className="w-full">
                        <SelectValue>
                          {DAY_LABEL(currentCustom.day)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 31 }, (_, index) => (
                          <SelectItem key={index} value={String(index + 1)}>
                            Dia {index + 1}
                          </SelectItem>
                        ))}
                        <SelectItem value="last">Último dia do mês</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor="calendar-item-business"
                      className="font-normal"
                    >
                      Se não for dia útil, o dia útil anterior
                    </Label>
                    <Switch
                      id="calendar-item-business"
                      checked={currentCustom.businessBefore}
                      onCheckedChange={(businessBefore) =>
                        updateCustom(currentCustom.id, { businessBefore })
                      }
                    />
                  </div>
                </div>
              )}
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Cor</legend>
                <div className="grid grid-cols-8 gap-1.5">
                  {(Object.keys(CALENDAR_COLORS) as CalendarColor[]).map(
                    (color) => (
                      <Button
                        key={color}
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={CALENDAR_COLORS[color].label}
                        aria-pressed={current.color === color}
                        className={cn(
                          'rounded-full',
                          current.color === color &&
                            'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                        )}
                        onClick={() => change(editing, { color })}
                      >
                        <span
                          className={cn(
                            'size-6 rounded-full',
                            CALENDAR_COLORS[color].dot,
                          )}
                        />
                      </Button>
                    ),
                  )}
                </div>
              </fieldset>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Ícone</legend>
                <Input
                  aria-label="Buscar ícone"
                  placeholder="Buscar (ex.: casa, carro, house)"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <ScrollArea className="h-44 rounded-xl border">
                  <div className="grid grid-cols-7 gap-1 p-2">
                    {icons.map((name) => (
                      <Button
                        key={name}
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={name}
                        aria-label={name}
                        aria-pressed={current.icon === name}
                        className={cn(
                          current.icon === name &&
                            CALENDAR_COLORS[current.color].soft,
                        )}
                        onClick={() => change(editing, { icon: name })}
                      >
                        <CalendarIcon name={name} className="size-5" />
                      </Button>
                    ))}
                  </div>
                  {!icons.length && (
                    <p className="p-3 text-sm text-muted-foreground">
                      Nenhum ícone com esse nome. Tente em inglês.
                    </p>
                  )}
                </ScrollArea>
              </fieldset>
              {currentCustom && (
                <Button
                  type="button"
                  variant="ghost"
                  className="justify-self-start text-destructive"
                  onClick={() => {
                    if (window.confirm(`Apagar "${currentCustom.label}"?`))
                      remove(currentCustom.id);
                  }}
                >
                  <Trash2 /> Apagar lembrete
                </Button>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Personalizar calendário</DialogTitle>
              <DialogDescription>
                Escolha o que aparece, a cor e o ícone de cada tipo, ou crie
                lembretes que se repetem todo mês.
              </DialogDescription>
            </DialogHeader>
            <ul className="grid gap-1">
              {[...items].map(([key, item]) => {
                const id = `calendar-show-${key.replace(':', '-')}`;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 rounded-xl px-1 py-1.5"
                  >
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-full',
                        CALENDAR_COLORS[item.color].soft,
                      )}
                    >
                      <CalendarIcon name={item.icon} className="size-4" />
                    </span>
                    <Label
                      htmlFor={id}
                      className={cn(
                        'min-w-0 flex-1 truncate font-normal',
                        item.hidden && 'text-muted-foreground',
                      )}
                    >
                      {item.label || 'Lembrete'}
                    </Label>
                    <Switch
                      id={id}
                      checked={!item.hidden}
                      onCheckedChange={(shown) =>
                        change(key, { hidden: !shown })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Editar ${item.label || 'lembrete'}`}
                      onClick={() => {
                        setQuery('');
                        setEditing(key);
                      }}
                    >
                      <Pencil />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              disabled={custom.length >= MAX_CUSTOM_ITEMS}
              onClick={add}
            >
              <Plus /> Adicionar lembrete
            </Button>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
