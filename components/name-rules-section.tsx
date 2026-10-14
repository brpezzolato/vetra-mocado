'use client';

import { useState } from 'react';
import { ChevronRight, Plus, Search, Trash2, X } from 'lucide-react';
import { MATCH_LABEL, type MerchantAlias } from '@/lib/merchant-aliases';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* Regras de nome nas Configurações: busca, lista compacta (tocar edita,
   lixeira remove) e só as primeiras até pedir todas. */

/** Quantas regras aparecem antes de "Mostrar todas". */
const PREVIEW = 6;

/** Busca sem acento e sem caixa. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function NameRulesSection({
  rules,
  busy,
  onCreate,
  onEdit,
  onDelete,
}: {
  rules: MerchantAlias[];
  busy: boolean;
  onCreate: () => void;
  onEdit: (rule: MerchantAlias) => void;
  onDelete: (rule: MerchantAlias) => void;
}) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const needle = fold(query.trim());
  const found = needle
    ? rules.filter((rule) =>
        fold(`${rule.pattern} ${rule.name} ${rule.category ?? ''}`).includes(
          needle,
        ),
      )
    : rules;
  // Na busca mostra tudo o que achou; sem ela, só o começo.
  const shown = needle || all ? found : found.slice(0, PREVIEW);

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">
            Regras de nome
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {rules.length}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Renomeia a compra pelo texto do nome, nas novas e nas antigas.
          </p>
        </div>
        <Button
          type="button"
          variant="glass"
          size="sm"
          disabled={busy}
          onClick={onCreate}
        >
          <Plus />
          Nova
        </Button>
      </div>

      {rules.length > 0 && (
        <div className="relative mt-4">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar regra"
            aria-label="Buscar regra de nome"
            className="h-10 rounded-xl pr-9 pl-9"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setQuery('')}
              aria-label="Limpar busca"
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              <X />
            </Button>
          )}
        </div>
      )}

      {shown.length ? (
        <ul className="mt-3 divide-y divide-border/60">
          {shown.map((rule) => (
            <li key={rule.id} className="flex items-center gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => onEdit(rule)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {rule.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {MATCH_LABEL[rule.match]} “{rule.pattern}”
                    {rule.category ? ` · ${rule.category}` : ''}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                onClick={() => onDelete(rule)}
                aria-label={`Remover a regra ${rule.name}`}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {needle ? 'Nenhuma regra encontrada.' : 'Nenhuma regra ainda.'}
        </p>
      )}

      {!needle && found.length > PREVIEW && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => setAll((open) => !open)}
        >
          {all ? 'Mostrar menos' : `Mostrar todas (${found.length})`}
        </Button>
      )}
    </section>
  );
}
