import { NextResponse } from 'next/server';

// Protótipo: uma rodada automática concluída há pouco. Não chama a Pluggy.
const noStore = { 'Cache-Control': 'no-store' };

export async function GET() {
  const at = new Date(Date.now() - 38 * 60_000).toISOString();
  return NextResponse.json(
    {
      runs: [
        {
          id: 'demo-run-1',
          trigger: 'cron',
          status: 'ok',
          started_at: at,
          duration_ms: 21_400,
          summary: { entries: 4, movements: 1 },
          error: null,
        },
      ],
      banks: [],
    },
    { headers: noStore },
  );
}
