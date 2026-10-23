/* Dados inventados do modo demonstração (lib/demo/demo-client.ts): lojas
   comuns, valores com semente fixa e datas relativas a hoje. */

export const DEMO_USER_ID = '00000000-0000-4000-8000-0000000000de';

type Row = Record<string, unknown>;

/** Sorteio com semente: sempre a mesma sequência. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const saoToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const at = (day: string, time: string) => `${day}T${time}:00-03:00`;
const money = (value: number) => Math.round(value * 100) / 100;

let sequence = 0;
/** Um uuid válido e previsível; o prefixo só ajuda a ler. */
const id = (prefix: string) =>
  `${prefix.slice(0, 1)}0000000-0000-4000-8000-${(++sequence)
    .toString(16)
    .padStart(12, '0')}`;

/** Os cartões: conta, banco, ciclo e limite. */
const CARDS = [
  { account: 'Nubank', bank: 'nubank', closing: 1, due: 8, limit: 4800 },
  { account: 'Itaú', bank: 'itau', closing: 25, due: 2, limit: 3200 },
  {
    account: 'Mercado Pago',
    bank: 'mercado-pago',
    closing: 3,
    due: 10,
    limit: 2500,
  },
] as const;

/** As compras do dia a dia: loja, categoria, faixa de valor, cartão. */
const MERCHANTS: [string, string, number, number, string][] = [
  ['iFood', 'Alimentação', 28, 62, 'Nubank'],
  ['Padaria Pão Dourado', 'Alimentação', 9, 26, 'Pix'],
  ['Mercado Bom Preço', 'Alimentação', 45, 160, 'Itaú'],
  ['Café Central', 'Alimentação', 8, 19, 'Nubank'],
  ['Uber', 'Transporte', 14, 38, 'Nubank'],
  ['99', 'Transporte', 11, 29, 'Mercado Pago'],
  ['Posto Ipiranga', 'Transporte', 80, 150, 'Itaú'],
  ['Drogaria São Paulo', 'Saúde', 18, 75, 'Itaú'],
  ['Amazon', 'Compras', 39, 140, 'Mercado Pago'],
  ['Shopee', 'Compras', 22, 90, 'Mercado Pago'],
  ['Cinemark', 'Lazer', 32, 64, 'Nubank'],
  ['Barbearia do Zé', 'Serviços', 40, 55, 'Pix'],
];

const SUBSCRIPTIONS: [string, string, number, number][] = [
  ['Netflix', 'Nubank', 44.9, 12],
  ['Spotify', 'Nubank', 21.9, 18],
  ['Academia Fit', 'Itaú', 99.9, 5],
  ['iCloud+', 'Nubank', 4.9, 22],
];

export function demoTables(): Record<string, Row[]> {
  sequence = 0;
  const today = saoToday();
  const roll = random(20261008);
  const user_id = DEMO_USER_ID;
  const stamp = at(today, '08:00');
  const base = { user_id, created_at: stamp, updated_at: stamp };

  const entries: Row[] = [];
  const entry = (
    day: string,
    time: string,
    description: string,
    category: string,
    account: string,
    amount: number,
    extra: Row = {},
  ) =>
    entries.push({
      ...base,
      id: id('e'),
      entry_type: 'expense',
      amount: money(amount).toFixed(2),
      description,
      category,
      notes: '',
      installment_group_id: null,
      installment_number: null,
      installment_total: null,
      installment_purchase_total: null,
      invoice_due_override: null,
      account,
      occurred_at: at(day, time),
      source: account === 'Pix' ? 'manual' : 'pluggy',
      external_id: null,
      bank_status: account === 'Pix' ? null : 'POSTED',
      excluded_from_totals: false,
      split_share: null,
      split_people: null,
      ...extra,
    });

  // Últimos 120 dias, de 0 a 3 gastos por dia; os últimos 12 abaixo do valor
  // do dia (dias no azul).
  for (let back = 120; back >= 0; back--) {
    const day = addDays(today, -back);
    // Hoje fica só com os dois gastos da manhã, logo abaixo.
    if (back === 0) continue;
    const calm = back <= 12;
    const count = calm
      ? Math.floor(roll() * 2) + 1
      : Math.floor(roll() * 3) + (roll() < 0.15 ? 0 : 1);
    for (let index = 0; index < count; index++) {
      const pick = MERCHANTS[Math.floor(roll() * MERCHANTS.length)];
      const [name, category, min, max, account] =
        calm && pick[3] > 70 ? MERCHANTS[0] : pick;
      const hour = String(8 + Math.floor(roll() * 13)).padStart(2, '0');
      const minute = String(Math.floor(roll() * 60)).padStart(2, '0');
      entry(
        day,
        `${hour}:${minute}`,
        name,
        category,
        account,
        min + roll() * (max - min),
      );
    }
  }
  // Hoje, na ordem do dia.
  entry(today, '08:12', 'Padaria Pão Dourado', 'Alimentação', 'Pix', 18.9);
  entry(today, '12:37', 'iFood', 'Alimentação', 'Nubank', 34.5, {
    bank_status: 'PENDING',
  });

  // As assinaturas, todo mês no dia de cobrança.
  for (let month = 0; month < 4; month++)
    for (const [name, account, amount, day] of SUBSCRIPTIONS) {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() - month, day);
      const when = date.toISOString().slice(0, 10);
      if (when <= today)
        entry(when, '06:00', name, 'Assinaturas', account, amount);
    }

  // Compras parceladas: um notebook em 10x e um tênis em 3x.
  const installments = (
    name: string,
    category: string,
    account: string,
    total: number,
    parts: number,
    firstDay: string,
  ) => {
    const group = id('a');
    for (let part = 1; part <= parts; part++) {
      const date = new Date(`${firstDay}T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + part - 1);
      // Só as parcelas que já caíram: as futuras encheriam o topo do extrato.
      if (date.toISOString().slice(0, 10) > today) break;
      entry(
        date.toISOString().slice(0, 10),
        '15:20',
        name,
        category,
        account,
        total / parts,
        {
          installment_group_id: group,
          installment_number: part,
          installment_total: parts,
          installment_purchase_total: total.toFixed(2),
          bank_status: part === 1 ? 'POSTED' : 'PENDING',
        },
      );
    }
  };
  installments(
    'Notebook Dell',
    'Compras',
    'Nubank',
    3499,
    10,
    addDays(today, -68),
  );
  installments(
    'Tênis Nike',
    'Compras',
    'Mercado Pago',
    459.9,
    3,
    addDays(today, -40),
  );

  // O salário, todo 5º dia do mês.
  for (let month = 0; month < 5; month++) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - month, 5);
    const when = date.toISOString().slice(0, 10);
    if (when > today) continue;
    entries.push({
      ...base,
      id: id('b'),
      entry_type: 'income',
      amount: '6200.00',
      description: 'Salário',
      category: 'Salário',
      notes: '',
      account: 'Renda',
      occurred_at: at(when, '09:00'),
      source: 'pluggy',
      external_id: null,
      bank_status: 'POSTED',
      excluded_from_totals: false,
      installment_group_id: null,
      installment_number: null,
      installment_total: null,
    });
  }

  // O valor do dia de cada dia (o "Hoje você pode").
  const allowances: Row[] = [];
  for (let back = 120; back >= 0; back--)
    allowances.push({
      ...base,
      id: id('a'),
      day: addDays(today, -back),
      allowance: (118 + Math.round(roll() * 28)).toFixed(2),
    });

  const piggy = (
    bank: 'Nubank' | 'Mercado Pago',
    name: string,
    deposits: [number, number][],
  ) => {
    const bankId = id('b');
    const transactions = deposits.map(([back, amount]) => ({
      ...base,
      id: id('c'),
      piggy_bank_id: bankId,
      kind: 'deposit',
      amount: amount.toFixed(2),
      occurred_at: at(addDays(today, -back), '10:00'),
      note: null,
    }));
    const total = deposits.reduce((sum, [, amount]) => sum + amount, 0);
    const gross = money(total * 1.031);
    return {
      bank: {
        ...base,
        id: bankId,
        bank,
        name,
        product: bank === 'Nubank' ? 'Caixinha Turbo' : 'Cofrinho Meli+',
        cdi_percentage: bank === 'Nubank' ? 115 : 120,
        tax_rule: 'Regressivo',
        iof_rule:
          bank === 'Nubank'
            ? 'Regressivo até o 29º dia; zero a partir do 30º'
            : 'Isento desde o primeiro dia',
        accrues_on_deposit_day: false,
        rate_limit: bank === 'Nubank' ? 5000 : 10000,
        excess_rate: 100,
        policy_version:
          bank === 'Nubank' ? 'NUB-TURBO-115' : 'MP-MELI-120-2026-08',
        policy_started_at: null,
        policy_ends_at: null,
        archived_at: null,
      },
      transactions,
      snapshots: [
        {
          ...base,
          id: id('d'),
          piggy_bank_id: bankId,
          snapshot_date: addDays(today, -1),
          gross_balance: gross.toFixed(2),
          net_balance: money(gross - (gross - total) * 0.175).toFixed(2),
          source: 'pluggy',
        },
      ],
    };
  };
  const vaults = [
    piggy('Nubank', 'Reserva', [
      [210, 2500],
      [150, 1800],
      [95, 1500],
      [40, 1200],
      [12, 900],
    ]),
    piggy('Mercado Pago', 'Viagem', [
      [130, 800],
      [70, 600],
      [25, 500],
    ]),
  ];

  // As faturas fechadas dos últimos meses, pagas.
  const bills: Row[] = [];
  for (const card of CARDS)
    for (let month = 1; month <= 3; month++) {
      const due = new Date(`${today}T12:00:00Z`);
      due.setUTCMonth(due.getUTCMonth() - month + 1, card.due);
      const dueDay = due.toISOString().slice(0, 10);
      if (dueDay > today) continue;
      const total = money(600 + roll() * 900);
      bills.push({
        ...base,
        id: id('c'),
        account: card.account,
        due_date: dueDay,
        closing_date: addDays(dueDay, -7),
        total: total.toFixed(2),
        minimum: money(total * 0.15).toFixed(2),
        paid: total.toFixed(2),
        payments: [{ date: addDays(dueDay, -1), amount: total.toFixed(2) }],
      });
    }

  // Cartão Flash: depósito todo dia 25 (alimentação e transporte), compras
  // desde então e a leitura de saldo no dia do depósito.
  const flashRoll = random(20261025);
  const lastDeposit = (() => {
    const sameMonth = `${today.slice(0, 7)}-25`;
    if (sameMonth <= today) return sameMonth;
    const date = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 1);
    return `${date.toISOString().slice(0, 7)}-25`;
  })();
  const flashDeposits: [string, number][] = [
    ['Alimentação', 980],
    ['Transporte', 264],
  ];
  for (const months of [2, 1, 0]) {
    const date = new Date(`${lastDeposit}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - months);
    const day = date.toISOString().slice(0, 10);
    for (const [category, amount] of flashDeposits)
      entry(
        day,
        '06:00',
        `Depósito Flash · ${category}`,
        category,
        'Flash',
        amount,
        {
          entry_type: 'income',
          source: 'manual',
          bank_status: null,
        },
      );
  }
  const flashFood = [
    'Restaurante Sabor Caseiro',
    'Café Central',
    'Padaria Pão Dourado',
    'Mercado Bom Preço',
    'Burger Station',
  ];
  for (let day = addDays(lastDeposit, 1); day <= today; day = addDays(day, 1)) {
    if (flashRoll() < 0.75)
      entry(
        day,
        '12:20',
        flashFood[Math.floor(flashRoll() * flashFood.length)]!,
        'Alimentação',
        'Flash',
        18 + flashRoll() * 34,
      );
    if (flashRoll() < 0.55)
      entry(
        day,
        '08:05',
        flashRoll() < 0.6 ? 'Metrô de São Paulo' : '99',
        'Transporte',
        'Flash',
        5.2 + flashRoll() * 14,
      );
  }
  const flashBalances = [
    ['Flash Alimentação', 1012.4],
    ['Flash Transporte', 281.75],
  ].map(([account, balance]) => ({
    ...base,
    id: id('f'),
    account,
    balance: Number(balance).toFixed(2),
    measured_at: lastDeposit,
    source: 'manual',
  }));

  const notice = (
    back: number,
    time: string,
    kind: string,
    title: string,
    body: string,
    href: string,
    read: boolean,
  ) => ({
    ...base,
    id: id('n'),
    kind,
    title,
    body,
    href,
    created_at: at(addDays(today, -back), time),
    read_at: read ? at(addDays(today, -back), time) : null,
    archived_at: null,
  });
  const notifications = [
    notice(
      0,
      '07:02',
      'integration',
      'Bancos atualizados',
      '4 lançamentos novos e 1 movimentação nos cofrinhos.',
      '/conexoes',
      false,
    ),
    notice(
      0,
      '06:30',
      'earning',
      'Seus cofrinhos renderam',
      'Ontem: +R$ 9,79 líquidos na Reserva e na Viagem.',
      '/cofrinhos',
      false,
    ),
    notice(
      1,
      '22:01',
      'expense',
      'Dia fechado no azul',
      'Você gastou R$ 64,20 de R$ 124,00. 53 dias no azul até agora.',
      '/financeiro',
      true,
    ),
    notice(
      2,
      '14:03',
      'expense',
      'Compra maior que o normal',
      'Mercado Bom Preço: R$ 139,47 no Itaú.',
      '/financeiro',
      true,
    ),
    notice(
      4,
      '07:01',
      'integration',
      'Fatura do Mercado Pago fechou',
      'R$ 419,00 com vencimento em breve.',
      '/conexoes',
      true,
    ),
  ];

  return {
    financial_entries: entries,
    payment_cards: [
      ...CARDS.map((card) => ({
        ...base,
        account: card.account,
        bank_id: card.bank,
        show_in_invoices: true,
        same_card_as: null,
      })),
      {
        ...base,
        account: 'Pix',
        bank_id: 'other',
        show_in_invoices: false,
        same_card_as: null,
      },
    ],
    card_cycles: CARDS.map((card) => ({
      ...base,
      id: id('e'),
      account: card.account,
      kind: 'credit',
      closing_day: card.closing,
      due_day: card.due,
      closing_offset_days: null,
      due_rolls_forward: true,
    })),
    card_bills: bills,
    card_invoice_payments: [],
    // O limite do Nubank caiu R$ 86,50 entre ontem à noite e hoje de manhã,
    // sem compra correspondente: aparece como "compra a chegar".
    // Limites dos cartões (a barra "Já gasto / Sobra" da Carteira e a da home).
    pluggy_card_links: [
      {
        ...base,
        account: 'Nubank',
        kind: 'credit',
        credit_limit: 4800,
        available_limit: 3351.1,
      },
      {
        ...base,
        account: 'Itaú',
        kind: 'credit',
        credit_limit: 3200,
        available_limit: 2088.4,
      },
      {
        ...base,
        account: 'Mercado Pago',
        kind: 'credit',
        credit_limit: 2500,
        available_limit: 1912.75,
      },
    ],
    card_limit_snapshots: [
      [addDays(today, -1), '22:58', 3437.6],
      [today, '07:48', 3351.1],
    ].map(([day, time, available]) => ({
      ...base,
      id: id('l'),
      account: 'Nubank',
      credit_limit: 4800,
      available,
      taken_at: at(day as string, time as string),
      data_at: at(day as string, time as string),
    })),
    card_payment_events: [],
    // A compra a chegar já corrigida para ontem ("Dividida por você"): o
    // gasto da noite não pesa no dia de hoje.
    pending_spend_splits: [
      {
        ...base,
        account: 'Nubank',
        day: today,
        parts: [
          { amount: '86.50', day: addDays(today, -1), description: 'Mercado' },
        ],
        total: '86.50',
        seen_until: at(today, '07:48'),
        updated_at: at(today, '08:30'),
      },
    ],
    daily_allowances: allowances,
    recurring_expenses: SUBSCRIPTIONS.map(
      ([merchant, account, amount, day]) => {
        const next = new Date(`${today}T12:00:00Z`);
        next.setUTCDate(day);
        if (next.toISOString().slice(0, 10) < today)
          next.setUTCMonth(next.getUTCMonth() + 1);
        return {
          ...base,
          id: id('f'),
          merchant,
          account,
          amount: amount.toFixed(2),
          next_date: next.toISOString().slice(0, 10),
          billing_day: day,
          active: true,
          paid_by_me: true,
          frequency: 'monthly',
          category: 'Assinaturas',
          notes: null,
        };
      },
    ),
    piggy_banks: vaults.map((vault) => vault.bank),
    transactions: vaults.flatMap((vault) => vault.transactions),
    balance_snapshots: vaults.flatMap((vault) => vault.snapshots),
    bank_earning_credits: [],
    benefit_card_balances: flashBalances,
    app_notifications: notifications,
    wishlist_items: (
      [
        ['Air fryer', 280, 10],
        ['Fone Bluetooth', 400, 6],
        ['Tênis de corrida', 650, 3],
        ['Cadeira de escritório', 1200, 1],
      ] as const
    ).map(([name, price, back]) => ({
      ...base,
      id: id('w'),
      name,
      price: price.toFixed(2),
      created_at: at(addDays(today, -back), '09:00'),
      bought_at: null,
    })),
    expense_reviews: [],
    merchant_rules: [],
    merchant_aliases: [
      {
        id: id('ma'),
        user_id,
        match: 'contains',
        pattern: 'ifood',
        name: 'iFood',
        category: 'Alimentação',
        created_at: at(addDays(today, -40), '10:00'),
      },
      {
        id: id('ma'),
        user_id,
        match: 'prefix',
        pattern: 'uber',
        name: 'Uber',
        category: 'Transporte',
        created_at: at(addDays(today, -39), '10:00'),
      },
      {
        id: id('ma'),
        user_id,
        match: 'contains',
        pattern: 'padaria pao dourado',
        name: 'Padaria Pão Dourado',
        category: 'Alimentação',
        created_at: at(addDays(today, -38), '10:00'),
      },
      {
        id: id('ma'),
        user_id,
        match: 'contains',
        pattern: 'netflix',
        name: 'Netflix',
        category: 'Assinaturas',
        created_at: at(addDays(today, -37), '10:00'),
      },
      {
        id: id('ma'),
        user_id,
        match: 'prefix',
        pattern: 'mercado bom',
        name: 'Mercado Bom Preço',
        category: 'Alimentação',
        created_at: at(addDays(today, -36), '10:00'),
      },
      {
        id: id('ma'),
        user_id,
        match: 'contains',
        pattern: 'posto ipiranga',
        name: 'Posto Ipiranga',
        category: 'Transporte',
        created_at: at(addDays(today, -35), '10:00'),
      },
      {
        id: id('ma'),
        user_id,
        match: 'contains',
        pattern: 'drogaria',
        name: 'Drogaria São Paulo',
        category: 'Saúde',
        created_at: at(addDays(today, -34), '10:00'),
      },
      {
        id: id('ma'),
        user_id,
        match: 'exact',
        pattern: 'academia fit',
        name: 'Academia Fit',
        category: null,
        created_at: at(addDays(today, -33), '10:00'),
      },
      {
        id: id('ma'),
        user_id,
        match: 'contains',
        pattern: 'spotify',
        name: 'Spotify',
        category: 'Assinaturas',
        created_at: at(addDays(today, -32), '10:00'),
      },
    ],
    income_sources: [],
    spending_room_exclusions: [],
    shortcut_tokens: [],
    pluggy_robot: [],
    pluggy_sync_runs: [],
    ...demoChats(base, today),
  };
}

/** Conversas do Vetra AI; a primeira é a que abre. */
const CHATS: [string, string, [string, string][]][] = [
  [
    'Delivery do mês',
    '12:40',
    [
      ['user', 'Quanto gastei com delivery este mês?'],
      [
        'assistant',
        'Neste mês foram **R$ 318,40** em 14 pedidos de delivery, **12% a menos** que no mesmo período de setembro.\n\nO maior foi no sábado: R$ 58,90 no iFood. Mantendo esse ritmo, o mês fecha perto de **R$ 410**.',
      ],
      ['user', 'E dá pra pedir hoje?'],
      [
        'assistant',
        'Dá. Hoje ainda sobram **R$ 70,60**: um pedido de até R$ 45 mantém o dia no azul e você chega a **49 dias no azul**.',
      ],
    ],
  ],
  [
    'Pizza e faturas',
    '11:10',
    [
      ['user', 'Posso pedir uma pizza hoje?'],
      [
        'assistant',
        'Pode. Hoje ainda sobram **R$ 70,60**: uma pizza de até R$ 60 cabe e mantém os seus **49 dias no azul**.',
      ],
      ['user', 'E qual fatura vence primeiro?'],
      [
        'assistant',
        'A do **Mercado Pago**, no dia 13 de outubro: **R$ 407,94**. Depois vem a do Itaú, no dia 3 de novembro, e a do Nubank, no dia 9.',
      ],
    ],
  ],
  [
    'Minha semana',
    '09:30',
    [
      ['user', 'Como foi minha semana?'],
      [
        'assistant',
        'Você gastou **R$ 338,74** nesta semana, **R$ 421,94 a menos** que na anterior até o mesmo dia.\n\nAlimentação puxou a fila: R$ 198,25.',
      ],
      ['user', 'E quanto vai em assinaturas?'],
      [
        'assistant',
        'São **4 ativas**, somando **R$ 171,60 por mês**: Netflix, Spotify, Academia Fit e iCloud+. A próxima é o Netflix, no dia 12.',
      ],
    ],
  ],
];

function demoChats(base: Row, today: string) {
  const conversations: Row[] = [];
  const messages: Row[] = [];
  CHATS.forEach(([title, time, lines], chat) => {
    const conversation = `c0000000-0000-4000-8000-ffff0000000${chat + 1}`;
    const [hour, minute] = time.split(':').map(Number);
    const stamp = (offset: number) => {
      const total = hour * 60 + minute;
      const at = total * 60 + offset * 30;
      const h = String(Math.floor(at / 3600)).padStart(2, '0');
      const m = String(Math.floor((at % 3600) / 60)).padStart(2, '0');
      const sec = String(at % 60).padStart(2, '0');
      return `${today}T${h}:${m}:${sec}-03:00`;
    };
    conversations.push({
      ...base,
      id: conversation,
      title,
      status: 'idle',
      last_error: null,
      created_at: stamp(0),
      updated_at: stamp(lines.length),
    });
    lines.forEach(([role, content], index) =>
      messages.push({
        ...base,
        id: `d0000000-0000-4000-8000-ffff000${chat + 1}000${index + 1}`,
        conversation_id: conversation,
        role,
        content,
        created_at: stamp(index),
      }),
    );
  });
  return {
    financial_chat_conversations: conversations,
    financial_chat_messages: messages,
  };
}

/** O que a Pluggy daria de saldo e limite (/api/pluggy/balances). */
export const DEMO_ACCOUNTS = [
  { bank: 'nubank', balance: 2340.15 },
  { bank: 'itau', balance: 812.4 },
  { bank: 'mercado-pago', balance: 1120 },
  { bank: 'picpay', balance: 356.9 },
] as const;

export const DEMO_CARD_LIMITS = CARDS.map((card, index) => ({
  key: card.account,
  limit: card.limit,
  available: [3351.1, 2140.75, 1890.4][index],
}));

const DEMO_FLOWS: Record<
  string,
  [
    string,
    string | null,
    string | null,
    number,
    number,
    'external' | 'internal',
  ][]
> = {
  nubank: [
    ['Pix enviado · Ana Souza', 'Pix', 'Transferências', -20, -85, 'external'],
    ['Pix recebido · Lucas Lima', 'Pix', 'Transferências', 15, 60, 'external'],
    ['Aplicação na Reserva', null, 'Investimentos', -50, -200, 'internal'],
    [
      'Pagamento de fatura',
      'Boleto',
      'Pagamento de cartão',
      -300,
      -650,
      'external',
    ],
  ],
  itau: [
    ['Salário · Empresa Exemplo', 'TED', 'Salário', 5200, 5200, 'external'],
    ['Conta de luz', 'Boleto', 'Contas', -90, -160, 'external'],
    [
      'Transferência para Nubank',
      'TED',
      'Transferências',
      -400,
      -900,
      'internal',
    ],
    [
      'Pix enviado · Mercado Bom Preço',
      'Pix',
      'Supermercado',
      -45,
      -140,
      'external',
    ],
  ],
  'mercado-pago': [
    [
      'Dinheiro reservado · Viagem',
      null,
      'Investimentos',
      -40,
      -150,
      'internal',
    ],
    [
      'Pix recebido · Marina Rocha',
      'Pix',
      'Transferências',
      20,
      80,
      'external',
    ],
    [
      'Pagamento com QR Pix · Café Central',
      'Pix',
      'Alimentação',
      -8,
      -22,
      'external',
    ],
  ],
  picpay: [
    [
      'Pix enviado · Pedro Alves',
      'Pix',
      'Transferências',
      -15,
      -70,
      'external',
    ],
    ['Recarga de celular', null, 'Telefone', -20, -40, 'external'],
    ['Pix recebido · Julia Costa', 'Pix', 'Transferências', 10, 50, 'external'],
  ],
};

const DEMO_VAULTS: Record<string, { count: number; total: number }> = {
  nubank: { count: 1, total: 8102.04 },
  'mercado-pago': { count: 1, total: 1948.59 },
};

/** Página do banco no modo demonstração: extrato inventado e estável. */
export function demoBankDetail(bank: string, days: number) {
  const account = DEMO_ACCOUNTS.find((item) => item.bank === bank);
  const flows = DEMO_FLOWS[bank];
  if (!account || !flows) return null;
  const today = saoToday();
  const next = random(bank.length * 7919 + days);
  const transactions: {
    id: string;
    date: string;
    at: string | null;
    amount: number;
    description: string;
    kind: string | null;
    category: string | null;
    pending: boolean;
    flow: 'external' | 'internal' | 'yield';
  }[] = [];
  let count = 0;
  for (let back = 0; back < days; back++) {
    const day = addDays(today, -back);
    const dayOfMonth = Number(day.slice(8));
    for (const [description, kind, category, low, high, flow] of flows) {
      const monthly = low === high;
      if (monthly ? dayOfMonth !== 5 : next() > 0.18) continue;
      const amount = money(low + (high - low) * next());
      const hour = String(8 + Math.floor(next() * 12)).padStart(2, '0');
      transactions.push({
        id: `demo-${bank}-${++count}`,
        date: day,
        at: at(
          day,
          `${hour}:${String(Math.floor(next() * 60)).padStart(2, '0')}`,
        ),
        amount,
        description,
        kind,
        category,
        pending: back === 0 && next() > 0.6,
        flow,
      });
    }
    if (DEMO_VAULTS[bank] && dayOfMonth % 7 !== 0)
      transactions.push({
        id: `demo-${bank}-${++count}`,
        date: day,
        at: null,
        amount: money(0.3 + next() * 0.9),
        description: 'Rendimento',
        kind: null,
        category: 'Rendimentos',
        pending: false,
        flow: 'yield',
      });
  }
  const card = CARDS.find((item) => item.bank === bank);
  const limits = DEMO_CARD_LIMITS.find((item) => item.key === card?.account);
  const due = (() => {
    if (!card) return null;
    const [year, month] = today.split('-').map(Number);
    const sameMonth = `${today.slice(0, 7)}-${String(card.due).padStart(2, '0')}`;
    if (sameMonth >= today) return sameMonth;
    const nextMonth = new Date(Date.UTC(year, month, card.due));
    return nextMonth.toISOString().slice(0, 10);
  })();
  return {
    bank,
    balance: account.balance,
    updatedAt: `${today}T09:12:00-03:00`,
    status: 'ok' as const,
    days,
    transactions,
    card:
      card && limits && due
        ? {
            limit: limits.limit,
            available: limits.available,
            bill: {
              dueDate: due,
              total: money((limits.limit - limits.available) * 0.55),
              closingDate: addDays(due, -7),
            },
          }
        : null,
    vaults: DEMO_VAULTS[bank] ?? { count: 0, total: 0 },
  };
}
