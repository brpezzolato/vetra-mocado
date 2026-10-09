'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { INCOME_CATEGORIES } from '@/lib/income';
import { createClient } from '@/lib/supabase/client';

/* Regras de renda: texto do extrato vira entrada que conta no "Entrou".
   Salvar ou remover reaplica nas entradas existentes (app/api/pluggy/income-rules). */

type Rule = {
  id: string;
  pattern: string;
  label: string;
  category: string;
};

export function IncomeRules() {
  const client = useMemo(() => createClient(), []);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(
    () =>
      client
        .from('income_sources')
        .select('id, pattern, label, category')
        .eq('match', 'contains')
        .order('label')
        .then(({ data }) => setRules((data ?? []) as Rule[])),
    [client],
  );
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/pluggy/income-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        updated?: number;
      };
      if (!response.ok)
        throw new Error(result.error ?? 'Não foi possível salvar.');
      setMessage(
        result.updated
          ? `${result.updated} ${result.updated === 1 ? 'entrada atualizada' : 'entradas atualizadas'}.`
          : 'Salvo. As próximas entradas já seguem a regra.',
      );
      await load();
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Não foi possível salvar.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="group rounded-2xl border bg-card p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden after:content-['＋'] group-open:after:content-['−']">
        Regras de renda · {rules?.length ?? 0}{' '}
        {rules?.length === 1 ? 'regra' : 'regras'}
      </summary>
      <p className="my-3 text-sm text-muted-foreground">
        Quando uma entrada nas suas contas tiver um texto — como &ldquo;PAGTO
        Salários&rdquo; —, ela conta no &ldquo;Entrou&rdquo;, com o nome e a
        categoria que você escolher. Vale para as próximas e corrige as que já
        chegaram. A categoria Salário entra na regra de um salário por mês.
      </p>
      <Button
        type="button"
        variant="glass"
        size="sm"
        className="mb-3"
        disabled={busy}
        onClick={() => setEditing('new')}
      >
        Nova regra
      </Button>
      {message && (
        <output className="block mb-3 text-sm text-muted-foreground">
          {message}
        </output>
      )}
      {rules === null ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : rules.length ? (
        <ul className="space-y-3">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"
            >
              <span className="min-w-0 break-words">
                Quando a entrada contém &ldquo;{rule.pattern}&rdquo; →{' '}
                <span className="font-medium">{rule.label}</span> ·{' '}
                {rule.category}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEditing(rule)}
                >
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void send({ action: 'delete', id: rule.id })}
                >
                  Remover regra
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma regra ainda.</p>
      )}
      {editing && (
        <IncomeRuleDialog
          key={editing === 'new' ? 'nova' : editing.id}
          rule={editing === 'new' ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            const ok = await send({
              action: 'save',
              ...(editing !== 'new' && { id: editing.id }),
              ...values,
            });
            if (ok) setEditing(null);
          }}
        />
      )}
    </details>
  );
}

function IncomeRuleDialog({
  rule,
  busy,
  onClose,
  onSave,
}: {
  rule: Rule | null;
  busy: boolean;
  onClose: () => void;
  onSave: (values: Omit<Rule, 'id'>) => void;
}) {
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [label, setLabel] = useState(rule?.label ?? '');
  const [category, setCategory] = useState<string>(
    rule?.category ?? INCOME_CATEGORIES[0],
  );
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({
              pattern: pattern.trim(),
              label: label.trim(),
              category,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {rule ? 'Editar regra' : 'Nova regra de renda'}
            </DialogTitle>
            <DialogDescription>
              Copie o texto como ele aparece no extrato do banco. Maiúsculas e
              acentos não importam.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor="income-pattern" className="text-sm font-medium">
              Texto que aparece no banco
            </label>
            <Input
              id="income-pattern"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="PAGTO Salários"
              maxLength={160}
              className="h-11"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="income-label" className="text-sm font-medium">
              Nome no app
            </label>
            <Input
              id="income-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Salário"
              maxLength={80}
              className="h-11"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="income-category" className="text-sm font-medium">
              Categoria
            </label>
            <Select
              value={category}
              onValueChange={(value) => value && setCategory(value)}
            >
              <SelectTrigger
                id="income-category"
                className="h-11 w-full min-w-0"
              >
                <SelectValue>{category}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {INCOME_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={busy || pattern.trim().length < 3 || !label.trim()}
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
