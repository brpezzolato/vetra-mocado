/* Registrar gasto falando ("Gastei 32 no almoço com a Flash"), com confirmação.
   Lido no aparelho: nada vai para a IA. Exige verbo de gasto e valor;
   perguntas seguem para o Vetra AI. */

export type SpokenMethod =
  'flash' | 'nubank' | 'picpay' | 'itau' | 'mercado-pago' | 'pix';

export type SpokenExpense = {
  /** Em reais, com ponto: "32.00". */
  amount: string;
  description: string;
  method: SpokenMethod | null;
  /** O crédito ou o débito, quando a frase diz. */
  mode: 'credit' | 'debit' | null;
  /** 0 hoje, 1 ontem, 2 anteontem. */
  daysAgo: 0 | 1 | 2;
  /** Pelas palavras óbvias; nulo quando não dá para saber. */
  category: string | null;
};

const plain = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const VERB =
  /^(gastei|paguei|comprei|torrei|gastamos|pagamos|compramos|deixei)$/;
const QUESTION =
  /^(quanto|quantos|quantas|qual|quais|onde|como|quando|porque|por|sera|devo|posso)$/;

const METHODS: [RegExp, SpokenMethod][] = [
  [/^(flash|vale|vr|va)$/, 'flash'],
  [/^(nubank|roxinho|nu)$/, 'nubank'],
  [/^picpay$/, 'picpay'],
  [/^(itau|itaucard)$/, 'itau'],
  [/^pix$/, 'pix'],
];

/** Palavras que só ligam a frase e não fazem parte do nome. */
const FILLER = new Set([
  'no',
  'na',
  'nos',
  'nas',
  'em',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'com',
  'o',
  'a',
  'os',
  'as',
  'um',
  'uma',
  'pelo',
  'pela',
  'via',
  'pra',
  'para',
  'por',
  'cartao',
  'reais',
  'real',
  'conto',
  'contos',
  'pila',
  'hoje',
  'ontem',
  'anteontem',
  'credito',
  'debito',
  'e',
  'r$',
  'agora',
  'mais',
  'so',
]);

const CATEGORY_WORDS: [RegExp, string][] = [
  [
    /almoco|janta|jantar|lanche|cafe|padaria|mercado|restaurante|ifood|pizza|hamburguer|acai|sorvete|comida|marmita|feira|acougue|lanchonete|delivery|cerveja|bebida/,
    'Alimentação',
  ],
  [
    /uber|\b99\b|taxi|metro|onibus|trem|cptm|gasolina|combustivel|estacionamento|pedagio|passagem/,
    'Transporte',
  ],
  [
    /farmacia|remedio|drogaria|medico|consulta|exame|dentista|academia/,
    'Saúde',
  ],
  [/cinema|show|bar|balada|ingresso|jogo|festa|boliche|teatro/, 'Lazer'],
  [/roupa|tenis|loja|presente|shopping|eletronico|celular|fone/, 'Compras'],
  [/aluguel|condominio|luz|agua|internet|gas\b/, 'Moradia'],
  [/curso|livro|escola|faculdade|apostila/, 'Educação'],
  [
    /lavanderia|cabelo|barbeiro|manicure|conserto|costureira|faxina/,
    'Serviços',
  ],
  [/netflix|spotify|assinatura|prime|disney|youtube/, 'Assinaturas'],
];

/** Lê "Gastei 32,50 no almoço com a Flash ontem". Nulo se não for isso. */
export function parseSpokenExpense(text: string): SpokenExpense | null {
  const original = text.trim().replace(/[.!]+$/, '');
  if (!original || original.endsWith('?')) return null;
  const words = original.split(/\s+/);
  const keys = words.map((word) => plain(word).replace(/[,.;:!]+$/, ''));
  if (QUESTION.test(keys[0] ?? '')) return null;
  const verbAt = keys.findIndex((key) => VERB.test(key));
  if (verbAt < 0) return null;

  // O valor: "32", "32,50", "R$ 32", "1.250,00", "R$32".
  let amount: string | null = null;
  let amountAt = -1;
  for (let index = 0; index < keys.length; index++) {
    const match = keys[index]
      .replace(/^r\$/, '')
      .match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/);
    if (!match) continue;
    const reais = match[1].replace(/\./g, '');
    const cents = (match[2] ?? '0').padEnd(2, '0');
    amount = `${Number(reais)}.${cents}`;
    amountAt = index;
    break;
  }
  if (!amount || Number(amount) <= 0) return null;

  let method: SpokenMethod | null = null;
  const methodAt = new Set<number>();
  for (let index = 0; index < keys.length; index++) {
    // "mercado pago" são duas palavras.
    if (keys[index] === 'mercado' && keys[index + 1] === 'pago') {
      method = 'mercado-pago';
      methodAt.add(index).add(index + 1);
      continue;
    }
    for (const [pattern, value] of METHODS)
      if (pattern.test(keys[index])) {
        method = value;
        methodAt.add(index);
      }
  }
  const mode = keys.includes('credito')
    ? 'credit'
    : keys.includes('debito')
      ? 'debit'
      : null;
  const daysAgo = keys.includes('anteontem')
    ? 2
    : keys.includes('ontem')
      ? 1
      : 0;

  // O nome: o que sobra sem verbo, valor, meio e ligação ("almoço").
  const rest = words.filter(
    (_, index) =>
      index !== verbAt &&
      index !== amountAt &&
      !methodAt.has(index) &&
      !(index === amountAt - 1 && keys[index] === 'r$') &&
      !FILLER.has(keys[index]),
  );
  const name = rest
    .join(' ')
    .replace(/[,.;:!]+$/g, '')
    .trim();
  const description = name
    ? name.charAt(0).toLocaleUpperCase('pt-BR') + name.slice(1)
    : 'Gasto';
  const key = plain(description);
  const category =
    CATEGORY_WORDS.find(([pattern]) => pattern.test(key))?.[1] ?? null;
  return { amount, description, method, mode, daysAgo, category };
}
