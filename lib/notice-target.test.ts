import { describe, expect, it } from 'vitest';
import { noticeTarget } from './notifications';

describe('para onde o toque no aviso leva', () => {
  const id = '3f1c2a4e-9b7d-4c1e-8a2b-0d9e8f7a6b5c';

  it('a compra abre o detalhe dela em Lançamentos', () => {
    expect(
      noticeTarget({
        href: '/financeiro',
        event_key: `financial_entries:${id}`,
      }),
    ).toBe(`/financeiro?lancamento=${id}`);
  });

  it('os outros vão à tela do aviso, inclusive Faturas', () => {
    expect(
      noticeTarget({
        href: '/conexoes',
        event_key: 'pluggy-cron:2026-11-04:7',
      }),
    ).toBe('/conexoes');
    expect(
      noticeTarget({ href: '/faturas', event_key: 'pluggy-new-card:abc' }),
    ).toBe('/faturas');
  });

  it('destino fora da lista não abre nada', () => {
    expect(noticeTarget({ href: 'https://exemplo.com' })).toBeNull();
    expect(
      noticeTarget({ href: '/x', event_key: 'financial_entries:nao-e-id' }),
    ).toBeNull();
  });
});
