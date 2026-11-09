import { connection } from 'next/server';
import { demoClient } from '@/lib/demo/demo-client';

// Protótipo: sem banco de dados. Tudo vem de lib/demo, em memória.
// `connection()`: como o cliente real (que lê cookies), só roda no pedido;
// sem isso o cacheComponents tenta pré-renderizar e tropeça em `new Date()`.
export async function createClient() {
  await connection();
  return demoClient();
}
