import { endDemoSession, startDemoSession } from './demo-session';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEMO_USER_ID, demoTables } from './demo-data';

/* Protótipo: Supabase falso em memória, com os dados fictícios de
   lib/demo/demo-data.ts. Nada sai para servidor nenhum. */

export const DEMO_MODE = true;

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

let tables: Record<string, Row[]> | null = null;
const db = () => (tables ??= demoTables());

const singular = (table: string) =>
  table.endsWith('ies')
    ? `${table.slice(0, -3)}y`
    : table.endsWith('s')
      ? table.slice(0, -1)
      : table;

/** Datas como datas (fusos diferentes); o resto como número ou texto. */
function compare(a: unknown, b: unknown) {
  if (typeof a === 'string' && typeof b === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(a) && /^\d{4}-\d{2}-\d{2}/.test(b)) {
      const x = Date.parse(a);
      const y = Date.parse(b.length === 10 ? `${b}T00:00:00-03:00` : b);
      if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y;
    }
    const x = Number(a);
    const y = Number(b);
    if (a.trim() && b.trim() && !Number.isNaN(x) && !Number.isNaN(y))
      return x - y;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'number' || typeof b === 'number')
    return Number(a) - Number(b);
  return asText(a) < asText(b) ? -1 : asText(a) > asText(b) ? 1 : 0;
}

/** Um valor de linha como texto (objetos viram JSON). */
const asText = (value: unknown) =>
  value == null
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value as string | number | boolean);

const parseValue = (raw: string): unknown =>
  raw === 'null'
    ? null
    : raw === 'true'
      ? true
      : raw === 'false'
        ? false
        : raw.replace(/^"|"$/g, '');

function operator(column: string, op: string, raw: string): Filter {
  const value = parseValue(raw);
  switch (op) {
    case 'eq':
      return (row) => compare(row[column], value) === 0;
    case 'neq':
      return (row) => compare(row[column], value) !== 0;
    case 'gt':
      return (row) => compare(row[column], value) > 0;
    case 'gte':
      return (row) => compare(row[column], value) >= 0;
    case 'lt':
      return (row) => compare(row[column], value) < 0;
    case 'lte':
      return (row) => compare(row[column], value) <= 0;
    case 'is':
      return (row) => (row[column] ?? null) === value;
    case 'in': {
      const list = raw
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((item) => parseValue(item.trim()));
      return (row) => list.some((item) => compare(row[column], item) === 0);
    }
    case 'ilike':
    case 'like': {
      const pattern = new RegExp(
        `^${String(value)
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/%/g, '.*')}$`,
        op === 'ilike' ? 'i' : '',
      );
      return (row) => pattern.test(asText(row[column]));
    }
    default:
      return () => true;
  }
}

/** O `or` do PostgREST: "a.eq.1,b.is.null". */
function orFilter(expression: string): Filter {
  const parts = expression
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [column, op, ...rest] = part.split('.');
      if (op === 'not') {
        const [inner, ...value] = rest;
        const filter = operator(column, inner, value.join('.'));
        return (row: Row) => !filter(row);
      }
      return operator(column, op, rest.join('.'));
    });
  return (row) => parts.some((filter) => filter(row));
}

/** As relações pedidas no select: "*, transactions(*), piggy_banks(name)". */
function relations(select: string) {
  const found: { name: string; table: string }[] = [];
  const pattern = /(?:(\w+):)?(\w+)(?:!\w+)?\(/g;
  let depth = 0;
  for (let index = 0; index < select.length; index++) {
    if (depth === 0) {
      pattern.lastIndex = index;
      const match = pattern.exec(select);
      if (match && match.index === index) {
        found.push({ name: match[1] ?? match[2], table: match[2] });
        index = pattern.lastIndex - 1;
        depth = 1;
        continue;
      }
    }
    if (select[index] === '(') depth++;
    if (select[index] === ')') depth--;
  }
  return found;
}

class DemoQuery implements PromiseLike<unknown> {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private from = 0;
  private to = Infinity;
  private shape: 'many' | 'single' | 'maybeSingle' = 'many';
  private selectText = '*';
  private head = false;
  private count = false;
  private mutation: 'insert' | 'upsert' | 'update' | 'delete' | null = null;
  private payload: Row | Row[] | null = null;
  private conflict: string[] | undefined;

  constructor(private table: string) {}

  select(columns = '*', options?: { head?: boolean; count?: string }) {
    this.selectText = columns;
    this.head = Boolean(options?.head);
    this.count = Boolean(options?.count);
    return this;
  }
  insert(values: Row | Row[]) {
    this.mutation = 'insert';
    this.payload = values;
    return this;
  }
  upsert(values: Row | Row[], options?: { onConflict?: string }) {
    this.mutation = 'upsert';
    this.payload = values;
    this.conflict = options?.onConflict?.split(',').map((key) => key.trim());
    return this;
  }
  update(values: Row) {
    this.mutation = 'update';
    this.payload = values;
    return this;
  }
  delete() {
    this.mutation = 'delete';
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) === 0);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) !== 0);
    return this;
  }
  gt(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) > 0);
    return this;
  }
  gte(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) >= 0);
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) < 0);
    return this;
  }
  lte(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) <= 0);
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) =>
      values.some((value) => compare(row[column], value) === 0),
    );
    return this;
  }
  not(column: string, op: string, value: unknown) {
    const filter = operator(
      column,
      op,
      value === null ? 'null' : asText(value),
    );
    this.filters.push((row) => !filter(row));
    return this;
  }
  like(column: string, value: string) {
    this.filters.push(operator(column, 'like', value));
    return this;
  }
  ilike(column: string, value: string) {
    this.filters.push(operator(column, 'ilike', value));
    return this;
  }
  or(expression: string) {
    this.filters.push(orFilter(expression));
    return this;
  }
  filter(column: string, op: string, value: unknown) {
    this.filters.push(operator(column, op, asText(value)));
    return this;
  }
  match(values: Row) {
    for (const [column, value] of Object.entries(values))
      this.eq(column, value);
    return this;
  }
  contains() {
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  limit(count: number) {
    this.to = this.from + count - 1;
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  single() {
    this.shape = 'single';
    return this;
  }
  maybeSingle() {
    this.shape = 'maybeSingle';
    return this;
  }
  abortSignal() {
    return this;
  }
  returns() {
    return this;
  }
  throwOnError() {
    return this;
  }

  private withRelations(row: Row): Row {
    const extra: Row = {};
    for (const { name, table } of relations(this.selectText)) {
      const rows = db()[table] ?? [];
      const ownKey = `${singular(table)}_id`;
      if (ownKey in row)
        extra[name] = rows.find((child) => child.id === row[ownKey]) ?? null;
      else {
        const key = `${singular(this.table)}_id`;
        extra[name] = rows.filter((child) => child[key] === row.id);
      }
    }
    return { ...row, ...extra };
  }

  private run() {
    const all = (db()[this.table] ??= []);
    if (this.mutation === 'insert' || this.mutation === 'upsert') {
      const list = (
        Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]
      ).map((row): Row => ({
        id: crypto.randomUUID(),
        user_id: DEMO_USER_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...row,
      }));
      // upsert com onConflict: substitui a linha que tem as mesmas chaves.
      const keys = this.mutation === 'upsert' ? this.conflict : undefined;
      for (const row of list) {
        const existing = keys
          ? all.find((other) => keys.every((key) => other[key] === row[key]))
          : undefined;
        if (existing) Object.assign(existing, row);
        else all.push(row);
      }
      return this.shape === 'many' ? list : (list[0] ?? null);
    }
    const matching = all.filter((row) => this.filters.every((f) => f(row)));
    if (this.mutation === 'update') {
      for (const row of matching) Object.assign(row, this.payload);
      return this.shape === 'many' ? matching : (matching[0] ?? null);
    }
    if (this.mutation === 'delete') {
      db()[this.table] = all.filter((row) => !matching.includes(row));
      return this.shape === 'many' ? matching : (matching[0] ?? null);
    }
    const sorted = [...matching].sort((a, b) => {
      for (const { column, ascending } of this.orders) {
        const result = compare(a[column] ?? '', b[column] ?? '');
        if (result) return ascending ? result : -result;
      }
      return 0;
    });
    const rows = sorted
      .slice(this.from, this.to + 1)
      .map((row) => this.withRelations(row));
    if (this.shape !== 'many') return rows[0] ?? null;
    return rows;
  }

  // O construtor de consultas do Supabase é "thenable" (await direto nele).
  // oxlint-disable-next-line unicorn/no-thenable
  then<TResult1 = unknown, TResult2 = never>(
    resolve?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    let result: unknown;
    try {
      const data = this.run();
      const count = Array.isArray(data) ? data.length : data ? 1 : 0;
      result =
        this.shape === 'single' && data === null
          ? {
              data: null,
              error: { message: 'Nenhuma linha (demonstração).' },
              count: 0,
            }
          : {
              data: this.head ? null : structuredClone(data),
              error: null,
              count: this.count ? count : null,
              status: 200,
            };
    } catch (error) {
      return Promise.reject(error).then(resolve, reject);
    }
    return Promise.resolve(result).then(resolve, reject);
  }
}

const DEMO_USER = {
  id: DEMO_USER_ID,
  email: 'demo@vetra.app',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};
const DEMO_SESSION = {
  access_token: 'demo',
  refresh_token: 'demo',
  token_type: 'bearer',
  expires_in: 31_536_000,
  expires_at: Math.floor(Date.now() / 1000) + 31_536_000,
  user: DEMO_USER,
};

const RPC: Record<string, unknown> = {
  vetra_security_status: {
    sessionId: 'demo',
    enabled: false,
    unlocked: true,
    expiresAt: null,
  },
};

export function demoClient(): SupabaseClient {
  const client = {
    from: (table: string) => new DemoQuery(table),
    rpc: async (name: string) => ({ data: RPC[name] ?? null, error: null }),
    auth: {
      getUser: async () => ({ data: { user: DEMO_USER }, error: null }),
      getClaims: async () => ({
        data: { claims: { sub: DEMO_USER_ID, email: DEMO_USER.email } },
        error: null,
      }),
      getSession: async () => ({
        data: { session: DEMO_SESSION },
        error: null,
      }),
      refreshSession: async () => ({
        data: { session: DEMO_SESSION, user: DEMO_USER },
        error: null,
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      signInWithPassword: async () => {
        if (typeof document !== 'undefined') startDemoSession();
        return {
          data: { user: DEMO_USER, session: DEMO_SESSION },
          error: null,
        };
      },
      signUp: async () => {
        if (typeof document !== 'undefined') startDemoSession();
        return {
          data: { user: DEMO_USER, session: DEMO_SESSION },
          error: null,
        };
      },
      signOut: async () => {
        if (typeof document !== 'undefined') endDemoSession();
        return { error: null };
      },
    },
    channel: () => {
      const channel = {
        on: () => channel,
        subscribe: () => channel,
        unsubscribe: async () => 'ok',
      };
      return channel;
    },
    removeChannel: async () => 'ok',
  };
  return client as unknown as SupabaseClient;
}
