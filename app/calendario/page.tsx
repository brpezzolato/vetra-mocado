import { redirect } from 'next/navigation';

// O calendário faz parte do Resumo; o endereço antigo redireciona.
export default function CalendarPage() {
  redirect('/resumo');
}
