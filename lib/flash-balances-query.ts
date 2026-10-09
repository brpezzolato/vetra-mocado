import type { SupabaseClient } from '@supabase/supabase-js';
import {
  benefitBalanceView,
  FLASH_WALLETS,
  latestBenefitBalance,
  walletEntries,
  type BenefitCardBalance,
} from './benefit-cards';
import { FLASH_ACCOUNT } from './flash-statement';
import type { FinancialEntry } from './financial-tracker';

export type FlashWalletBalance = {
  /** `alimentacao` ou `transporte` (FLASH_WALLETS). */
  key: string;
  label: string;
  balance: number;
};

/**
 * Saldo atual de cada carteira da Flash (`benefitBalanceView`), para a barra
 * da home. Carteira sem leitura fica de fora.
 */
export async function loadFlashWalletBalances(
  admin: SupabaseClient,
  userId: string,
): Promise<FlashWalletBalance[]> {
  const { data: readings } = await admin
    .from('benefit_card_balances')
    .select('account, balance, measured_at')
    .eq('user_id', userId)
    .in(
      'account',
      FLASH_WALLETS.map((wallet) => wallet.account),
    );
  const balances = (readings ?? []) as BenefitCardBalance[];
  const latest = FLASH_WALLETS.map((wallet) => ({
    wallet,
    snapshot: latestBenefitBalance(balances, wallet.account),
  })).filter((item) => item.snapshot);
  if (!latest.length) return [];

  // Só o que veio depois da leitura mais antiga das que valem: o resto não
  // mexe em saldo nenhum.
  const since = latest.map((item) => item.snapshot!.measured_at).sort()[0];
  const { data: rows } = await admin
    .from('financial_entries')
    .select('entry_type, amount, category, occurred_at')
    .eq('user_id', userId)
    .eq('account', FLASH_ACCOUNT)
    .gte('occurred_at', `${since}T00:00:00-03:00`);
  const entries = (rows ?? []) as FinancialEntry[];

  return latest.flatMap(({ wallet, snapshot }) => {
    const view = benefitBalanceView(snapshot, walletEntries(wallet, entries));
    return view
      ? [
          {
            key: wallet.key,
            label: wallet.label,
            balance: Number(view.current),
          },
        ]
      : [];
  });
}
