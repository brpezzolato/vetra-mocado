import { describe, expect, it } from 'vitest';
import { limiter } from './concurrency';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('limiter', () => {
  it('nunca passa do limite e roda tudo', async () => {
    const slot = limiter(4);
    let running = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        slot(async () => {
          running++;
          peak = Math.max(peak, running);
          await tick(5 + (index % 3) * 3);
          running--;
          return index;
        }),
      ),
    );
    expect(peak).toBe(4);
    expect(results).toEqual(Array.from({ length: 12 }, (_, index) => index));
  });

  it('com 4 vagas, 12 tarefas de 50 ms levam ~150 ms, não 600', async () => {
    const slot = limiter(4);
    const start = Date.now();
    await Promise.all(Array.from({ length: 12 }, () => slot(() => tick(50))));
    expect(Date.now() - start).toBeLessThan(400);
  });

  it('erro de uma não trava a fila', async () => {
    const slot = limiter(1);
    const failed = slot(async () => {
      throw new Error('falhou');
    });
    const next = slot(async () => 'seguiu');
    await expect(failed).rejects.toThrow('falhou');
    await expect(next).resolves.toBe('seguiu');
  });
});
