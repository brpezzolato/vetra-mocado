import VetraDashboard from '@/components/vetra-dashboard';
export default async function VaultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VetraDashboard bankId={id} />;
}
