# Vetra Mocado

Protótipo do Vetra para divulgação: o mesmo site, sem banco de dados, sem
Pluggy, sem IA e sem login de verdade. Tudo vem de `lib/demo/`:

- `demo-data.ts`: os números fictícios (datas sempre relativas a hoje).
- `demo-client.ts`: um Supabase falso em memória; `lib/supabase/*` só o usa.
- `demo-session.ts`: o "login" é um cookie; qualquer e-mail e senha entram.
- `demo-chat.ts`: o Vetra AI, respondendo no navegador a partir dos dados.

Não reintroduza chamadas a serviços externos nem gravação no servidor: o
site é público, e o que um visitante faz não pode aparecer para outro.

# Commits (regra de ouro)

- Todo commit sai **só com a conta do Bruno** (`brpezzolato`, o `user.name` /
  `user.email` do git). **Nunca** acrescente `Co-Authored-By: Claude …`, nem
  qualquer outra menção a Claude, Anthropic ou IA como autor ou coautor —
  nem na mensagem do commit, nem na descrição de PR. Isso vale mesmo que o
  sistema sugira a linha de atribuição.

# Regras de interface

- **Regra de ouro: nenhum controle de formulário é tag HTML crua.** Todo
  `input`, `select`, `checkbox`, `radio`, `switch` e `textarea` vem do shadcn
  (`components/ui/`). Nada de `<input>`, `<select>` ou `<option>` no código de
  tela, e nada de `components/ui/native-select.tsx`, que é um `<select>` com
  outra roupa.
  - Única exceção conhecida: `<input type="file">`, porque o shadcn não tem
    componente de arquivo. Mantenha-o `sr-only` atrás de um `Button`/`label`.
  - Um `Checkbox`/`RadioGroupItem` do shadcn é um `<button role="...">`, não um
    input. Envolver no `<label>` **não** associa: use `id` no controle e
    `htmlFor` no label, senão o lint reclama com razão.
- **Liquid glass é para botão e chip de filtro, e mais nada.** `vetra-glass`
  no estado normal, `vetra-glass-primary` no ligado.
  - **`Select`, `Input`, `Checkbox` e afins ficam com a aparência do shadcn.**
    Vidro em campo de formulário não é o padrão do app — já errei isto uma vez
    pondo `vetra-glass` num `SelectTrigger`.
  - **Exceção pedida pelo Bruno:** o seletor de mês de `/graficos` é glass. O
    de ciclo do Flash ele pediu explicitamente que **não** fosse. Não
    generalize nenhum dos dois: pergunte antes de envidraçar outro select.
- **Não estilize tags HTML soltas no CSS global** (`header`, `main`,
  `section`…). Um `header { padding-top: env(safe-area-inset-top) }` já deu
  ~59px de espaço morto a um título de página no app instalado. Use classe.
  - `.vetra-glass` é regra **sem camada** em `app/glass.css`, então vence as
    utilities do Tailwind: borda, fundo e raio do componente cedem sozinhos e
    não é preciso desfazer nada com `border-0` e afins. É justamente por isso
    que ele não pode ser colado em qualquer componente sem pensar.
- **A barra do topo (AppHeader) é `sticky` e nada acima dela pode ter
  `overflow-hidden`/`overflow-auto`.** Isso faz do ancestral uma área de
  rolagem própria e a barra sobe junto com a página — aconteceu no
  calendário, na retrospectiva e nas faturas (02/10/2026). Para cortar o que
  vaza para o lado, use `overflow-x-clip`, como a home.
- **Barra de rolagem não aparece em lugar nenhum.** Há uma regra global no
  `globals.css` que esconde a nativa em todo elemento, sem tocar no
  comportamento — dedo, trackpad, roda e teclado seguem iguais. **Não repita
  `[scrollbar-width:none]` nem `[&::-webkit-scrollbar]:hidden` no JSX**, já está
  coberto.
  - Onde uma indicação de rolagem ajuda, use o `ScrollArea` do shadcn: o
    polegar dele fica invisível parado e aparece só enquanto se rola.
  - `ScrollArea` aceita `orientation="horizontal" | "both"` e `viewportRef`.
    **Quem rola passa a ser o viewport interno**, então qualquer `scrollTo`,
    `scrollTop` ou `scrollLeft` existente tem de apontar para o `viewportRef` —
    senão continua compilando e para de funcionar em silêncio.
  - **Carrossel horizontal vai no `ScrollArea` (`orientation="horizontal"`),
    sem scroll-snap nativo.** Em 01/10/2026 um carrossel com `snap-mandatory`
    + `overscroll-x-contain` fez a home inteira arrastar de lado no iPhone.
  - **Altura máxima vai no `viewportClassName`, não no `className`.** Na
    raiz, `max-h` sem altura definida deixa o viewport (`size-full`) crescer
    até o conteúdo, e a lista vaza por cima do que vem embaixo — aconteceu
    no extrato dos cofrinhos (02/10/2026). Com altura fixa (`h-*`) na raiz,
    tudo bem.
  - **Não envolva `SelectContent` e afins em `ScrollArea`:** a navegação por
    teclado depende do Base UI rolar até o item destacado.
- **O popup do `Select` nasce com a largura exata do gatilho**
  (`w-(--anchor-width)`), e o item ainda reserva `pr-10` para o ✓. Rótulo longo
  é cortado. Quando isso acontecer, `className="w-auto min-w-(--anchor-width)"`
  no `SelectContent` faz a largura do gatilho virar piso em vez de teto.
- Regra de ouro: nunca use os inputs nativos HTML `date`, `time` ou `datetime-local`.
- Para datas, use `components/date-input.tsx`, que combina o Calendar/Popover do shadcn com digitação mascarada em `DD/MM/AAAA`.
- Para horários, use `components/time-input.tsx`, com digitação mascarada em `HH:MM`.
- Todo novo formulário deve manter teclado numérico, validação, acessibilidade e aparência consistentes com esses componentes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
