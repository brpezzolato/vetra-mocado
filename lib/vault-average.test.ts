import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { PiggyBank, SnapshotRow, TransactionRow } from './domain';
import { averageDailyRate, averageProjectedBalance } from './vault-average';

const now = new Date('2026-11-16T15:00:00Z');
const snap = (date: string, net: string): SnapshotRow => ({
  id: date,
  user_id: 'u',
  piggy_bank_id: 'p',
  snapshot_date: date,
  gross_balance: net,
  net_balance: net,
  source: 'pluggy',
  created_at: `${date}T12:00:00Z`,
});
const move = (
  date: string,
  kind: 'deposit' | 'withdrawal',
  amount: string,
): TransactionRow => ({
  id: `${date}-${kind}`,
  user_id: 'u',
  piggy_bank_id: 'p',
  kind,
  amount,
  occurred_at: `${date}T12:00:00-03:00`,
  note: null,
  created_at: date,
  updated_at: date,
});
const bank = (
  snapshots: SnapshotRow[],
  transactions: TransactionRow[] = [],
): PiggyBank => ({ snapshots, transactions }) as unknown as PiggyBank;

describe('taxa média do cofrinho', () => {
  it('um intervalo só: repete o último dia', () => {
    const rate = averageDailyRate(
      bank([snap('2026-11-12', '1000.00'), snap('2026-11-13', '1000.50')]),
      now,
    );
    expect(rate?.toFixed(6)).toBe('0.000500');
  });

  it('fim de semana conta como dia e não rende', () => {
    // Sexta → segunda: R$ 1,50 em 3 dias corridos.
    const rate = averageDailyRate(
      bank([snap('2026-11-13', '1000.00'), snap('2026-11-16', '1001.50')]),
      now,
    );
    expect(rate?.toFixed(6)).toBe('0.000500');
  });

  it('soma os dias e desconta depósitos e retiradas', () => {
    const rate = averageDailyRate(
      bank(
        [
          snap('2026-11-10', '1000.00'),
          snap('2026-11-11', '1000.50'),
          // Depósito de 500 no dia 12: rendeu 0,50.
          snap('2026-11-12', '1501.00'),
          // Retirada não registrada: fica de fora.
          snap('2026-11-13', '1300.00'),
        ],
        [move('2026-11-12', 'deposit', '500')],
      ),
      now,
    );
    // (0,50 + 0,50) ÷ (1000 + 1000,50).
    expect(rate?.toFixed(7)).toBe(new Decimal(1).div(2000.5).toFixed(7));
  });

  it('ignora o que é mais velho que 30 dias', () => {
    const rate = averageDailyRate(
      bank([
        snap('2026-09-01', '1000.00'),
        snap('2026-09-02', '1010.00'),
        snap('2026-11-12', '1000.00'),
        snap('2026-11-13', '1000.30'),
      ]),
      now,
    );
    expect(rate?.toFixed(6)).toBe('0.000300');
  });

  it('sem intervalo para medir, null', () => {
    expect(
      averageDailyRate(bank([snap('2026-11-13', '1000')]), now),
    ).toBeNull();
  });
});

describe('saldo previsto pela média', () => {
  const b = bank(
    [snap('2026-11-12', '1000.00'), snap('2026-11-13', '1000.50')],
    [move('2026-11-15', 'deposit', '100')],
  );
  const rate = new Decimal('0.0005');

  it('rende a taxa por dia corrido sobre o último saldo e o que entrou', () => {
    // 3 dias depois de 13/11, com o depósito de 15/11.
    expect(averageProjectedBalance(b, rate, '2026-11-16')?.toFixed(2)).toBe(
      new Decimal('1100.50').mul(new Decimal('1.0005').pow(3)).toFixed(2),
    );
  });

  it('até o último saldo do banco não prevê', () => {
    expect(averageProjectedBalance(b, rate, '2026-11-13')).toBeNull();
    expect(averageProjectedBalance(b, null, '2026-11-16')).toBeNull();
  });
});

describe('dados tortos do banco', () => {
  it('saldo sem o depósito do próprio dia conta o depósito no intervalo seguinte', () => {
    // 13/11: saldo 942,16 ainda sem os 295 depositados no dia (Itaú).
    const rate = averageDailyRate(
      bank(
        [snap('2026-11-13', '942.16'), snap('2026-11-16', '1238.50')],
        [move('2026-11-13', 'deposit', '295')],
      ),
      now,
    );
    // (1238,50 − 1237,16) ÷ (1237,16 × 3).
    expect(rate?.toFixed(8)).toBe(
      new Decimal('1.34').div(new Decimal('1237.16').mul(3)).toFixed(8),
    );
  });

  it('salto sem lançamento não vira rendimento', () => {
    expect(
      averageDailyRate(
        bank([snap('2026-11-12', '1000.00'), snap('2026-11-13', '1500.00')]),
        now,
      ),
    ).toBeNull();
  });
});

describe('sem rendimento ainda', () => {
  it('saldos iguais são falta de histórico, não taxa zero', () => {
    expect(
      averageDailyRate(
        bank([snap('2026-11-14', '2346.42'), snap('2026-11-15', '2346.42')]),
        now,
      ),
    ).toBeNull();
  });
});
