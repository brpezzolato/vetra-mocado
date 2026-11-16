import { NextResponse } from 'next/server';

// Protótipo: notebook ligado, uma rodada automática aceita há pouco. O botão
// "pede" e já aparece aceito. Não chama nada.
const noStore = { 'Cache-Control': 'no-store' };

const state = (
  minutesAgo: number,
  trigger: 'schedule' | 'button',
  left: number,
) => {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    agentOnline: true,
    lastSeenAt: new Date().toISOString(),
    buttonLeft: left,
    verdict: minutesAgo < 10 ? 'too_soon' : 'ok',
    latest: {
      id: 'demo-round',
      trigger,
      status: 'ok',
      result: 'ok',
      detail: '4/4',
      requested_at: at,
      started_at: at,
      finished_at: at,
    },
    lastOkAt: at,
  };
};

export async function GET() {
  return NextResponse.json(state(38, 'schedule', 2), { headers: noStore });
}

export async function POST() {
  return NextResponse.json(state(0, 'button', 1), { headers: noStore });
}
