import { demoClient } from '@/lib/demo/demo-client';

// Protótipo: sem banco de dados. Tudo vem de lib/demo, em memória.
export function securityAdmin() {
  if (typeof window !== 'undefined') throw new Error('Server only');
  return demoClient();
}
