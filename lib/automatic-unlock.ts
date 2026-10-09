// Attempt once per lock-screen mount, and never while the app is hidden.
// Deferring also allows React Strict Mode to clean up its first effect run.
export function scheduleAutomaticUnlock(
  start: () => void,
  page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
) {
  let attempted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = () => {
    if (attempted || page.visibilityState !== 'visible') return;
    attempted = true;
    start();
  };
  const visible = () => {
    clearTimeout(timer);
    timer = setTimeout(attempt, 0);
  };
  page.addEventListener('visibilitychange', visible);
  visible();
  return () => {
    clearTimeout(timer);
    page.removeEventListener('visibilitychange', visible);
  };
}
