export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function requireSameOrigin(request: Request) {
  const expected = new URL(request.url).origin;
  if (request.headers.get('origin') !== expected)
    throw new HttpError(403, 'Origem da requisição inválida.');
}

export async function readJsonBounded(
  request: Request,
  limit = 16_384,
): Promise<unknown> {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new HttpError(415, 'Envie JSON.');
  if (Number(request.headers.get('content-length')) > limit)
    throw new HttpError(413, 'Requisição muito grande.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'JSON obrigatório.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + 10_000;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new HttpError(408, 'Tempo de envio excedido.')),
            Math.max(1, deadline - Date.now()),
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new HttpError(413, 'Requisição muito grande.');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new HttpError(400, 'JSON inválido.');
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export function errorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : 'Serviço temporariamente indisponível.',
    },
    {
      status: error instanceof HttpError ? error.status : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
