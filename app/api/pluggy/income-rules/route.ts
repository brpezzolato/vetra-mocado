import { NextResponse } from 'next/server';

// Protótipo: aceita a regra sem gravar nada no servidor.
const ok = () =>
  NextResponse.json(
    { ok: true, updated: 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  );

export const POST = ok;
export const PUT = ok;
export const PATCH = ok;
export const DELETE = ok;
