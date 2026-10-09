'use client';
import { useEffect, useRef } from 'react';
import { createResumeGate } from './resume-refresh';
export function useResumeRefresh(refresh: () => void | Promise<unknown>) {
  const callback = useRef(refresh);
  useEffect(() => {
    callback.current = refresh;
  }, [refresh]);
  useEffect(() => {
    const gate = createResumeGate();
    let busy = false;
    const leave = () => gate.leave(Date.now());
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      if (gate.resume(Date.now()) && !busy) {
        busy = true;
        void Promise.resolve()
          .then(() => callback.current())
          .catch(() => {})
          .finally(() => {
            busy = false;
          });
      }
    };
    const visibility = () =>
      document.visibilityState === 'hidden' ? leave() : resume();
    window.addEventListener('blur', leave);
    window.addEventListener('pagehide', leave);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', leave);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
}
