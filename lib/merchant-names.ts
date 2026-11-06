/**
 * One name per place. The same shop arrives under several spellings
 * (Shortcut raw string, Flash statement, typed by hand); every write path and
 * the learned-category lookup go through this. Chains are one merchant.
 * Kept apart: Uber rides vs Uber One, and iFood restaurants ("Ifd*…").
 */
const KNOWN: [RegExp, string][] = [
  // Uber One before Uber, or the subscription would be read as a ride.
  [/^uber\s*(\*\s*)?one\b|^uber\s*-\s*assinatura\b/i, 'Uber One'],
  [/^uber\s*\*?\s*eats\b/i, 'Uber Eats'],
  [/^(dl\s*\*\s*)?uber\s*(rides|shopper)?\b/i, 'Uber'],
  [/^99\s*food\b/i, '99Food'],
  [/^99(\s*(ride|pop|taxi)\b|\s*\*|$)/i, '99'],
  [/^metr[oô]\s*\*|^metr[oô]\s+de\s+s[aã]o\s+paulo\b/i, 'Metrô de São Paulo'],
  [/^(emv\s+)?cptm\b/i, 'CPTM'],
  [/^drogasil/i, 'Drogasil'],
  [/^drogaria\s*s[aã]o\s*paulo/i, 'Drogaria São Paulo'],
  [/^droga\s*raia\b/i, 'Droga Raia'],
  [/^pague\s*menos\b/i, 'Pague Menos'],
  [/^(drogaria\s*)?pacheco\b/i, 'Drogaria Pacheco'],
  [/^carrefour\b/i, 'Carrefour'],
  [/^oxxo\b/i, 'Oxxo'],
  [/^sonda\b/i, 'Sonda'],
  [/^(minuto\s*)?p[aã]o\s*de\s*a[cç][uú]car\b/i, 'Pão de Açúcar'],
  [/^assa[ií]\b/i, 'Assaí'],
  [/^atacad[aã]o\b/i, 'Atacadão'],
  [/^dia\s+brasil\b/i, 'Dia'],
  [/^st\.?\s*marche\b/i, 'St Marche'],
  [/^hirota\b/i, 'Hirota'],
  [/^cinemark\b/i, 'Cinemark'],
  [/^cin[eé]polis\b/i, 'Cinépolis'],
  [/ingresso\s*\.?\s*com/i, 'Ingresso.com'],
  [/sympla/i, 'Sympla'],
  // Fast food and dessert chains: the store/franchisee name comes after.
  [/^mc\s*donald'?s?\b|^mcdonald/i, "McDonald's"],
  [/^burger\s*king\b|^bk\s+brasil\b/i, 'Burger King'],
  [/^kfc\b/i, 'KFC'],
  [/^subway\b/i, 'Subway'],
  [/^starbucks\b/i, 'Starbucks'],
  [/^spoletto\b/i, 'Spoletto'],
  [/^habib'?s\b/i, "Habib's"],
  [/^outback\b/i, 'Outback'],
  [/^giraffas\b/i, 'Giraffas'],
  [/^madero\b/i, 'Madero'],
  [/^china\s*in\s*box\b/i, 'China in Box'],
  [/^coco\s*bambu\b/i, 'Coco Bambu'],
  [/^oakberry\b/i, 'Oakberry'],
  [/^bacio\s*di\s*latte\b/i, 'Bacio di Latte'],
  [/^cacau\s*show\b/i, 'Cacau Show'],
  [/^kopenhagen\b/i, 'Kopenhagen'],
  [/^swift\b/i, 'Swift'],
  // Stores.
  [/^(lojas\s*)?americanas\b|americanas\s*\.\s*com/i, 'Americanas'],
  [/^casas\s*bahia\b/i, 'Casas Bahia'],
  [/^centauro\b/i, 'Centauro'],
  [/netshoes/i, 'Netshoes'],
  [/^decathlon\b/i, 'Decathlon'],
  [/^(lojas\s*)?renner\b/i, 'Renner'],
  [/^riachuelo\b/i, 'Riachuelo'],
  [/^c\s*&\s*a\b|^cea\s+/i, 'C&A'],
  [/^zara\b/i, 'Zara'],
  [/^kalunga\b/i, 'Kalunga'],
  [/^leroy\s*merlin\b/i, 'Leroy Merlin'],
  [/^petz\b/i, 'Petz'],
  [/^cobasi\b/i, 'Cobasi'],
  [/^kabum\b/i, 'KaBuM!'],
  [/^smart\s*fit\b/i, 'Smart Fit'],
  // Subscriptions and digital stores.
  [/^apple\s*\.\s*com|^apple\s/i, 'Apple'],
  [/netflix/i, 'Netflix'],
  [/spotify/i, 'Spotify'],
  [/disney\s*(plus|\+)/i, 'Disney+'],
  [/^(psn|playstation|sony\s*playstation)\b/i, 'PlayStation'],
  [/^steam(games|powered)?\b/i, 'Steam'],
  [/^(microsoft\s*\*?\s*)?xbox\b/i, 'Xbox'],
  [/^ifood\b|^ifd\s*\*\s*ifood\b/i, 'Ifood'],
  [/^rappi\b/i, 'Rappi'],
  [/^z[eé]\s*delivery\b/i, 'Zé Delivery'],
  [/airbnb/i, 'Airbnb'],
  [/booking\s*\.\s*com/i, 'Booking.com'],
  [/^sem\s*parar\b/i, 'Sem Parar'],
  [/^veloe\b/i, 'Veloe'],
  [/^conectcar\b/i, 'ConectCar'],
  // Marketplaces: o nome do vendedor vem junto e virava lojas diferentes.
  // Casa em qualquer ponto do nome. Amazon Prime é assinatura, à parte.
  [/mercado\s*livre|ebazar/i, 'Mercado Livre'],
  [/shopee/i, 'Shopee'],
  [/amazon\s*\*?\s*prime/i, 'Amazon Prime'],
  [/amazon|amzn/i, 'Amazon'],
  [/tik\s*tok\s*shop/i, 'TikTok Shop'],
  [/aliexpress/i, 'AliExpress'],
  [/\bshein\b/i, 'Shein'],
  [/\btemu\b/i, 'Temu'],
  [/magalu|magazine\s*luiza/i, 'Magalu'],
  // Nadafit counts as iFood; other "Ifd*" restaurants keep their names.
  [/^ifd\s*\*\s*nadafit\b/i, 'Ifood'],
  [/^boteco\s*capit[aã]o/i, 'Boteco Capitão'],
  [/^(lanchonete\s+)?paralelo(\s*17)?\b/i, 'Paralelo 17'],
  [/^cozinha\s+da\s+vil+a\b/i, 'Cozinha da Vila'],
  [/^panificadora\s+lindo\s+p[aã]o\b/i, 'Panificadora Lindo Pão'],
  // Laundry machine: "VMT* 579 - Bar" or "579 - Bar". Pinned to 579.
  [/^vmt\s*\*\s*579\b|^579\s*-\s*bar\b/i, 'Lavanderia'],
];

// Trailing legal form (Ltda, ME…), only as whole words at the end.
const LEGAL_SUFFIX = /(\s+(ltda|ltd|me|epp|eireli|s\.?\s?a\.?|ec))+\.?$/i;

const known = (name: string) =>
  KNOWN.find(([pattern]) => pattern.test(name))?.[1] ?? null;

export function normalizeMerchant(value: string) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return name;
  const canonical = known(name);
  if (canonical) return canonical;
  const cleaned = name.replace(LEGAL_SUFFIX, '').trim();
  // Nothing but a legal form: keep it (the API rejects empty names).
  return cleaned || name;
}

/** Comparação de nomes: sem acento, caixa, espaço nem pontuação. */
export const merchantKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Nome todo em maiúsculas (a bandeira gritando) em caixa de título. */
export const titleCase = (value: string) =>
  value
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLocaleLowerCase('pt-BR');
      // Connectives stay lowercase unless they open the name.
      if (index > 0 && /^(de|da|do|das|dos|e|em|com)$/.test(lower))
        return lower;
      // Roman numerals are part of the brand: "Sonda II", not "Sonda Ii".
      if (/^[IVX]+$/i.test(word) && word.length <= 4) return word.toUpperCase();
      // Sigla sem vogal (KFC, PSN): fica em maiúsculas.
      if (/^[A-Z]{2,4}$/i.test(word) && !/[aeiouy]/i.test(word))
        return word.toUpperCase();
      // Maiúscula também depois de ponto e hífen: "Me.Linda", "Ben-Hur".
      return lower.replace(
        /(^|[.\-/&])(\p{L})/gu,
        (_, mark, letter) => mark + letter.toLocaleUpperCase('pt-BR'),
      );
    })
    .join(' ');

/**
 * Cidades que a bandeira cola no fim do nome ("MEGA FARMASAO CAETANO DBRA").
 * O campo da cidade tem 13 posições no Itaú e 10 no PicPay: vale o nome
 * inteiro ou cortado nesses tamanhos.
 */
const CITIES = [
  'SAO CAETANO DO SUL',
  'SAO PAULO',
  'SANTO ANDRE',
  'SAO BERNARDO DO CAMPO',
  'DIADEMA',
  'MAUA',
  'RIBEIRAO PIRES',
  'GUARULHOS',
  'OSASCO',
  'BARUERI',
  'CARAPICUIBA',
  'COTIA',
  'TABOAO DA SERRA',
  'MOGI DAS CRUZES',
  'SUZANO',
  'JUNDIAI',
  'CAMPINAS',
  'SANTOS',
  'SAO VICENTE',
  'PRAIA GRANDE',
  'GUARUJA',
  'SOROCABA',
  'ITAPEVA',
  'RIBEIRAO PRETO',
  'SAO JOSE DOS CAMPOS',
  'TAUBATE',
  'PIRACICABA',
  'ATIBAIA',
  'VALINHOS',
  'VINHEDO',
  'INDAIATUBA',
  'UBATUBA',
  'CARAGUATATUBA',
  'BERTIOGA',
  'CAMPOS DO JORDAO',
  'RIO DE JANEIRO',
  'NITEROI',
  'BELO HORIZONTE',
  'CURITIBA',
  'PORTO ALEGRE',
  'FLORIANOPOLIS',
  'BRASILIA',
  'GOIANIA',
  'SALVADOR',
  'RECIFE',
  'FORTALEZA',
];
const CITY_TAILS = [
  ...new Set(
    CITIES.flatMap((city) => [
      city,
      city.slice(0, 13).trim(),
      city.slice(0, 10).trim(),
    ]),
  ),
].sort((a, b) => b.length - a.length);

const plain = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();

/** Tira a cidade e o país que a bandeira acrescenta. */
function stripLocation(name: string) {
  // PicPay: "LIMELIGHT .SAO PAULO BRA".
  const dotted = name.replace(/\s+\.\s*[^.]+?\s+BRA?$/i, '').trim();
  if (dotted !== name && dotted) return dotted;
  // Itaú e outros: país no fim, colado ou não, e a cidade antes dele.
  const country = /^(.*?)\s*BRA$/.exec(name);
  if (!country) return name;
  const rest = country[1];
  const upper = plain(rest);
  const tail = CITY_TAILS.find((city) => upper.endsWith(city));
  const base = tail ? rest.slice(0, rest.length - tail.length).trim() : rest;
  // "BRA" colado sem cidade conhecida pode ser parte do nome: fica.
  if (!tail && !/\sBRA$/.test(name)) return name;
  return base.length >= 2 ? base : name;
}

/** "Compra débito Paralelo 17", "Pagamento com Pix Fulano". */
const BANK_WORDING =
  /^(compra\s+(no\s+)?(d[ée]bito|cr[ée]dito)|pagamento\s+com\s+pix|pix\s+(enviado|para))\s*[-:]?\s+/i;
/** Maquininha ou intermediador antes do nome: "Mp *", "PDV*", "JIM.COM*". */
const PROCESSOR = /^[a-z0-9.]{2,10}\s?\*\s*/i;

/**
 * Nome de uma compra como veio do banco, limpo: sem texto do banco, cidade,
 * país, maquininha ou número de loja, com as redes juntadas e sem gritar.
 * Nomes digitados à mão passam só por `normalizeMerchant`.
 */
export function cleanBankMerchant(raw: string) {
  let name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return name;
  // Redes conhecidas antes de tudo: "DL*UberRides", "99*", "Uber *One".
  const first = known(name);
  if (first) return first;
  name = stripLocation(name.replace(BANK_WORDING, ''))
    // CNPJ de MEI antes do nome, às vezes já trocado pela marca de privacidade.
    .replace(/^(\[número oculto\]|\d{2}\.\d{3}\.\d{3})\s+(?=\S)/, '');
  name = name.replace(PROCESSOR, '').trim() || name;
  const second = known(name);
  if (second) return second;
  name = name
    // Número da loja colado ou no fim: "LOJAS 562", "DROGARIA269".
    .replace(/(?<=[a-zà-ú])\s*\d{3,5}$/i, '')
    .replace(/\s+(lj|loja|filial)\.?$/i, '')
    // Conectivo que sobrou do corte do nome: "Cosmeticos E".
    .replace(/\s+(de|da|do|das|dos|e)$/i, '')
    // Palavras grudadas: "PadronPerfumaria".
    .replace(/\S{11,}/g, (word) =>
      word.replace(/([a-zà-ú]{2})([A-ZÀ-Ú])(?=[a-zà-ú])/g, '$1 $2'),
    )
    .trim();
  if (/[A-Za-zÀ-ú]/.test(name) && name === name.toLocaleUpperCase('pt-BR'))
    name = titleCase(name);
  return normalizeMerchant(name);
}
