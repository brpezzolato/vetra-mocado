// Cofrinhos vêm do banco. A cada sincronização, por conexão ligada:
// - saldo do dia em `balance_snapshots` (conciliação manual do dia vence);
// - aportes e retiradas em `transactions`, com `external_id`;
// - cofrinho novo no banco vira cofrinho, com as regras do irmão mais recente;
// - cofrinho que sumiu é arquivado, só com a conexão saudável.
// Só no servidor, com service role. Nunca loga corpo de resposta nem id.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PluggyClient } from './client';
import {
  activeLots,
  piggySnapshotFromLots,
  type PiggySnapshot,
} from './investments';
import type { PluggyInvestmentMovement, PluggyTransaction } from './types';
import {
  archiveStillCovers,
  calendarDay,
  lotMovements,
  planMovementWrites,
  explainBalance,
  reserveMovements,
  reserveSnapshot,
  saoPauloDay,
  type BankMovement,
  type ExistingMovement,
} from './vault-movements';

export const PLUGGY_SNAPSHOT_SOURCE = 'pluggy';
/** Janela do extrato para achar os movimentos de uma reserva nova. */
const RESERVE_LOOKBACK_DAYS = 120;

/** Quando cada banco atualizou: só nome e horários. */
export type BankFreshness = {
  bank: string;
  lastUpdatedAt: string | null;
  nextAutoSyncAt: string | null;
  status: string;
};

export type PiggySyncResult = {
  linked: number;
  saved: number;
  /** A conciliação manual do mesmo dia vence. */
  keptManual: number;
  /** Sem saldo confiável nesta rodada. */
  skipped: number;
  created: number;
  archived: number;
  movements: number;
  errors: number;
  banks: BankFreshness[];
};

type LinkedBank = {
  id: string;
  user_id: string;
  bank: string;
  name: string;
  product: string;
  cdi_percentage: number | string;
  tax_rule: string;
  iof_rule: string;
  accrues_on_deposit_day: boolean;
  rate_limit: number | string | null;
  excess_rate: number | string;
  policy_version: string;
  archived_at: string | null;
  created_at: string;
  pluggy_item_id: string;
  pluggy_source: 'investments' | 'reserved_balance' | null;
  pluggy_reserve_key: string | null;
  /** Nubank: taxa (% do CDI) dos lotes; único campo que separa caixinhas. */
  pluggy_lot_rate: number | string | null;
  pluggy_import_from: string | null;
};

const LINKED_COLUMNS =
  'id, user_id, bank, name, product, cdi_percentage, tax_rule, iof_rule, accrues_on_deposit_day, rate_limit, excess_rate, policy_version, archived_at, created_at, pluggy_item_id, pluggy_source, pluggy_reserve_key, pluggy_lot_rate, pluggy_import_from';

class Sync {
  readonly result: PiggySyncResult = {
    linked: 0,
    saved: 0,
    keptManual: 0,
    skipped: 0,
    created: 0,
    archived: 0,
    movements: 0,
    errors: 0,
    banks: [],
  };
  private readonly admin: SupabaseClient;
  private readonly pluggy: PluggyClient;
  private readonly today = saoPauloDay(new Date().toISOString());

  constructor(admin: SupabaseClient, pluggy: PluggyClient) {
    this.admin = admin;
    this.pluggy = pluggy;
  }

  async run(userId?: string) {
    let query = this.admin
      .from('piggy_banks')
      .select(LINKED_COLUMNS)
      .not('pluggy_item_id', 'is', null);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw new Error('Não foi possível ler os cofrinhos.');
    const banks = (data ?? []) as LinkedBank[];
    this.result.linked = banks.filter((bank) => !bank.archived_at).length;

    const groups = new Map<string, LinkedBank[]>();
    for (const bank of banks) {
      const key = `${bank.user_id}|${bank.pluggy_item_id}|${bank.pluggy_source ?? 'investments'}`;
      groups.set(key, [...(groups.get(key) ?? []), bank]);
    }
    for (const group of groups.values()) {
      try {
        if (group[0].pluggy_source === 'reserved_balance')
          await this.syncReserves(group);
        else await this.syncInvestments(group);
      } catch {
        // Uma conexão com erro não impede as outras; o motivo não é repassado.
        this.result.errors++;
      }
    }
    return this.result;
  }

  private async healthy(itemId: string, bank: string) {
    const item = await this.pluggy.getItem(itemId);
    this.result.banks.push({
      bank,
      lastUpdatedAt: item.lastUpdatedAt,
      nextAutoSyncAt: item.nextAutoSyncAt,
      status: item.status,
    });
    return { item, healthy: item.status === 'UPDATED' };
  }

  /**
   * Nubank: um cofrinho por taxa (a Pluggy não diz a caixinha de cada lote;
   * Turbo 115%, comum 100%). Mesma taxa soma junto.
   */
  private async syncInvestments(group: LinkedBank[]) {
    const itemId = group[0].pluggy_item_id;
    const { healthy } = await this.healthy(itemId, group[0].bank);
    const lots = await this.pluggy.listInvestments(itemId);
    const rateOf = (value: number | string | null) =>
      value === null ? null : Number(value);
    const rates = new Set(
      activeLots(lots)
        .map((lot) => lot.rate)
        .filter((rate): rate is number => rate !== null),
    );

    // Taxa sem lote ativo: esvaziada ou excluída. Lista vazia é dúvida.
    for (const bank of group) {
      const rate = rateOf(bank.pluggy_lot_rate);
      if (bank.archived_at || rate === null || rates.has(rate)) continue;
      if (healthy && lots.length) await this.archive(bank);
      else this.result.skipped++;
    }

    for (const rate of [...rates].sort((a, b) => b - a)) {
      const ofRate = lots.filter((lot) => lot.rate === rate);
      const opened = activeLots(ofRate)
        .map((lot) => (lot.purchaseDate ? calendarDay(lot.purchaseDate) : ''))
        .filter(Boolean)
        .sort();
      const live =
        group.find(
          (bank) => !bank.archived_at && rateOf(bank.pluggy_lot_rate) === rate,
        ) ?? null;
      if (
        !live &&
        group.some(
          (bank) =>
            bank.archived_at &&
            rateOf(bank.pluggy_lot_rate) === rate &&
            archiveStillCovers(bank.archived_at, opened),
        )
      ) {
        this.result.skipped++;
        continue;
      }
      const bank =
        live ??
        (healthy
          ? await this.create(latest(group), {
              ...caixinhaFor(latest(group), rate),
              lotRate: rate,
              importFrom: opened[0] ?? this.today,
            })
          : null);
      if (!bank) {
        this.result.skipped++;
        continue;
      }

      await this.saveSnapshot(bank, piggySnapshotFromLots(ofRate));

      const importFrom = bank.pluggy_import_from;
      const relevant = ofRate.filter((lot) => {
        const day = lot.purchaseDate ? calendarDay(lot.purchaseDate) : null;
        return day !== null && (!importFrom || day >= importFrom);
      });
      const movementsByLot = new Map<string, PluggyInvestmentMovement[]>();
      for (const lot of relevant)
        movementsByLot.set(
          lot.id,
          await this.pluggy.listInvestmentMovements(lot.id),
        );
      await this.applyMovements(
        bank,
        lotMovements(relevant, movementsByLot, importFrom),
      );
    }
  }

  /** Mercado Pago: um cofrinho por saldo reservado da conta. */
  private async syncReserves(group: LinkedBank[]) {
    const itemId = group[0].pluggy_item_id;
    const { item, healthy } = await this.healthy(itemId, group[0].bank);
    const reserves = await this.pluggy.listReserves(itemId);
    if (!reserves) {
      this.result.skipped++;
      return;
    }

    const keys = new Set(reserves.map((reserve) => reserve.key));
    if (healthy)
      for (const bank of group)
        if (
          !bank.archived_at &&
          bank.pluggy_reserve_key &&
          !keys.has(bank.pluggy_reserve_key)
        )
          await this.archive(bank);

    const transactionsByAccount = new Map<string, PluggyTransaction[]>();
    const lookback = new Date();
    lookback.setDate(lookback.getDate() - RESERVE_LOOKBACK_DAYS);
    const earliest = group
      .map((bank) => bank.pluggy_import_from)
      .filter((day): day is string => !!day)
      .sort()[0];
    const from =
      earliest && earliest < saoPauloDay(lookback.toISOString())
        ? earliest
        : saoPauloDay(lookback.toISOString());

    // O extrato só traz o nome da reserva, que se repete e muda. Então:
    // - o cofrinho é a reserva (chave do banco), nome sempre do banco;
    // - cofrinho novo só fica com os movimentos recentes que somam o saldo
    //   (`explainBalance`);
    // - um movimento pertence a um cofrinho só.
    const transactionsOf = async (accountId: string) => {
      if (!transactionsByAccount.has(accountId))
        transactionsByAccount.set(
          accountId,
          await this.pluggy.listTransactions(accountId, from, this.today),
        );
      return transactionsByAccount.get(accountId) ?? [];
    };
    const owners = new Map<string, string>();
    // Movimento mais antigo de cada cofrinho: nada anterior entra depois.
    const oldest = new Map<string, number>();
    {
      const { data, error } = await this.admin
        .from('transactions')
        .select('piggy_bank_id, external_id, occurred_at')
        .in(
          'piggy_bank_id',
          group.map((bank) => bank.id),
        )
        .not('external_id', 'is', null);
      if (error) throw error;
      for (const row of data ?? []) {
        owners.set(row.external_id as string, row.piggy_bank_id as string);
        const at = Date.parse(row.occurred_at as string);
        const vault = row.piggy_bank_id as string;
        if (!oldest.has(vault) || at < oldest.get(vault)!)
          oldest.set(vault, at);
      }
    }

    const plans: {
      bank: LinkedBank;
      movements: BankMovement[];
      fresh: boolean;
    }[] = [];
    const claimed = new Map<string, string>();
    for (const reserve of reserves) {
      const known = group.find(
        (bank) => bank.pluggy_reserve_key === reserve.key,
      );
      // Arquivado fica como está; o banco não desarquiva.
      if (known?.archived_at) continue;
      const matched = reserveMovements(
        await transactionsOf(reserve.accountId),
        reserve.name,
      );
      if (known) {
        if (known.name !== reserve.name) await this.rename(known, reserve.name);
        plans.push({ bank: known, movements: matched, fresh: false });
        continue;
      }
      if (!healthy) {
        this.result.skipped++;
        continue;
      }
      const bank = await this.create(latest(group), {
        name: reserve.name,
        reserveKey: reserve.key,
        importFrom: null,
      });
      const own = explainBalance(matched, reserve.amount);
      for (const movement of own) claimed.set(movement.externalId, bank.id);
      plans.push({ bank, movements: own, fresh: true });
    }

    // O que um cofrinho novo explicou deixa de ser de qualquer outro.
    for (const [externalId, bankId] of claimed) {
      const owner = owners.get(externalId);
      if (owner && owner !== bankId) {
        const { error } = await this.admin
          .from('transactions')
          .delete()
          .eq('piggy_bank_id', owner)
          .eq('external_id', externalId);
        if (error) throw error;
      }
      owners.set(externalId, bankId);
    }

    for (const { bank, movements, fresh } of plans) {
      const reserve = reserves.find(
        (entry) => entry.key === bank.pluggy_reserve_key,
      )!;
      await this.saveSnapshot(
        bank,
        reserveSnapshot(reserve, item.lastUpdatedAt),
      );
      await this.applyMovements(
        bank,
        movements.filter((movement) => {
          const owner =
            claimed.get(movement.externalId) ?? owners.get(movement.externalId);
          if (owner && owner !== bank.id) return false;
          const floor = oldest.get(bank.id);
          return (
            fresh ||
            owner === bank.id ||
            floor === undefined ||
            Date.parse(movement.occurredAt) >= floor
          );
        }),
      );
    }
  }

  private async rename(bank: LinkedBank, name: string) {
    const { error } = await this.admin
      .from('piggy_banks')
      .update({ name: name.slice(0, 80) })
      .eq('id', bank.id);
    if (error) throw error;
    bank.name = name;
  }

  private async create(
    template: LinkedBank,
    options: {
      name: string;
      reserveKey?: string;
      lotRate?: number;
      importFrom: string | null;
      overrides?: Partial<
        Pick<
          LinkedBank,
          | 'product'
          | 'cdi_percentage'
          | 'rate_limit'
          | 'excess_rate'
          | 'policy_version'
        >
      >;
    },
  ): Promise<LinkedBank> {
    const { data, error } = await this.admin
      .from('piggy_banks')
      .insert({
        user_id: template.user_id,
        bank: template.bank,
        name: options.name,
        product: template.product,
        cdi_percentage: template.cdi_percentage,
        tax_rule: template.tax_rule,
        iof_rule: template.iof_rule,
        accrues_on_deposit_day: template.accrues_on_deposit_day,
        rate_limit: template.rate_limit,
        excess_rate: template.excess_rate,
        policy_version: template.policy_version,
        ...options.overrides,
        policy_started_at: this.today,
        pluggy_item_id: template.pluggy_item_id,
        pluggy_source: template.pluggy_source ?? 'investments',
        pluggy_reserve_key: options.reserveKey ?? null,
        pluggy_lot_rate: options.lotRate ?? null,
        pluggy_import_from: options.importFrom,
      })
      .select(LINKED_COLUMNS)
      .single();
    if (error || !data) throw new Error('Não foi possível criar o cofrinho.');
    this.result.created++;
    return data as LinkedBank;
  }

  private async archive(bank: LinkedBank) {
    const { error } = await this.admin
      .from('piggy_banks')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', bank.id);
    if (error) throw error;
    this.result.archived++;
  }

  private async saveSnapshot(bank: LinkedBank, snapshot: PiggySnapshot | null) {
    if (!snapshot) {
      this.result.skipped++;
      return;
    }
    const { data: existing, error: readError } = await this.admin
      .from('balance_snapshots')
      .select('source')
      .eq('piggy_bank_id', bank.id)
      .eq('snapshot_date', snapshot.snapshotDate)
      .maybeSingle();
    if (readError) throw readError;
    if (existing && existing.source !== PLUGGY_SNAPSHOT_SOURCE) {
      this.result.keptManual++;
      return;
    }
    const { error } = await this.admin.from('balance_snapshots').upsert(
      {
        user_id: bank.user_id,
        piggy_bank_id: bank.id,
        snapshot_date: snapshot.snapshotDate,
        gross_balance: snapshot.gross,
        net_balance: snapshot.net,
        iof: snapshot.iof,
        income_tax: snapshot.incomeTax,
        source: PLUGGY_SNAPSHOT_SOURCE,
      },
      { onConflict: 'piggy_bank_id,snapshot_date' },
    );
    if (error) throw error;
    this.result.saved++;
  }

  private async applyMovements(bank: LinkedBank, movements: BankMovement[]) {
    if (!movements.length) return;
    const { data, error } = await this.admin
      .from('transactions')
      .select('id, kind, amount, occurred_at, external_id')
      .eq('piggy_bank_id', bank.id);
    if (error) throw error;
    const plan = planMovementWrites(
      movements,
      (data ?? []) as ExistingMovement[],
      bank.pluggy_import_from,
    );
    for (const { id, externalId } of plan.adopt) {
      const { error: adoptError } = await this.admin
        .from('transactions')
        .update({ external_id: externalId })
        .eq('id', id);
      if (adoptError) throw adoptError;
    }
    if (plan.insert.length) {
      const { error: insertError } = await this.admin
        .from('transactions')
        .insert(
          plan.insert.map((movement) => ({
            user_id: bank.user_id,
            piggy_bank_id: bank.id,
            kind: movement.kind,
            amount: movement.amount,
            occurred_at: movement.occurredAt,
            note: 'Veio do banco',
            external_id: movement.externalId,
          })),
        );
      if (insertError) throw insertError;
      this.result.movements += plan.insert.length;
    }
  }
}

/**
 * Nome e regras de caixinha nova pela taxa: mesma taxa herda do modelo;
 * outra é caixinha sem teto promocional nem a convenção `NUB-TURBO-115`.
 */
function caixinhaFor(template: LinkedBank, rate: number) {
  if (Number(template.cdi_percentage) === rate) return { name: template.name };
  return {
    name: `Caixinha ${rate.toLocaleString('pt-BR')}% do CDI`,
    overrides: {
      product: 'Caixinha',
      cdi_percentage: rate,
      rate_limit: null,
      excess_rate: rate,
      policy_version: `NUB-CAIXINHA-${rate}`,
    },
  };
}

const latest = (group: LinkedBank[]) =>
  [...group].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

export function syncPiggyBanksFromPluggy(
  admin: SupabaseClient,
  pluggy: PluggyClient,
  userId?: string,
): Promise<PiggySyncResult> {
  return new Sync(admin, pluggy).run(userId);
}
