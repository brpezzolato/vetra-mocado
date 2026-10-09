'use client';

import { useRef, useState } from 'react';
import { ptBR } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { displayDateToIso, maskDate } from '@/lib/date-time-input';

const isoToDisplayDate = (value: string) =>
  /^(\d{4})-(\d{2})-(\d{2})$/.test(value)
    ? value.split('-').reverse().join('/')
    : '';

export function DateInput({
  id,
  value,
  onValueChange,
  min,
  max,
  disabled = false,
  required = true,
  className,
  inputClassName,
  bare = false,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Para o campo em si, não para o invólucro: é o que permite a uma tela
   * pedir um fundo diferente sem mexer no Input de todo o app. */
  inputClassName?: string;
  /** A data como texto solto, sem caixa e sem ícone: tocar nela abre o
   * calendário. Para telas que já navegam por setas — o /resumo. */
  bare?: boolean;
}) {
  const [draft, setDraft] = useState(() => ({
    source: value,
    text: isoToDisplayDate(value),
  }));
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const text = draft.source === value ? draft.text : isoToDisplayDate(value);

  const validate = (next: string) => {
    const iso = displayDateToIso(next);
    if (!iso || (min && iso < min) || (max && iso > max)) return null;
    return iso;
  };
  const selected = value ? new Date(`${value}T12:00:00-03:00`) : undefined;

  const calendar = (
    <Calendar
      mode="single"
      locale={ptBR}
      timeZone="America/Sao_Paulo"
      selected={selected}
      disabled={
        min && max
          ? [
              { before: new Date(`${min}T12:00:00-03:00`) },
              { after: new Date(`${max}T12:00:00-03:00`) },
            ]
          : min
            ? { before: new Date(`${min}T12:00:00-03:00`) }
            : max
              ? { after: new Date(`${max}T12:00:00-03:00`) }
              : undefined
      }
      onSelect={(date) => {
        if (!date) return;
        const iso = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Sao_Paulo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(date);
        onValueChange(iso);
        setDraft({ source: iso, text: isoToDisplayDate(iso) });
        inputRef.current?.setCustomValidity('');
        setOpen(false);
      }}
    />
  );

  // Solta: a data é o botão que abre o calendário, sem campo de digitar.
  if (bare)
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              id={id}
              disabled={disabled}
              aria-label={`Escolher data: ${text || 'nenhuma'}`}
              className={cn(
                'h-11 min-w-0 px-2 tabular-nums',
                className,
                inputClassName,
              )}
            />
          }
        >
          {text || 'DD/MM/AAAA'}
        </PopoverTrigger>
        <PopoverContent align="center" side="bottom" className="w-auto p-0">
          {calendar}
        </PopoverContent>
      </Popover>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative min-w-0', className)}>
        <Input
          ref={inputRef}
          id={id}
          required={required}
          disabled={disabled}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={10}
          pattern="\d{2}/\d{2}/\d{4}"
          title="Informe uma data válida no formato DD/MM/AAAA."
          placeholder="DD/MM/AAAA"
          className={cn('pr-11 tabular-nums', inputClassName)}
          value={text}
          onChange={(event) => {
            const next = maskDate(event.target.value);
            setDraft({ source: value, text: next });
            const iso = validate(next);
            event.currentTarget.setCustomValidity(
              next.length === 10 && !iso ? 'Informe uma data válida.' : '',
            );
            if (iso) onValueChange(iso);
          }}
        />
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label="Abrir calendário"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
            />
          }
        >
          <CalendarDays />
        </PopoverTrigger>
      </div>
      <PopoverContent align="end" side="bottom" className="w-auto p-0">
        {calendar}
      </PopoverContent>
    </Popover>
  );
}
