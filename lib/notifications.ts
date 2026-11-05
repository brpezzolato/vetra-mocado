import {
  Landmark,
  PiggyBank,
  ReceiptText,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

/* O que o sininho (components/notification-center.tsx) e a central
   (app/notificacoes) compartilham. */

export type Notice = {
  id: string;
  kind: 'expense' | 'earning' | 'integration';
  title: string;
  body: string;
  href: string;
  /** De onde veio (`financial_entries:<id>`, `pluggy-cron:…`). */
  event_key?: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
};

/** Para onde a notificação pode levar (a mesma lista da regra do banco). */
export const NOTICE_DESTINATIONS = new Set([
  '/',
  '/financeiro',
  '/cofrinhos',
  '/configuracoes',
  '/conexoes',
  '/faturas',
]);

/** Para onde o toque leva: a compra abre o detalhe dela em Lançamentos; o
    resto vai à tela do aviso. `null` = não abre nada. Vale para o sininho,
    a central e o aviso no celular (app/api/push/dispatch). */
export function noticeTarget(
  notice: Pick<Notice, 'href' | 'event_key'>,
): string | null {
  const entry = /^financial_entries:([0-9a-f-]{36})$/.exec(
    notice.event_key ?? '',
  );
  if (entry) return `/financeiro?lancamento=${entry[1]}`;
  return NOTICE_DESTINATIONS.has(notice.href) ? notice.href : null;
}

export function noticeIcon(notice: Pick<Notice, 'kind' | 'href'>): LucideIcon {
  if (notice.kind === 'expense') return ReceiptText;
  if (notice.kind === 'earning') return PiggyBank;
  // Avisos dos bancos: rodada concluída (tela inicial) e conexão (Conexões).
  if (notice.href === '/conexoes' || notice.href === '/') return Landmark;
  return TriangleAlert;
}

const day = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'America/Sao_Paulo',
});
const time = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** "15 de set., 10:19". */
export function noticeWhen(iso: string) {
  const date = new Date(iso);
  return `${day.format(date)}, ${time.format(date)}`;
}
