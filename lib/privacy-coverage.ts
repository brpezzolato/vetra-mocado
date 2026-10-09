import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Privacy mode hides what carries `data-private-value` (or `tabular-nums`).
 * This scans the source for currency painted without a marker. A text
 * heuristic, not a DOM check: wrappers higher up need `allowed`.
 */
// `<Private>` carries the attribute itself; the other two are the attribute
// and the class most figures already have for alignment.
const MARKERS = ['data-private-value', 'tabular-nums', '<Private>'];
const LOOKBEHIND = 4;

/** Files the scan can't resolve, with why they're safe. Keep it small. */
const allowed = new Map<string, string>();

export type PrivacyGap = { file: string; line: number; text: string };

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const FORMATTERS = /\b(money|currency|formatMoney|moneyLabel)\s*\(/;

/**
 * True when the line paints a currency value (not computing, labelling or
 * passing it as a prop; the receiver is checked on its own line).
 */
function rendersMoney(line: string) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
  if (/(function|const)\s+\w*money/i.test(trimmed)) return false;
  // Building a string is not painting it.
  if (/^(const|let|var|return)\b/.test(trimmed) || /^[?:]\s*`/.test(trimmed))
    return false;
  // A bare template literal is an argument, not JSX.
  if (trimmed.startsWith('`')) return false;
  // Read aloud or hovered, not painted as a figure on the surface.
  if (/(aria-label|title|placeholder|alt)=/.test(trimmed)) return false;
  if (!FORMATTERS.test(trimmed) || !trimmed.includes('{')) return false;
  // prop={...money(...)} hands the value on; the receiver marks it.
  const beforeFormatter = trimmed.slice(0, trimmed.search(FORMATTERS));
  return !/[\w-]+=\{[^}]*$/.test(beforeFormatter);
}

/** Value inside a prop opened on an earlier line: the receiver marks it. */
function insideMultilineProp(lines: string[], index: number) {
  for (let back = 1; back <= LOOKBEHIND; back++) {
    const line = lines[index - back]?.trim();
    if (!line) break;
    if (/[\w-]+=\{$/.test(line)) return true;
    if (/^<[A-Z]/.test(line) || line.endsWith('/>')) break;
  }
  return false;
}

export function findPrivacyGaps(root = process.cwd()): PrivacyGap[] {
  const gaps: PrivacyGap[] = [];
  for (const dir of ['components', 'app']) {
    let files: string[];
    try {
      files = walk(join(root, dir));
    } catch {
      continue;
    }
    for (const file of files) {
      const relative = file.slice(root.length + 1);
      if (allowed.has(relative)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!rendersMoney(line)) return;
        if (insideMultilineProp(lines, index)) return;
        const context = lines
          .slice(Math.max(0, index - LOOKBEHIND), index + 1)
          .join('\n');
        if (MARKERS.some((marker) => context.includes(marker))) return;
        gaps.push({ file: relative, line: index + 1, text: line.trim() });
      });
    }
  }
  return gaps;
}
