'use client';

import { useEffect, useMemo, useState } from 'react';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import {
  MATCH_LABEL,
  merchantText,
  type MerchantAlias,
  type MerchantAliasMatch,
} from '@/lib/merchant-aliases';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** "Manter a categoria de cada compra": a regra só troca o nome. */
const KEEP = '__keep__';

/**
 * Cria regra de nome e categoria a partir de uma compra. O banco aplica
 * (`apply_merchant_alias`) em toda origem e, se pedido, nas existentes.
 */
export function MerchantAliasDialog({
  description = '',
  category = 'Outros',
  rule,
  onClose,
  onApplied,
}: {
  /** Uma regra que já existe, para editar. */
  rule?: MerchantAlias;
  /** O nome da compra de onde a regra nasce; vazio para uma regra nova,
   * criada nas Configurações. */
  description?: string;
  category?: string;
  onClose: () => void;
  /** Depois de salvar: quantas compras antigas mudaram. */
  onApplied: (changed: number) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  // Regra nova sem compra de origem: "contém".
  const [match, setMatch] = useState<MerchantAliasMatch>(
    rule?.match ?? (description.trim() ? 'prefix' : 'contains'),
  );
  const [pattern, setPattern] = useState(rule?.pattern ?? description.trim());
  const [name, setName] = useState(rule?.name ?? description.trim());
  const [ruleCategory, setRuleCategory] = useState(
    rule ? (rule.category ?? KEEP) : category === 'Outros' ? KEEP : category,
  );
  const [apply, setApply] = useState(true);
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const categories = [...new Set([category, ...EXPENSE_CATEGORIES])].filter(
    (value) => value !== 'Outros',
  );
  const finalCategory = ruleCategory === KEEP ? null : ruleCategory;
  const valid = merchantText(pattern).length >= 2 && name.trim().length > 0;

  // Quantas compras que já existem a regra mudaria, enquanto ele digita.
  useEffect(() => {
    if (!valid) return;
    let alive = true;
    const timer = setTimeout(() => {
      void supabase
        .rpc('save_merchant_alias', {
          p_match: match,
          p_pattern: pattern,
          p_name: name,
          p_category: finalCategory,
          p_apply: true,
          p_preview: true,
        })
        .then(({ data, error: failure }) => {
          if (alive) setPreview(failure ? null : Number(data ?? 0));
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [supabase, match, pattern, name, finalCategory, valid]);

  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError('');
    const { data, error: failure } = await supabase.rpc('save_merchant_alias', {
      p_match: match,
      p_pattern: pattern,
      p_name: name,
      p_category: finalCategory,
      p_apply: apply,
      p_preview: false,
    });
    if (failure) {
      setBusy(false);
      return setError('Não foi possível salvar a regra. Tente novamente.');
    }
    // Mudou o critério: a regra é outra linha e a antiga sai. Só nome/categoria:
    // a mesma linha.
    if (
      rule &&
      (rule.match !== match || rule.pattern !== merchantText(pattern))
    )
      await supabase.from('merchant_aliases').delete().eq('id', rule.id);
    setBusy(false);
    onApplied(Number(data ?? 0));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="min-w-0">
          <DialogHeader>
            <DialogTitle>
              {rule
                ? 'Editar regra'
                : description.trim()
                  ? 'Criar regra'
                  : 'Nova regra de nome'}
            </DialogTitle>
            <DialogDescription>
              As próximas compras com esse nome chegam já com o nome e a
              categoria certos — do banco, do Atalho ou à mão.
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4">
            <div className="grid min-w-0 gap-3 text-sm">
              <label htmlFor="alias-pattern">Quando o nome</label>
              <div className="grid min-w-0 gap-2 sm:grid-cols-[10rem_1fr]">
                <Select
                  value={match}
                  onValueChange={(value) =>
                    value && setMatch(value as MerchantAliasMatch)
                  }
                >
                  <SelectTrigger
                    aria-label="Como comparar o nome"
                    className="h-11 w-full min-w-0"
                  >
                    <SelectValue>{MATCH_LABEL[match]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MATCH_LABEL) as MerchantAliasMatch[]).map(
                      (value) => (
                        <SelectItem key={value} value={value}>
                          {MATCH_LABEL[value]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <Input
                  id="alias-pattern"
                  placeholder="Ex.: 579 - bar"
                  required
                  maxLength={160}
                  className="h-11"
                  value={pattern}
                  onChange={(event) => setPattern(event.target.value)}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                Apague o que muda de uma compra para outra, como números de
                pedido. Maiúsculas e espaços não importam.
              </span>
            </div>
            <label htmlFor="alias-name" className="grid gap-3 text-sm">
              Chamar de
              <Input
                id="alias-name"
                placeholder="Ex.: Lavanderia"
                required
                maxLength={160}
                className="h-11"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label
              htmlFor="alias-category"
              className="grid min-w-0 gap-3 text-sm"
            >
              Categoria
              <Select
                value={ruleCategory}
                onValueChange={(value) => value && setRuleCategory(value)}
              >
                <SelectTrigger
                  id="alias-category"
                  className="h-11 w-full min-w-0"
                >
                  <SelectValue>
                    {ruleCategory === KEEP
                      ? 'Manter a de cada compra'
                      : ruleCategory}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  alignItemWithTrigger={false}
                  collisionAvoidance={{ side: 'none', align: 'shift' }}
                  className="max-h-[min(16rem,var(--available-height))] overflow-y-auto overscroll-contain"
                >
                  <SelectItem value={KEEP}>Manter a de cada compra</SelectItem>
                  {categories.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="flex items-start justify-between gap-4 rounded-2xl border p-3">
              <label htmlFor="alias-apply" className="grid gap-1 text-sm">
                Aplicar às compras que já existem
                <span className="text-xs text-muted-foreground">
                  {!valid || preview === null
                    ? 'Troca o nome (e a categoria) das compras antigas que batem com a regra.'
                    : preview === 0
                      ? 'Nenhuma compra antiga muda.'
                      : preview === 1
                        ? '1 compra antiga muda.'
                        : `${preview} compras antigas mudam.`}
                </span>
              </label>
              <Switch
                id="alias-apply"
                checked={apply}
                onCheckedChange={setApply}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="glass-quiet"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="glass" disabled={busy || !valid}>
              {busy ? 'Salvando…' : 'Salvar regra'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
