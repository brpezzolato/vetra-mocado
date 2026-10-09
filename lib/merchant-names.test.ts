import { describe, expect, it } from 'vitest';
import { normalizeMerchant } from './merchant-names';

describe('um nome por lugar', () => {
  // Cada grupo é o mesmo lugar, com as grafias encontradas no banco em
  // 24/09/2026. Todas têm de chegar ao mesmo nome.
  const same: [string, string[]][] = [
    [
      'Metrô de São Paulo',
      ['Metrô de São Paulo', 'METRO*1T260918-Whhv', 'METRO*1T260917-8J6K'],
    ],
    ['CPTM', ['CPTM', 'Emv Cptm*145277044', 'Emv Cptm*144971874']],
    ['99', ['99', '99 Ride', '99* SAO PAULO BRA']],
    ['Uber', ['Uber', 'DL*UberRides SAO PAULO BRA', 'Uber Shopper Statement']],
    [
      'Uber One',
      [
        'Uber One',
        'Uber - Assinatura',
        'UBER *ONE MEMBERSHIP UBER SAO PAULO BRA',
      ],
    ],
    ['Drogasil', ['Drogasil', 'Drogasil1319', 'Drogasil 4060']],
    [
      'Carrefour',
      ['Carrefour Xam', 'Carrefour Vila Mariana', 'Carrefour Express Hum'],
    ],
    ['Oxxo', ['Oxxo Amaroi', 'OXXO - Amaroi', 'Oxxo Vila Mariana']],
    ['Sonda', ['Sonda Supermercados', 'Sonda Sao Caetano II']],
    [
      'Cinemark',
      ['Cinemark', 'Cinemark Sao Caetano', 'Cinemark Brasil S.A Ec'],
    ],
    ['Mercado Livre', ['Mercado Livre', 'Mercado Livre - One Blade']],
    [
      'Boteco Capitão',
      ['Boteco Capitão', 'Botecocapitaoltda', 'BotecoCapitaoLtda'],
    ],
    [
      'Paralelo 17',
      ['Lanchonete Paralelo 17 Ltda ME', 'Paralelo', 'Paralelo 17'],
    ],
    ['Cozinha da Vila', ['Cozinha da Vila Restau', 'Cozinha Da Villa']],
    [
      'Panificadora Lindo Pão',
      ['Panificadora Lindo Pão', 'Panificadora Lindo Pao'],
    ],
  ];
  for (const [canonical, spellings] of same)
    it(`junta ${canonical}`, () => {
      for (const spelling of spellings)
        expect(normalizeMerchant(spelling), spelling).toBe(canonical);
    });

  it('reconhece a lavanderia pela maquininha 579, e só por ela', () => {
    expect(normalizeMerchant('VMT* 579 - Bar')).toBe('Lavanderia');
    expect(normalizeMerchant('VMT*579 - Bar')).toBe('Lavanderia');
    expect(normalizeMerchant('579 - Bar')).toBe('Lavanderia');
    // Outro estabelecimento na mesma adquirente continua com o próprio nome.
    expect(normalizeMerchant('VMT* 812 - Padaria')).toBe('VMT* 812 - Padaria');
  });

  it('junta a Nadafit ao iFood, e só ela', () => {
    expect(normalizeMerchant('Ifd*Nadafit Industria')).toBe('Ifood');
    expect(normalizeMerchant('Ifd*Quintal Del Carmem')).toBe(
      'Ifd*Quintal Del Carmem',
    );
  });

  it('não junta o que só parece igual', () => {
    // Corrida e assinatura são coisas diferentes; pedidos do iFood são
    // restaurantes diferentes; "mercado" no nome não faz dois lugares um só.
    expect(normalizeMerchant('Uber')).not.toBe(normalizeMerchant('Uber One'));
    for (const name of [
      'Ifd*Quintal Del Carmem',
      'Bettriz Mercado',
      'Dia - Mercado',
      'Dia ICL - Pix pro Léo',
      'Pix Bia - Frete',
      'Metropole Calcados',
      '999 Utilidades',
      'Uberlandia Tintas',
    ])
      expect(normalizeMerchant(name), name).toBe(name);
  });

  it('tira a forma jurídica do fim do nome, e só dela', () => {
    expect(normalizeMerchant('Mia Cucina Ltda')).toBe('Mia Cucina');
    expect(normalizeMerchant('Mg Farma Mercantil Ltd')).toBe(
      'Mg Farma Mercantil',
    );
    expect(normalizeMerchant('Sorv Sorveteria Ltda')).toBe('Sorv Sorveteria');
    // "Me" dentro do nome não é forma jurídica.
    expect(normalizeMerchant('Meu Mercadinho')).toBe('Meu Mercadinho');
  });

  it('nunca devolve vazio', () => {
    expect(normalizeMerchant('  Ltda ')).toBe('Ltda');
    expect(normalizeMerchant('   ')).toBe('');
  });

  it('junta os marketplaces num nome só, menos a Amazon Prime', () => {
    expect(normalizeMerchant('Shopee *Aljatec')).toBe('Shopee');
    expect(normalizeMerchant('Shopee*M Wang')).toBe('Shopee');
    expect(normalizeMerchant('AMAZON MARKETPLACE')).toBe('Amazon');
    expect(normalizeMerchant('Pg *Amazon Br')).toBe('Amazon');
    expect(normalizeMerchant('AMZN Mktp BR')).toBe('Amazon');
    expect(normalizeMerchant('Amazon Prime')).toBe('Amazon Prime');
    expect(normalizeMerchant('Ebn *Tiktok Shop')).toBe('TikTok Shop');
    expect(normalizeMerchant('Mercadolivre*Mercadol')).toBe('Mercado Livre');
    expect(normalizeMerchant('Mercado Livre')).toBe('Mercado Livre');
    expect(normalizeMerchant('ALIEXPRESS.COM')).toBe('AliExpress');
    expect(normalizeMerchant('Magazine Luiza')).toBe('Magalu');
    // Não pega pedaço de outra palavra.
    expect(normalizeMerchant('Sheinberg Padaria')).toBe('Sheinberg Padaria');
  });
});
