export const INACTIVITY_MS = 5 * 60_000;
export function createResumeGate() {
  let away: number | null = null;
  return {
    leave(now: number) {
      if (away === null) away = now;
    },
    resume(now: number) {
      const refresh = away !== null && now - away >= INACTIVITY_MS;
      away = null;
      return refresh;
    },
  };
}
