import { redirect } from 'next/navigation';
import { AssistantScreen } from '@/components/assistant-screen';
import { createClient } from '@/lib/supabase/server';

export default async function AssistantPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  return <AssistantScreen />;
}
