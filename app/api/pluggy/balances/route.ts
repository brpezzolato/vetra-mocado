import { NextResponse } from 'next/server';
import { securityAdmin } from '@/lib/supabase/admin';
import { securitySession } from '@/lib/security-server';
import { errorResponse } from '@/lib/http-security';
import { pluggyFromEnv } from '@/lib/pluggy/client';
import { loadAccountsAndLimits } from '@/lib/pluggy/account-balances';
import { loadFlashWalletBalances } from '@/lib/flash-balances-query';
import { loadSafeToSpendInputs } from '@/lib/safe-to-spend-query';
import { DEMO_MODE } from '@/lib/demo/demo-client';
import { DEMO_ACCOUNTS, DEMO_CARD_LIMITS } from '@/lib/demo/demo-data';

// Saldos das contas correntes do usuário, direto da Pluggy. Lido na hora e
// não guardado.

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    const { user } = await securitySession();
    const pluggy = pluggyFromEnv();
    // Os limites dos cartões vêm da mesma leitura, para a barra "quanto
    // ainda dá para gastar" logo abaixo dos saldos.
    const admin = securityAdmin();
    const [{ accounts, cards }, { data: excluded }, benefits, plan] =
      await Promise.all([
        DEMO_MODE
          ? { accounts: [...DEMO_ACCOUNTS], cards: DEMO_CARD_LIMITS }
          : pluggy
            ? loadAccountsAndLimits(admin, pluggy, user.id)
            : { accounts: [], cards: [] },
        // O que ele tirou da conta da barra (spending_room_exclusions).
        admin
          .from('spending_room_exclusions')
          .select('kind, key')
          .eq('user_id', user.id),
        // Os saldos da Flash (por carteira) também entram na barra.
        loadFlashWalletBalances(admin, user.id).catch(() => []),
        // "Posso gastar hoje?": as faturas a pagar, as assinaturas e o dia do
        // salário (lib/safe-to-spend-query.ts).
        loadSafeToSpendInputs(admin, user.id).catch(() => null),
      ]);
    return NextResponse.json(
      { accounts, cards, benefits, excluded: excluded ?? [], plan },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
