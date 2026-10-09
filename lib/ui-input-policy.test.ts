import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { displayDateToIso, maskDate, maskTime } from './date-time-input';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.name.endsWith('.tsx')
        ? [path]
        : [];
  });
}

describe('date and time input policy', () => {
  it('masks and validates Brazilian dates', () => {
    expect(maskDate('11092026')).toBe('11/09/2026');
    expect(displayDateToIso('11/09/2026')).toBe('2026-09-11');
    expect(displayDateToIso('31/02/2026')).toBeNull();
  });

  it('masks time without using the native picker', () => {
    expect(maskTime('2053')).toBe('20:53');
    expect(maskTime('953')).toBe('09:53');
  });

  it('does not allow native date or time inputs in app UI', () => {
    const violations = ['app', 'components']
      .flatMap(sourceFiles)
      .filter((path) =>
        /type=["'](?:date|time|datetime-local)["']/.test(
          readFileSync(path, 'utf8'),
        ),
      );
    expect(violations).toEqual([]);
  });
});
