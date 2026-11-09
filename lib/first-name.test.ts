import { describe, expect, it } from 'vitest';
import { firstName } from './first-name';

describe('firstName', () => {
  it('usa o primeiro nome do perfil', () => {
    expect(firstName({ user_metadata: { full_name: 'bruno pezzolato' } })).toBe(
      'Bruno',
    );
  });
  it('sem perfil, tira do e-mail', () => {
    expect(firstName({ email: 'bruno.pezzolato@icloud.com' })).toBe('Bruno');
  });
  it('não inventa nome de e-mail com números', () => {
    expect(firstName({ email: 'x123@icloud.com' })).toBe('');
  });
});
