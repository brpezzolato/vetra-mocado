// Shared only in the browser. Server requests never alter global UI state.
let pending = 0;
const listeners = new Set<() => void>();
export const subscribeLoading = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const loadingSnapshot = () => pending;
export const serverLoadingSnapshot = () => 0;
export async function withLoading<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return operation();
  pending++;
  listeners.forEach((l) => l());
  try {
    return await operation();
  } finally {
    pending--;
    listeners.forEach((l) => l());
  }
}
// Background reads and auth refreshes must not blank the current screen.
export const loadingFetch: typeof fetch = (input, init) => {
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  if (method === 'GET' || method === 'HEAD' || url.includes('/auth/v1/'))
    return fetch(input, init);
  return withLoading(() => fetch(input, init));
};
