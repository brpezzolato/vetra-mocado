/* Saída do carregamento: o logo cresce até sair da tela e o app aparece por
   dentro dele. Duas camadas de tela cheia com o mesmo transform (só a GPU
   amplia):
   - véu: fundo do app com o recorte das três barras, borda esfumada;
   - logo: as barras sobre fundo opaco.
   As barras terminam de subir, encolhem um pouco e crescem acelerando; o logo
   some no começo e o véu no fim. Montado no layout effect do
   LoadingExitTrigger para o app não piscar. CSS: `.vetra-loading-exit*`. */

/** Barras no viewBox 48: x e altura (largura 12, base 42, canto 3,5). */
const BARS = [
  [3, 16],
  [18, 26],
  [33, 36],
] as const;
const BAR_WIDTH = 12;
const BAR_BASE = 42;
const BAR_RADIUS = 3.5;

/* Carregamentos montados e palco em andamento. Um carregamento que entra sob
   o palco não cria outro ao sair. */
let mountedLoadings = 0;
let activeStage: HTMLElement | null = null;
let revealWhenClear: (() => void) | null = null;

/** Um carregamento apareceu. */
export function loadingShown() {
  mountedLoadings += 1;
}

/** Devolve `true` se um palco já cuida da saída. */
export function loadingHidden() {
  mountedLoadings = Math.max(0, mountedLoadings - 1);
  if (!activeStage) return false;
  if (mountedLoadings === 0) revealWhenClear?.();
  return true;
}

/** Tempo para as barras terminarem de subir. */
const SETTLE_MS = 280;
const REVEAL_MS = 950;

/** As três barras em pixels da tela, para o recorte do véu. */
function barsAt(rect: DOMRect) {
  const k = rect.width / 48;
  return BARS.map(
    ([x, height]) =>
      `<rect x="${(rect.left + x * k).toFixed(2)}" y="${(rect.top + (BAR_BASE - height) * k).toFixed(2)}" width="${(BAR_WIDTH * k).toFixed(2)}" height="${(height * k).toFixed(2)}" rx="${(BAR_RADIUS * k).toFixed(2)}" fill="#000" filter="url(#vetra-exit-soft)"/>`,
  ).join('');
}

/** Onde cada barra do carregamento está agora (a Subida as anima). */
function liveBars(source?: Element | null) {
  return [...(source?.querySelectorAll?.('.bl-bar') ?? [])].map((bar) => {
    const style = getComputedStyle(bar);
    return { transform: style.transform, opacity: style.opacity };
  });
}

export function playLoadingExit(
  rect: DOMRect,
  options: { source?: Element | null } = {},
) {
  if (typeof window === 'undefined' || rect.width <= 0) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const origin = `${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px`;

  const stage = document.createElement('div');
  stage.className = 'vetra-loading-exit';
  stage.setAttribute('aria-hidden', 'true');
  stage.style.setProperty('--reveal', `${REVEAL_MS}ms`);

  // Véu: tela inteira menos as barras; o retângulo excede a tela para cobrir
  // quando ampliado.
  const pad = Math.max(width, height) * 2;
  const veil = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  veil.setAttribute('class', 'vetra-loading-exit-veil');
  // Três vezes a tela, para cobrir as bordas quando encolhe a 0,9.
  veil.setAttribute(
    'viewBox',
    `${-width} ${-height} ${width * 3} ${height * 3}`,
  );
  veil.setAttribute('preserveAspectRatio', 'none');
  veil.style.left = `${-width}px`;
  veil.style.top = `${-height}px`;
  veil.style.width = `${width * 3}px`;
  veil.style.height = `${height * 3}px`;
  veil.style.transformOrigin = `${rect.left + rect.width / 2 + width}px ${rect.top + rect.height / 2 + height}px`;
  // Esfumado só no recorte, numa máscara: no véu inteiro o navegador baixava a
  // resolução e o app vazava nas bordas.
  const blur = (rect.width / 90).toFixed(2);
  veil.innerHTML = `<defs><filter id="vetra-exit-soft" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="${blur}"/></filter><mask id="vetra-exit-hole" maskUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${width + pad * 2}" height="${height + pad * 2}"><rect x="${-pad}" y="${-pad}" width="${width + pad * 2}" height="${height + pad * 2}" fill="#fff"/>${barsAt(rect)}</mask></defs><rect x="${-pad}" y="${-pad}" width="${width + pad * 2}" height="${height + pad * 2}" mask="url(#vetra-exit-hole)" style="fill:var(--background)"/>`;

  // Logo: as barras no mesmo lugar e tamanho do carregamento.
  const layer = document.createElement('div');
  layer.className = 'vetra-loading-exit-mark';
  layer.style.transformOrigin = origin;
  const box = document.createElement('div');
  box.className = 'vetra-loading-exit-box';
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  box.innerHTML = `<span class="bl" data-v="still" style="font-size:${rect.width / 48}px">${BARS.map(
    (_, index) =>
      `<span class="bl-bar${index === 2 ? ' bl-solid' : ''}"></span>`,
  ).join('')}</span>`;
  layer.append(box);

  stage.append(veil, layer);
  document.body.append(stage);

  // As barras terminam de subir de onde o carregamento as deixou.
  const from = liveBars(options.source);
  box.querySelectorAll('.bl-bar').forEach((bar, index) => {
    const start = from[index];
    if (!start?.transform || start.transform === 'none') return;
    bar.animate(
      [
        { transform: start.transform, opacity: start.opacity },
        { transform: 'none', opacity: 1 },
      ],
      { duration: SETTLE_MS, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' },
    );
  });

  activeStage = stage;
  const reveal = () => {
    // Outro carregamento entrou por baixo: o palco espera o último sair.
    if (mountedLoadings > 0) {
      revealWhenClear = reveal;
      return;
    }
    revealWhenClear = null;
    stage.classList.add('is-revealing');
    window.setTimeout(() => {
      stage.remove();
      if (activeStage === stage) activeStage = null;
    }, REVEAL_MS + 80);
  };
  window.setTimeout(reveal, SETTLE_MS);
}
