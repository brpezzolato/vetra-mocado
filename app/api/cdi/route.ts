import { NextResponse } from 'next/server';
import { fetchCdiRates } from '@/lib/cdi-server';

export async function GET() {
  try {
    const { rates, historyComplete } = await fetchCdiRates();
    return NextResponse.json({
      rates,
      source: 'Banco Central do Brasil · SGS 12',
      updatedAt: new Date().toISOString(),
      lastRateDate: rates.at(-1)?.date,
      historyComplete,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          'CDI temporariamente indisponível. Preserve a última série válida.',
        source: 'unavailable',
      },
      { status: 503 },
    );
  }
}
