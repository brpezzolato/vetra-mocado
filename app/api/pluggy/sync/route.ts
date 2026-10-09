import { NextResponse } from 'next/server';

// Protótipo: não há bancos para sincronizar.
const noStore = { 'Cache-Control': 'no-store' };

export async function GET() {
  return NextResponse.json({ runs: [] }, { headers: noStore });
}

export async function POST() {
  return NextResponse.json({ skipped: true }, { headers: noStore });
}
