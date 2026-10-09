import type { SupabaseClient } from '@supabase/supabase-js';
import { provisionalSince } from './daily-allowance';
import { saoDate } from './expense-insights';
import {
  openingGap,
  unidentifiedSpend,
  type CardMovement,
  type CardPayment,
  type LimitSnapshot,
  type UnidentifiedSpend,
} from './unidentified-spend';

/**
 * Gasto sem compra na janela de 3 dias úteis. Com service role, passe
 * `userId`; com a sessão, o RLS filtra.
 */
export async function loadUnidentifiedSpend(
  client: SupabaseClient,
  userId?: string,
  today = saoDate(new Date()),
): Promise<UnidentifiedSpend[]> {
  type Filterable = { eq(column: string, value: string): Filterable };
  const scoped = <Query>(query: Query): Query =>
    userId
      ? ((query as unknown as Filterable).eq(
          'user_id',
          userId,
        ) as unknown as Query)
      : query;

  // Os dias da janela, e uma folga antes para achar a foto que abre o 1º.
  const first = provisionalSince(today);
  const days: string[] = [];
  const cursor = new Date(`${first}T12:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= today) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const from = new Date(Date.parse(`${first}T12:00:00Z`) - 5 * 86_400_000);

  const { data: links } = await scoped(
    client.from('pluggy_card_links').select('account').eq('kind', 'credit'),
  );
  const accounts = (links ?? []).map((row) => row.account as string);
  if (!accounts.length) return [];

  const [
    { data: snapshots },
    { data: movements },
    { data: bills },
    { data: events },
  ] = await Promise.all([
    scoped(
      client
        .from('card_limit_snapshots')
        .select('account, taken_at, data_at, credit_limit, available')
        .in('account', accounts)
        .gte('taken_at', from.toISOString()),
    ),
    scoped(
      client
        .from('financial_entries')
        .select(
          'account, occurred_at, amount, entry_type, installment_number, installment_purchase_total',
        )
        .in('account', accounts)
        .gte('occurred_at', from.toISOString()),
    ),
    scoped(
      client
        .from('card_bills')
        .select('account, payments')
        .in('account', accounts)
        .gte('due_date', from.toISOString().slice(0, 10)),
    ),
    // Pagamentos vistos na lista do cartão antes da fatura (card_payment_events).
    scoped(
      client
        .from('card_payment_events')
        .select('account, paid_on, amount')
        .in('account', accounts)
        .gte('paid_on', from.toISOString().slice(0, 10)),
    ),
  ]);

  const fromBills: CardPayment[] = (bills ?? []).flatMap((bill) =>
    ((bill.payments ?? []) as { date: string; amount: number }[]).map(
      (payment) => ({
        account: bill.account as string,
        date: payment.date,
        amount: payment.amount,
      }),
    ),
  );
  // Pagamento repetido (duas fontes, ou pendente e lançado) conta uma vez por
  // cartão, dia e valor.
  const seenPayment = new Set(
    fromBills.map(
      (p) => `${p.account}|${p.date}|${Number(p.amount).toFixed(2)}`,
    ),
  );
  const payments: CardPayment[] = [
    ...fromBills,
    ...(events ?? [])
      .map((event) => ({
        account: event.account as string,
        date: event.paid_on as string,
        amount: event.amount as number,
      }))
      .filter((p) => {
        const key = `${p.account}|${p.date}|${Number(p.amount).toFixed(2)}`;
        if (seenPayment.has(key)) return false;
        seenPayment.add(key);
        return true;
      }),
  ];
  const result = unidentifiedSpend({
    days,
    snapshots: (snapshots ?? []) as LimitSnapshot[],
    movements: (movements ?? []) as CardMovement[],
    payments,
  });

  // Cartão novo cuja primeira foto cai na janela: gasto anterior a ela
  // (`openingGap`), com todas as compras do cartão.
  const withBills = new Set((bills ?? []).map((bill) => bill.account));
  const { data: anyBill } = await scoped(
    client.from('card_bills').select('account').in('account', accounts),
  );
  for (const bill of anyBill ?? []) withBills.add(bill.account as string);
  for (const account of accounts) {
    if (withBills.has(account)) continue;
    const { data: firstRows } = await scoped(
      client
        .from('card_limit_snapshots')
        .select('account, taken_at, data_at, credit_limit, available')
        .eq('account', account)
        .order('taken_at', { ascending: true })
        .limit(1),
    );
    const first = (firstRows ?? [])[0] as LimitSnapshot | undefined;
    if (!first || !days.includes(saoDate(first.data_at ?? first.taken_at)))
      continue;
    const { data: all } = await scoped(
      client
        .from('financial_entries')
        .select(
          'account, occurred_at, amount, entry_type, installment_number, installment_purchase_total',
        )
        .eq('account', account),
    );
    const gap = openingGap(first, (all ?? []) as CardMovement[]);
    if (!gap) continue;
    // A véspera já fora da janela: fica no dia da primeira foto.
    if (!days.includes(gap.day)) {
      gap.day = saoDate(first.data_at ?? first.taken_at);
      gap.at = first.data_at ?? first.taken_at;
    }
    const same = result.find(
      (item) => item.account === gap.account && item.day === gap.day,
    );
    if (same)
      same.amount = (Number(same.amount) + Number(gap.amount)).toFixed(2);
    else result.push(gap);
  }
  return result;
}
