import { describe, expect, it } from 'vitest';
import {
  simulatePurchaseInvoices,
  splitInstallments,
} from './purchase-simulator';

describe('purchase simulator', () => {
  it('preserves cents when splitting installments', () => {
    expect(splitInstallments('100.00', 3)).toEqual(['33.34', '33.33', '33.33']);
  });

  it('places installments in consecutive invoices', () => {
    expect(
      simulatePurchaseInvoices({
        total: '90',
        installments: 3,
        purchaseDate: '2026-09-16',
        cycle: {
          account: 'Nubank',
          kind: 'credit',
          closing_day: 29,
          due_day: 6,
        },
      }).map((item) => item.due),
    ).toEqual(['2026-10-06', '2026-11-06', '2026-12-06']);
  });
});
