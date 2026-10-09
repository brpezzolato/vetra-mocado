'use client';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AppLoading } from '@/components/app-loading';
import { useDelayedLoading } from '@/lib/use-delayed-loading';
import {
  subscribeLoading,
  loadingSnapshot,
  serverLoadingSnapshot,
} from '@/lib/loading-activity';

export function LoadingActivity() {
  const pending = useSyncExternalStore(
    subscribeLoading,
    loadingSnapshot,
    serverLoadingSnapshot,
  );
  const visible = useDelayedLoading(pending > 0);
  return visible ? createPortal(<AppLoading />, document.body) : null;
}
