'use client';

import { createClient } from '@/lib/supabase/client';
import { DEMO_USER_ID } from './demo-data';

/* Vetra AI do protótipo: imita /api/finance/chat no próprio navegador. As
   conversas ficam na memória da aba (cada visitante tem as suas) e as
   respostas saem dos lançamentos fictícios, sem IA nenhuma. */

type Row = Record<string, unknown>;
type Entry = {
  entry_type: string;
  amount: number | string;
  category: string | null;
  description: string;
  account: string;
  occurred_at: string;
  installment_number?: number | null;
};

const THINKING_MS = 1400;
const db = () => createClient();

const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const saoDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(iso),
  );
const json = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const conversationFields = (row: Row) => ({
  id: row.id,
  title: row.title,
  status: row.status,
  last_error: row.last_error ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

async function conversations() {
  const { data } = await db()
    .from('financial_chat_conversations')
    .select('*')
    .order('updated_at', { ascending: false });
  return ((data ?? []) as Row[]).map(conversationFields);
}

async function history(conversationId: string) {
  const { data } = await db()
    .from('financial_chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
  }));
}

async function createConversation(title = 'Nova conversa') {
  const now = new Date().toISOString();
  const { data } = await db()
    .from('financial_chat_conversations')
    .insert({
      id: crypto.randomUUID(),
      user_id: DEMO_USER_ID,
      title,
      status: 'idle',
      last_error: null,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  return conversationFields(data as Row);
}

const CATEGORIES = [
  ['alimenta', 'Alimentação'],
  ['comida', 'Alimentação'],
  ['mercado', 'Alimentação'],
  ['transporte', 'Transporte'],
  ['uber', 'Transporte'],
  ['compra', 'Compras'],
  ['saúde', 'Saúde'],
  ['saude', 'Saúde'],
  ['farm', 'Saúde'],
  ['lazer', 'Lazer'],
  ['assinatura', 'Assinaturas'],
  ['serviço', 'Serviços'],
] as const;

const followUps = (items: string[]) =>
  `\n\n<!-- VETRA_SUGESTOES: ${items.join(' | ')} -->`;

/** Resposta montada a partir dos lançamentos fictícios. */
async function answer(question: string) {
  const { data } = await db().from('financial_entries').select('*');
  const today = saoDay(new Date().toISOString());
  const month = today.slice(0, 7);
  const expenses = ((data ?? []) as Entry[]).filter(
    (entry) =>
      entry.entry_type === 'expense' && saoDay(entry.occurred_at) <= today,
  );
  const inMonth = expenses.filter(
    (entry) => saoDay(entry.occurred_at).slice(0, 7) === month,
  );
  const total = (list: Entry[]) =>
    list.reduce((sum, entry) => sum + Number(entry.amount), 0);
  const byKey = (list: Entry[], key: (entry: Entry) => string) => {
    const map = new Map<string, number>();
    for (const entry of list)
      map.set(key(entry), (map.get(key(entry)) ?? 0) + Number(entry.amount));
    return [...map].sort((a, b) => b[1] - a[1]);
  };
  const text = question.toLocaleLowerCase('pt-BR');
  const monthName = new Date(`${today}T12:00:00`).toLocaleDateString('pt-BR', {
    month: 'long',
  });

  if (text.includes('hoje')) {
    const list = expenses.filter(
      (entry) => saoDay(entry.occurred_at) === today,
    );
    if (!list.length)
      return `Hoje ainda não há gastos registrados. Bom dia para manter a sequência no azul!${followUps(['Quanto gastei esta semana?', 'Qual categoria mais pesa no mês?', 'Como estão meus cofrinhos?'])}`;
    const lines = list
      .map(
        (entry) =>
          `- **${entry.description}** · ${brl(Number(entry.amount))} (${entry.account})`,
      )
      .join('\n');
    return `Hoje você gastou **${brl(total(list))}** em ${list.length} ${list.length === 1 ? 'compra' : 'compras'}:\n\n${lines}${followUps(['Quanto ainda posso gastar hoje?', 'Quanto gastei esta semana?', 'Onde mais gastei no mês?'])}`;
  }

  if (text.includes('semana')) {
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const from = start.toISOString().slice(0, 10);
    const list = expenses.filter((entry) => saoDay(entry.occurred_at) >= from);
    const [top] = byKey(list, (entry) => entry.category ?? 'Outros');
    return `Nesta semana (desde domingo) foram **${brl(total(list))}** em ${list.length} lançamentos.${top ? ` A maior categoria é **${top[0]}**, com ${brl(top[1])}.` : ''}${followUps(['Quanto gastei hoje?', 'Qual categoria mais pesa no mês?', 'Estou gastando mais que no mês passado?'])}`;
  }

  if (
    text.includes('fatura') ||
    text.includes('cartão') ||
    text.includes('cartao')
  ) {
    const cards = byKey(
      inMonth.filter((entry) => entry.account !== 'Pix'),
      (entry) => entry.account,
    );
    const lines = cards
      .map(([account, value]) => `- **${account}**: ${brl(value)}`)
      .join('\n');
    return `Em ${monthName}, as compras no cartão somam:\n\n${lines}\n\nOs valores a pagar e os vencimentos estão na tela de **Faturas**.${followUps(['Qual cartão mais usei?', 'Quanto gastei com transporte este mês?', 'Como estão meus cofrinhos?'])}`;
  }

  if (
    text.includes('cofrinho') ||
    text.includes('rend') ||
    text.includes('guard')
  ) {
    return `Seus cofrinhos somam **R$ 10.050,63**: a **Reserva** no Nubank (R$ 8.102,04, 115% do CDI) e a **Viagem** no Mercado Pago (R$ 1.948,59, 120% do CDI). Juntos já renderam **R$ 381,29** líquidos, e a previsão para os próximos 7 dias úteis é de cerca de **R$ 33,10**.${followUps(['Quanto rendeu este mês?', 'Quanto gastei este mês?', 'Dá para pedir delivery hoje?'])}`;
  }

  const category = CATEGORIES.find(([word]) => text.includes(word))?.[1];
  if (category) {
    const list = inMonth.filter((entry) => entry.category === category);
    const places = byKey(list, (entry) => entry.description).slice(0, 3);
    if (!list.length)
      return `Ainda não há gastos em **${category}** em ${monthName}.${followUps(['Onde mais gastei no mês?', 'Quanto gastei hoje?', 'Como estão meus cofrinhos?'])}`;
    return `Em ${monthName} você gastou **${brl(total(list))}** em ${category.toLowerCase()}, em ${list.length} lançamentos. Onde mais pesou: ${places.map(([name, value]) => `${name} (${brl(value)})`).join(', ')}.${followUps([`Quanto gastei com ${category === 'Transporte' ? 'alimentação' : 'transporte'} este mês?`, 'Qual categoria mais pesa no mês?', 'Quanto gastei hoje?'])}`;
  }

  const categories = byKey(inMonth, (entry) => entry.category ?? 'Outros');
  const days = Number(today.slice(8));
  const lines = categories
    .slice(0, 3)
    .map(([name, value]) => `- **${name}**: ${brl(value)}`)
    .join('\n');
  return `Até agora, em ${monthName}, você gastou **${brl(total(inMonth))}** em ${inMonth.length} lançamentos, uma média de ${brl(total(inMonth) / Math.max(1, days))} por dia.\n\nAs categorias que mais pesam:\n\n${lines}${followUps(['Quanto gastei hoje?', 'Quanto gastei esta semana?', 'Como estão meus cofrinhos?'])}`;
}

/** Substitui `fetch('/api/finance/chat…')` no protótipo. */
export async function demoChatFetch(url: string, init?: RequestInit) {
  const method = init?.method ?? 'GET';
  const conversationId = new URL(url, 'http://local').searchParams.get(
    'conversationId',
  );

  if (method === 'GET') {
    const list = await conversations();
    const active =
      list.find((item) => item.id === conversationId) ?? list[0] ?? null;
    return json({
      conversations: list,
      activeConversation: active,
      messages: active ? await history(String(active.id)) : [],
      dataPolicy: 'paid-no-training',
    });
  }

  if (method === 'PUT')
    return json({ conversation: await createConversation() }, 201);

  if (method === 'DELETE') {
    if (conversationId)
      await db()
        .from('financial_chat_conversations')
        .delete()
        .eq('id', conversationId);
    return json(null, 204);
  }

  const body = JSON.parse(String(init?.body ?? '{}')) as {
    message?: string;
    conversationId?: string;
  };
  const question = (body.message ?? '').trim().slice(0, 1000);
  if (!question) return json({ error: 'Envie uma pergunta.' }, 400);
  const conversation =
    (await conversations()).find((item) => item.id === body.conversationId) ??
    (await createConversation(question.slice(0, 72)));
  const now = new Date().toISOString();
  const { data: message } = await db()
    .from('financial_chat_messages')
    .insert({
      id: crypto.randomUUID(),
      user_id: DEMO_USER_ID,
      conversation_id: conversation.id,
      role: 'user',
      content: question,
      created_at: now,
    })
    .select('*')
    .single();
  const title =
    conversation.title === 'Nova conversa'
      ? question.slice(0, 72)
      : conversation.title;
  await db()
    .from('financial_chat_conversations')
    .update({ status: 'processing', title, updated_at: now })
    .eq('id', conversation.id);
  window.setTimeout(async () => {
    const content = await answer(question);
    const at = new Date().toISOString();
    await db().from('financial_chat_messages').insert({
      id: crypto.randomUUID(),
      user_id: DEMO_USER_ID,
      conversation_id: conversation.id,
      role: 'assistant',
      content,
      created_at: at,
    });
    await db()
      .from('financial_chat_conversations')
      .update({ status: 'idle', updated_at: at })
      .eq('id', conversation.id);
  }, THINKING_MS);
  const row = message as Row;
  return json({
    conversation: {
      ...conversation,
      title,
      status: 'processing',
      updated_at: now,
    },
    message: {
      id: row.id,
      role: 'user',
      content: question,
      created_at: row.created_at,
    },
  });
}
