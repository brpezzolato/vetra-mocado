// Puro.

/**
 * Roda no máximo `size` tarefas ao mesmo tempo; as outras esperam a vez, na
 * ordem em que chegaram. A vaga passa direto de quem termina para quem
 * espera, então nunca há mais de `size` rodando. Erro de uma tarefa volta só
 * para quem a pediu e libera a vaga.
 */
export function limiter(size: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= size)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
