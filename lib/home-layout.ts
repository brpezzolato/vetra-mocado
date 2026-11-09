'use client';

import { useSyncExternalStore } from 'react';

/* Teste dos arranjos da home (components/home-arrangements.tsx). A escolha
   fica neste aparelho; `?home=3` na URL também escolhe. O 0 é a home atual. */

export const HOME_LAYOUTS = [
  'Atual',
  'Hoje no topo',
  'Um cartão, três visões',
  'Faixa de números',
  'Rolagem única',
  'Bancos primeiro',
  'Navegação embaixo',
  'Diário do dia',
  'Abas no comando',
  'Atalhos e avisos',
  'Widgets',
] as const;

const KEY = 'vetra:home-layout';
const EVENT = 'vetra:home-layout';

function clamp(value: number) {
  return Number.isInteger(value) && value >= 0 && value < HOME_LAYOUTS.length
    ? value
    : 0;
}

function read() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('home');
    if (fromUrl !== null) {
      const chosen = clamp(Number(fromUrl));
      localStorage.setItem(KEY, String(chosen));
      return chosen;
    }
    return clamp(Number(localStorage.getItem(KEY) ?? 0));
  } catch {
    return 0;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function setHomeLayout(value: number) {
  const chosen = clamp(value);
  try {
    localStorage.setItem(KEY, String(chosen));
    // Tira o `?home=` para a URL não sobrepor a escolha nova.
    const url = new URL(window.location.href);
    if (url.searchParams.has('home')) {
      url.searchParams.delete('home');
      window.history.replaceState(window.history.state, '', url);
    }
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function useHomeLayout() {
  return useSyncExternalStore(subscribe, read, () => 0);
}
