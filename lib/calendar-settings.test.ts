import { describe, expect, it } from 'vitest';
import {
  calendarItems,
  incomeSchedule,
  withBuiltin,
} from './calendar-settings';

describe('personalização do calendário', () => {
  it('sem nada guardado, vale o padrão de cada tipo', () => {
    const items = calendarItems(null);
    expect(items.get('holiday')).toEqual({
      label: 'Feriado',
      icon: 'party-popper',
      color: 'rose',
      hidden: false,
    });
    expect([...items.keys()]).toEqual([
      'invoice',
      'payment',
      'subscription',
      'benefit',
      'salary',
      'advance',
      'holiday',
    ]);
  });

  it('guarda só o que difere do padrão', () => {
    let settings = withBuiltin({}, 'invoice', { color: 'red' });
    expect(settings.builtins).toEqual({ invoice: { color: 'red' } });
    settings = withBuiltin(settings, 'invoice', { color: 'violet' });
    expect(settings.builtins).toEqual({});
  });

  it('lembretes próprios entram depois dos tipos prontos', () => {
    const items = calendarItems({
      custom: [
        {
          id: 'a',
          label: 'Aluguel',
          icon: 'house',
          color: 'orange',
          day: 5,
          businessBefore: false,
        },
      ],
    });
    expect([...items.keys()].at(-1)).toBe('custom:a');
  });

  it('esconder salário ou adiantamento desliga a previsão', () => {
    const schedule = incomeSchedule(
      withBuiltin({ advanceDay: 20, salaryDay: 'last' }, 'salary', {
        hidden: true,
      }),
    );
    expect(schedule).toEqual({
      salary: { enabled: false, day: 'last' },
      advance: { enabled: true, day: 20 },
    });
  });
});
