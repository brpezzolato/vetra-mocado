import { NextResponse, type NextRequest } from 'next/server';
import { securityAdmin } from '@/lib/supabase/admin';
import { securitySession } from '@/lib/security-server';
import { errorResponse, HttpError } from '@/lib/http-security';
import { pluggyFromEnv } from '@/lib/pluggy/client';
import {
  BANK_KEYS,
  loadBankDetail,
  type BankKey,
} from '@/lib/pluggy/bank-detail';
import { DEMO_MODE } from '@/lib/demo/demo-client';
import { demoBankDetail } from '@/lib/demo/demo-data';

// A página de um banco (/bancos/[banco]): saldo, extrato, cartão e
// cofrinhos daquela conexão, lidos na hora da Pluggy (lib/pluggy/
// bank-detail.ts). `?days=` escolhe o período do extrato (até 90).

export const runtime = 'nodejs';
export const maxDuration = 30;

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bank: string }> },
) {
  try {
    const { user } = await securitySession();
    const { bank } = await params;
    if (!BANK_KEYS.includes(bank as BankKey))
      throw new HttpError(404, 'Banco desconhecido.');
    const asked = Number(request.nextUrl.searchParams.get('days'));
    const days = [30, 60, 90].includes(asked) ? asked : 30;
    if (DEMO_MODE) {
      const detail = demoBankDetail(bank, days);
      if (!detail) throw new HttpError(404, 'Conta não encontrada.');
      return NextResponse.json({ detail }, { headers: noStore });
    }
    const pluggy = pluggyFromEnv();
    if (!pluggy) throw new HttpError(503, 'Pluggy não configurada.');
    const detail = await loadBankDetail(
      securityAdmin(),
      pluggy,
      user.id,
      bank as BankKey,
      days,
    );
    if (!detail) throw new HttpError(404, 'Conta não encontrada.');
    return NextResponse.json({ detail }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
