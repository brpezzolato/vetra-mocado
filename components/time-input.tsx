'use client';

import { Input } from '@/components/ui/input';
import { maskTime } from '@/lib/date-time-input';

export function TimeInput({
  id,
  value,
  onValueChange,
  disabled = false,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      id={id}
      required
      type="text"
      inputMode="numeric"
      autoComplete="off"
      enterKeyHint="done"
      maxLength={5}
      pattern="(?:[01]\d|2[0-3]):[0-5]\d"
      title="Informe a hora no formato HH:MM, entre 00:00 e 23:59."
      placeholder="HH:MM"
      className="h-11 w-full min-w-0 max-w-full tabular-nums"
      value={value}
      disabled={disabled}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => onValueChange(maskTime(event.target.value))}
    />
  );
}
