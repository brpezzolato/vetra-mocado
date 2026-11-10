import {
  CalendarDays,
  CreditCard,
  Home,
  PiggyBank,
  ReceiptText,
  type LucideIcon,
} from 'lucide-react';

/** As seções da barra de abas do celular. */
export type AppSection = { href: string; label: string; icon: LucideIcon };

export const TAB_SECTIONS: AppSection[] = [
  { href: '/', label: 'Início', icon: Home },
  { href: '/financeiro', label: 'Gastos', icon: ReceiptText },
  { href: '/faturas', label: 'Faturas', icon: CreditCard },
  { href: '/cofrinhos', label: 'Cofrinhos', icon: PiggyBank },
  { href: '/resumo', label: 'Resumo', icon: CalendarDays },
];

/** A seção da página atual: a home só no "/", as outras pelo prefixo. */
export function isActiveSection(pathname: string, href: string) {
  return href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(`${href}/`);
}
