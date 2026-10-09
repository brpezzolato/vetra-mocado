import { notFound } from 'next/navigation';
import { BankDetailScreen } from '@/components/bank-detail';
import { BANK_KEYS, type BankKey } from '@/lib/pluggy/bank-detail';

// A página de um banco, aberta pelos saldos da home (sem item no menu).
export default async function BankPage({
  params,
}: {
  params: Promise<{ bank: string }>;
}) {
  const { bank } = await params;
  if (!BANK_KEYS.includes(bank as BankKey)) notFound();
  return <BankDetailScreen bank={bank as BankKey} />;
}
