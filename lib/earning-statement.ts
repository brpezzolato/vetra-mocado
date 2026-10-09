import Decimal from 'decimal.js';
import type { BankEarningCredit } from './domain';
import { isoDate, type EarningEntry } from './finance';

export type StatementEarning = {
  id: string;
  date: string;
  occurredAt?: string;
  confirmed: boolean;
  appliedToBalance?: boolean;
  netAmount: Decimal;
  grossAmount: Decimal | null;
  taxes: Decimal | null;
  iof?: Decimal;
  incomeTax?: Decimal;
  reconciled?: boolean;
  /** Parte de um intervalo entre dois saldos do banco, dividido pelos dias
   * úteis: o total é do banco, a divisão por dia é estimada. */
  distributed?: boolean;
  referenceNetAmount?: Decimal;
  referenceCredits?: BankEarningCredit[];
};

/** Applied MP credits come from the engine ledger itself, not a UI replacement.
 * Other observations remain comparisons. Never infer bank tax from a net credit.
 */
export function mergeEarningStatement(
  estimated: EarningEntry[],
  credits: BankEarningCredit[] = [],
): StatementEarning[] {
  const estimatedDates = new Set(estimated.map((entry) => entry.date));
  const appliedCreditIds = new Set(
    estimated.map((entry) => entry.creditId).filter(Boolean),
  );
  return [
    ...estimated.map((entry) => {
      if (entry.confirmed && entry.creditId)
        return {
          ...entry,
          id: `confirmed-${entry.creditId}`,
          confirmed: true,
          appliedToBalance: true,
          grossAmount: null,
          taxes: null,
          iof: undefined,
          incomeTax: undefined,
        };
      const referenceCredits = credits.filter(
        (credit) =>
          !appliedCreditIds.has(credit.id) &&
          isoDate(new Date(credit.occurred_at)) === entry.date,
      );
      return {
        ...entry,
        id: `estimated-${entry.date}`,
        confirmed: false,
        referenceCredits,
        referenceNetAmount: referenceCredits.length
          ? referenceCredits.reduce(
              (sum, credit) => sum.plus(credit.net_amount),
              new Decimal(0),
            )
          : undefined,
      };
    }),
    ...credits
      .filter(
        (credit) =>
          !appliedCreditIds.has(credit.id) &&
          !estimatedDates.has(isoDate(new Date(credit.occurred_at))),
      )
      .map((credit) => ({
        id: credit.id,
        date: isoDate(new Date(credit.occurred_at)),
        occurredAt: credit.occurred_at,
        confirmed: true,
        netAmount: new Decimal(credit.net_amount),
        grossAmount: null,
        taxes: null,
      })),
  ];
}
