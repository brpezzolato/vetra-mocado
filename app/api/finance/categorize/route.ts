import { NextResponse } from 'next/server';

// Protótipo: sem IA. A categoria fica para quem preenche.
export async function POST() {
  return NextResponse.json(
    { category: null, source: 'fallback' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
