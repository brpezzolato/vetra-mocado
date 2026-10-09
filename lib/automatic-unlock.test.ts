import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleAutomaticUnlock } from './automatic-unlock';

class Page extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}
afterEach(() => vi.useRealTimers());
describe('automatic passkey prompt', () => {
  it('starts without a click and does not repeat after system UI visibility events', () => {
    vi.useFakeTimers();
    const page = new Page();
    const start = vi.fn();
    const stop = scheduleAutomaticUnlock(start, page);
    vi.runAllTimers();
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
    stop();
  });
  it('waits for foreground and cancels on unmount', () => {
    vi.useFakeTimers();
    const page = new Page();
    page.visibilityState = 'hidden';
    const start = vi.fn();
    const stop = scheduleAutomaticUnlock(start, page);
    vi.runAllTimers();
    expect(start).not.toHaveBeenCalled();
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    stop();
    vi.runAllTimers();
    expect(start).not.toHaveBeenCalled();
  });
  it('does not duplicate the prompt during strict-mode effect setup/cleanup', () => {
    vi.useFakeTimers();
    const page = new Page();
    const start = vi.fn();
    scheduleAutomaticUnlock(start, page)();
    const stop = scheduleAutomaticUnlock(start, page);
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
    stop();
  });
});
