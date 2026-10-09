import { describe, expect, it } from 'vitest';
import { createResumeGate, INACTIVITY_MS } from './resume-refresh';
describe('resume refresh', () => {
  it('does not refresh on initial focus', () =>
    expect(createResumeGate().resume(10000000)).toBe(false));
  it('ignores quick app switching', () => {
    const g = createResumeGate();
    g.leave(0);
    expect(g.resume(30000)).toBe(false);
  });
  it('refreshes once after five minutes', () => {
    const g = createResumeGate();
    g.leave(0);
    expect(g.resume(INACTIVITY_MS)).toBe(true);
    expect(g.resume(INACTIVITY_MS + 1)).toBe(false);
  });
  it('does not reset the start on duplicate blur/pagehide', () => {
    const g = createResumeGate();
    g.leave(0);
    g.leave(250000);
    expect(g.resume(INACTIVITY_MS)).toBe(true);
  });
  it('rearms only after a new inactivity period', () => {
    const g = createResumeGate();
    g.leave(0);
    g.resume(INACTIVITY_MS);
    g.leave(INACTIVITY_MS + 1);
    expect(g.resume(INACTIVITY_MS + 20)).toBe(false);
  });
});
