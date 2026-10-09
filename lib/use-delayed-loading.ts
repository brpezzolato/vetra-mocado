'use client';
import { useEffect, useState } from 'react';
export function useDelayedLoading(pending: boolean) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setVisible(pending),
      pending ? 350 : 150,
    );
    return () => window.clearTimeout(timer);
  }, [pending]);
  return visible;
}
