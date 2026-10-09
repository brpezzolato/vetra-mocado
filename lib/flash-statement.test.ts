import { describe, expect, it } from 'vitest';
import {
  cleanFlashMerchant,
  flashExternalId,
  parseFlashStatement,
  suggestFlashCategory,
  summarizeFlashStatement,
} from './flash-statement';

/** Shaped exactly like a Flash export — newest first, quoted money with a
 * thousands dot and a decimal comma, and the awkward rows a real statement
 * carries. The figures are invented: a real statement is somebody's spending
 * history and does not belong in a repository. */
const STATEMENT = `Data,Hora,Movimentação,Valor,Meio de Pagamento,Saldo
16/09/2026,12:47,99* SAO PAULO BRA,"-R$ 5,80",Cartão,"R$ 0,50"
12/09/2026,17:00,DL*UberRides SAO PAULO BRA,"-R$ 7,93",Cartão,"R$ 6,30"
12/09/2026,13:53,DL*UberRides SAO PAULO BRA,"-R$ 22,95",Cartão,"R$ 14,23"
10/09/2026,17:07,METRO*1T260910-37BV SAO PAULO BRA,"-R$ 5,40",Cartão,"R$ 37,18"
10/09/2026,07:34,EMV CPTM*143255158 SAO PAULO BRA,"-R$ 5,40",Cartão,"R$ 42,58"
04/09/2026,18:34,SONDA SAO CAETANO II SAO CAETANO D BRA,"-R$ 24,57",Cartão,"R$ 47,98"
24/08/2026,13:16,UBER *ONE MEMBERSHIP UBER SAO PAULO BRA,"-R$ 12,90",Cartão,"R$ 72,55"
24/08/2026,12:16,Depósito transferido,"R$ 1.085,45",Depósito,"R$ 85,45"
20/08/2026,09:34,UBER SHOPPER STATEMENT SAO PAULO BR,"-R$ 0,00",Cartão,"R$ 1,13"
`;

describe('reading a Flash statement', () => {
  const statement = parseFlashStatement(STATEMENT);

  it('keeps every row that moved money', () => {
    expect(statement.movements).toHaveLength(8);
    expect(statement.skipped).toEqual([
      {
        line: 10,
        raw: '20/08/2026,09:34,UBER SHOPPER STATEMENT SAO PAULO BR,-R$ 0,00,Cartão,R$ 1,13',
        reason: 'Movimentação de R$ 0,00.',
      },
    ]);
  });

  it('reads Brazilian money, including the thousands separator', () => {
    const deposit = statement.movements.find(
      (movement) => movement.entryType === 'income',
    );
    expect(deposit?.amount).toBe('1085.45');
    expect(deposit?.description).toBe('Depósito Flash');
  });

  it('puts the São Paulo wall clock on the right instant', () => {
    // 12:47 in São Paulo is 15:47 UTC, and the offset is a constant because
    // Brazil has had no daylight saving since 2019.
    expect(statement.movements[0].occurredAt).toBe('2026-09-16T15:47:00.000Z');
    expect(statement.movements[0].date).toBe('2026-09-16');
  });

  it('takes the balance from the most recent row only', () => {
    expect(statement.closingBalance).toEqual({
      amount: '0.50',
      date: '2026-09-16',
      occurredAt: '2026-09-16T15:47:00.000Z',
    });
  });

  it('gives every row an id that survives a second import', () => {
    const ids = statement.movements.map((movement) => movement.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    // The two Uber rides on the same day differ only by time and amount.
    expect(ids).toContain(
      'flash|2026-09-12|17:00|-|7.93|dl*uberrides sao paulo bra',
    );
    expect(
      parseFlashStatement(STATEMENT).movements.map((m) => m.externalId),
    ).toEqual(ids);
  });

  it('adds up what the import will create', () => {
    expect(summarizeFlashStatement(statement.movements)).toEqual({
      count: 8,
      spent: '84.95',
      received: '1085.45',
      firstDay: '2026-08-24',
      lastDay: '2026-09-16',
    });
  });
});

describe('the balance column', () => {
  it('counts the rows where it does not reconcile instead of trusting it', () => {
    // Flash reprints the previous balance on a pre-authorised ride, so the
    // column is not a reliable running total. The parser reports how often it
    // disagrees rather than pretending it agrees.
    const withStaleBalance = `Data,Hora,Movimentação,Valor,Meio de Pagamento,Saldo
02/09/2026,10:00,DL*UberRides SAO PAULO BRA,"-R$ 10,00",Cartão,"R$ 90,00"
01/09/2026,10:00,DL*UberRides SAO PAULO BRA,"-R$ 25,00",Cartão,"R$ 90,00"
01/09/2026,09:00,SONDA SAO CAETANO II SAO CAETANO D BRA,"-R$ 15,00",Cartão,"R$ 115,00"
`;
    const parsed = parseFlashStatement(withStaleBalance);
    expect(parsed.balanceMismatches).toBe(1);
    expect(parsed.closingBalance?.amount).toBe('90.00');
  });

  it('reconciles cleanly when the statement is well behaved', () => {
    expect(parseFlashStatement(STATEMENT).balanceMismatches).toBe(0);
  });
});

describe('merchant names', () => {
  it('collapses the per-trip codes transit and ride-hailing add', () => {
    expect(cleanFlashMerchant('METRO*1T260910-37BV SAO PAULO BRA')).toBe(
      'Metrô de São Paulo',
    );
    expect(cleanFlashMerchant('METRO*1T260827-SN1F SAO PAULO BRA')).toBe(
      'Metrô de São Paulo',
    );
    expect(cleanFlashMerchant('EMV CPTM*143255158 SAO PAULO BRA')).toBe('CPTM');
    expect(cleanFlashMerchant('DL*UberRides SAO PAULO BRA')).toBe('Uber');
    expect(cleanFlashMerchant('99* SAO PAULO BRA')).toBe('99');
  });

  it('drops the city and country the card network appends', () => {
    expect(cleanFlashMerchant('GIOVANNA PIZZARIA SAO CAETANO D BRA')).toBe(
      'Giovanna Pizzaria',
    );
    expect(cleanFlashMerchant('CARREFOUR VILA MARIANA SAO PAULO BRA')).toBe(
      'Carrefour Vila Mariana',
    );
  });

  it('keeps roman numerals and lowercases connectives', () => {
    expect(cleanFlashMerchant('SONDA SAO CAETANO II SAO CAETANO D BRA')).toBe(
      'Sonda Sao Caetano II',
    );
    expect(cleanFlashMerchant('EMPORIO DE CARNES SAO SAO CAETANO D BRA')).toBe(
      'Emporio de Carnes Sao',
    );
  });

  it('leaves a merchant that already has its own casing alone', () => {
    expect(cleanFlashMerchant('BotecoCapitaoLtda SAO PAULO BRA')).toBe(
      'BotecoCapitaoLtda',
    );
  });
});

describe('categories', () => {
  it('sorts transit and ride-hailing into Transporte', () => {
    for (const merchant of [
      'METRO*1T260910-37BV SAO PAULO BRA',
      'EMV CPTM*143255158 SAO PAULO BRA',
      'DL*UberRides SAO PAULO BRA',
      '99* SAO PAULO BRA',
    ])
      expect(suggestFlashCategory(merchant)).toBe('Transporte');
  });

  it('sorts food into Alimentação', () => {
    for (const merchant of [
      'SONDA SAO CAETANO II SAO CAETANO D BRA',
      'PANIFICADORA LINDO PAO SAO CAETANO D BRA',
      'OXXO AMAROI SAO CAETANO D BRA',
      'GIOVANNA PIZZARIA SAO CAETANO D BRA',
    ])
      expect(suggestFlashCategory(merchant)).toBe('Alimentação');
  });

  it('não devolve nenhuma categoria além das duas que nomeiam um saldo', () => {
    // A regra é do cartão: ele tem dois saldos, então só existem duas
    // respostas. Antes isto devolvia cinco categorias, e as três extras não
    // nomeavam saldo nenhum — a compra caía fora dos dois e o dinheiro sumia.
    for (const merchant of [
      'COMERCIO XYZ LTDA',
      'DROGASIL SAO PAULO BRA',
      'CINEMARK SAO CAETANO BRA',
      'PARK SHOPPING SAO CAET BRA',
      'UBER *ONE MEMBERSHIP UBER SAO PAULO BRA',
      '',
    ])
      expect(['Transporte', 'Alimentação']).toContain(
        suggestFlashCategory(merchant),
      );
  });

  it('manda para alimentação tudo que não for 99, Uber ou metrô', () => {
    for (const merchant of [
      'COMERCIO XYZ LTDA',
      'DROGASIL SAO PAULO BRA',
      'PARK SHOPPING SAO CAET BRA',
      'METROPOLE CALCADOS SAO PAULO BRA',
    ])
      expect(suggestFlashCategory(merchant)).toBe('Alimentação');
  });

  it('reconhece o metrô COM acento, que é como o extrato grava', () => {
    // O `` do JavaScript só conhece letras ASCII, então "ô" não é letra para
    // ele e `metr[oô]` nunca casava com a grafia acentuada. Toda viagem de
    // metrô saía do saldo de comida enquanto os testes, escritos com o
    // `METRO*` sem acento, passavam.
    expect(suggestFlashCategory('Metrô de São Paulo')).toBe('Transporte');
    expect(suggestFlashCategory('Metro de Sao Paulo')).toBe('Transporte');
  });

  it('não confunde "metropole" com metrô', () => {
    // Sem a fronteira depois de `metr[oô]` uma loja de calçados viraria
    // catraca e o gasto sairia do saldo errado.
    expect(suggestFlashCategory('METROPOLE CALCADOS')).toBe('Alimentação');
    expect(suggestFlashCategory('METRO*1T260910-37BV')).toBe('Transporte');
  });
});

describe('a statement that is not a Flash statement', () => {
  it('says so instead of importing nothing in silence', () => {
    const parsed = parseFlashStatement('a,b,c\n1,2,3\n');
    expect(parsed.movements).toEqual([]);
    expect(parsed.skipped[0].reason).toMatch(/Cabeçalho não reconhecido/);
  });
});

describe('external ids', () => {
  it('separates a credit from a debit of the same size', () => {
    const base = {
      date: '2026-09-16',
      time: '12:47',
      rawDescription: 'X',
      amount: '5.80',
    };
    expect(flashExternalId({ ...base, entryType: 'expense' })).not.toBe(
      flashExternalId({ ...base, entryType: 'income' }),
    );
  });

  it('stays within the column the database allows', () => {
    const id = flashExternalId({
      date: '2026-09-16',
      time: '12:47',
      rawDescription: 'X'.repeat(400),
      amount: '5.80',
      entryType: 'expense',
    });
    expect(id.length).toBeLessThanOrEqual(160);
  });
});

describe('as formas em que cada transporte chega', () => {
  it('reconhece o Uber em todas as formas que a rede imprime', () => {
    for (const merchant of [
      'DL*UberRides SAO PAULO BRA',
      'UBER *ONE MEMBERSHIP UBER SAO PAULO BRA',
      'UBER SHOPPER STATEMENT SAO PAULO BRA',
      'Uber',
    ])
      expect(suggestFlashCategory(merchant)).toBe('Transporte');
  });

  it('não lê Uberlândia como corrida', () => {
    expect(suggestFlashCategory('PADARIA UBERLANDIA MG BRA')).toBe(
      'Alimentação',
    );
  });

  it('reconhece o 99 solto e com o asterisco da rede', () => {
    expect(suggestFlashCategory('99* SAO PAULO BRA')).toBe('Transporte');
    expect(suggestFlashCategory('99')).toBe('Transporte');
  });
});
