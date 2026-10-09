import { demoClient } from '@/lib/demo/demo-client';

// Protótipo: sem banco de dados. Tudo vem de lib/demo, em memória.
export function createClient() {
  return demoClient();
}
