import { NextResponse } from 'next/server';

// Protótipo: um robô sempre conectado, que "atualizou" há pouco. Não chama
// a Pluggy nem guarda nada.
const noStore = { 'Cache-Control': 'no-store' };
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

export async function GET() {
  const at = minutesAgo(38);
  return NextResponse.json(
    {
      robot: {
        status: 'active',
        last_error: null,
        last_refresh_at: at,
        updated_at: at,
      },
      runs: [
        {
          id: 'demo-run-1',
          trigger: 'cron',
          status: 'ok',
          started_at: at,
          duration_ms: 21_400,
          robot: 'done',
          summary: { entries: 4, movements: 1 },
          error: null,
        },
      ],
      banks: [],
    },
    { headers: noStore },
  );
}

export async function POST() {
  return NextResponse.json({ ok: true, clicked: 0 }, { headers: noStore });
}
