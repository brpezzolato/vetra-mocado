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
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
};

/** Para onde a notificação pode levar (a mesma lista da regra do banco). */
export const NOTICE_DESTINATIONS = new Set([
  '/financeiro',
  '/cofrinhos',
  '/configuracoes',
  '/conexoes',
]);

export function noticeIcon(notice: Pick<Notice, 'kind' | 'href'>): LucideIcon {
  if (notice.kind === 'expense') return ReceiptText;
  if (notice.kind === 'earning') return PiggyBank;
  // Avisos dos bancos (cron, conexão) levam a Conexões.
  if (notice.href === '/conexoes') return Landmark;
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
