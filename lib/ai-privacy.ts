/**
 * O que nunca sai do Vetra para o Gemini (API gratuita: o Google pode usar o
 * conteúdo). Os gastos vão; o que identifica não. Vale para texto livre
 * (descrição, nota, pergunta); campos estruturados não passam por aqui.
 */

export const HIDDEN_NUMBER = '[número oculto]';
export const HIDDEN_EMAIL = '[e-mail oculto]';

const numberRun = /\d(?:[\s.\-/]?\d){3,}/g;
const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Números de 4+ dígitos (com separadores) e e-mails. Três dígitos ficam:
 * são nomes de loja e nenhum documento cabe em três.
 */
export function scrubIdentifiers(text: string) {
  return text.replace(email, HIDDEN_EMAIL).replace(numberRun, HIDDEN_NUMBER);
}

const placeholder =
  /\[(número oculto|e-mail oculto|pessoa|origem) (\d+)\]|\[você\]/g;

type Kind = 'número oculto' | 'e-mail oculto' | 'pessoa' | 'origem';

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Igual a `scrubIdentifiers`, mas reversível: cada dado vira um marcador
 * ("[número oculto 2]") e `restore` devolve o original antes de salvar.
 * Também troca, em qualquer texto que passe por `scrub`:
 * - `alias('pessoa', nome)` → "[pessoa N]" (destinatário de Pix etc.);
 * - `alias('origem', texto)` → "[origem N]" (fonte de renda);
 * - `self(nomes)` → "[você]".
 */
export function createRedactor() {
  const originals = new Map<Kind, string[]>();
  const seen = new Map<string, number>();
  const known: { pattern: RegExp; marker: string }[] = [];
  let selfPattern: RegExp | null = null;
  let selfOriginal = '';

  const token = (kind: Kind, value: string) => {
    const key = `${kind}\u0000${value.toLocaleLowerCase('pt-BR')}`;
    let index = seen.get(key);
    if (index === undefined) {
      const list = originals.get(kind) ?? [];
      list.push(value);
      originals.set(kind, list);
      index = list.length;
      seen.set(key, index);
    }
    return `[${kind} ${index}]`;
  };

  const scrub = (text: string) => {
    let out = text;
    if (selfPattern) out = out.replace(selfPattern, '[você]');
    for (const { pattern, marker } of known) out = out.replace(pattern, marker);
    return out
      .replace(email, (value) => token('e-mail oculto', value))
      .replace(numberRun, (value) => token('número oculto', value));
  };

  return {
    scrub,
    /** Troca o texto por apelido e passa a reconhecê-lo em outros textos. */
    alias(kind: 'pessoa' | 'origem', value: string) {
      const clean = value.trim();
      if (clean.length < 2) return clean;
      const marker = token(kind, clean);
      if (!known.some((item) => item.marker === marker)) {
        known.push({
          pattern: new RegExp(
            String.raw`(?<![\p{L}])${escapeRegExp(clean)}(?![\p{L}])`,
            'giu',
          ),
          marker,
        });
        // Os mais longos primeiro: "Julia Souza" antes de "Julia".
        known.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
      }
      return marker;
    },
    /** Nome do próprio usuário, palavra por palavra (3+ letras). */
    self(names: string[]) {
      const words = [
        ...new Set(
          names
            .flatMap((name) => name.split(/[\s._-]+/))
            .map((word) => word.trim())
            .filter((word) => word.length >= 3 && /^\p{L}+$/u.test(word)),
        ),
      ];
      if (!words.length) return;
      selfOriginal = names.find((name) => name.trim()) ?? '';
      selfPattern = new RegExp(
        String.raw`(?<![\p{L}])(?:${words.map(escapeRegExp).join('|')})(?![\p{L}])`,
        'giu',
      );
    },
    restore: (text: string) =>
      text.replace(placeholder, (marker, kind?: Kind, index?: string) =>
        marker === '[você]'
          ? selfOriginal || marker
          : (originals.get(kind!)?.[Number(index) - 1] ?? marker),
      ),
  };
}

export type Redactor = ReturnType<typeof createRedactor>;
