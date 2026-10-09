> **08/10/2026:** a logo do Vetra passou a ser "Última acesa": três barras
> crescentes, no acabamento "Última sólida" (as duas primeiras de vidro
> fosco, a última sólida com reflexo), desenho próprio. Substituiu o símbolo
> "Área" (gráfico de área em duas camadas).
>
> Os arquivos (`vetra-mark-{sm,md}-{dark,light}.png`,
> `vetra-favicon-{dark,light}.png`, `vetra-icon-180.png`,
> `vetra-icon-512.png` e o símbolo em `public/og.png`) são **prints** da
> opção B da prévia HTML que o Bruno aprovou: o mesmo CSS (`.mark` e `.b`),
> renderizado no Chrome (puppeteer-core) com fundo transparente, a 8x. A
> versão "light" é a mesma com `filter: invert(1)`, como a prévia fazia no
> fundo claro. `sm` sai com `--s: 0.6px` (barra do topo), `md` com `1.15px`
> (ícone) e o ícone do app na caixa de 76 px com fundo #0b0b0b. Para
> refazer, renderize de novo com o mesmo CSS; não redesenhe à mão.
>
> **01/10/2026:** o porco de gravata deixou de ser a logo do Vetra. A logo
> passou a ser o símbolo "Área", desenho próprio. O porco de gravata (`vetra-pig-ui.webp`) ficou **só** no
> cofrinho "Dinheiro geral" (vault-cards), a pedido do Bruno. O porquinho
> pastel (`vetra-ai-pig.webp`) continua como mascote do Vetra AI. Sem uso:
> os `vetra_porco_*.png`.

# Logos

## `vetra-ai-pig.webp`

Mascote do Vetra AI, escolhido pelo Bruno em 30/09/2026. É o "Pig face" 3D
do [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) da Microsoft,
recortado nas bordas transparentes, centralizado e reduzido para 128×128 em
WebP. O desenho não foi alterado; a animação é feita pelo app, em CSS.

Licença do original:

```
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE
```

A versão animada do mesmo porquinho (Microsoft Teams) **não** foi usada: o
repositório que a distribui é "Personal Use Only", com direitos reservados à
Microsoft.
