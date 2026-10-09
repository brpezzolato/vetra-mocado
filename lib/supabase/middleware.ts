import { NextResponse, type NextRequest } from 'next/server';
import { DEMO_SESSION_COOKIE } from '@/lib/demo/demo-session';

// Protótipo: o "login" é só um cookie, posto pela tela de entrada.
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api')) return NextResponse.next({ request });
  const signedIn = request.cookies.get(DEMO_SESSION_COOKIE)?.value === '1';
  if (pathname === '/desbloquear')
    return NextResponse.redirect(new URL('/', request.url));
  if (!signedIn && pathname !== '/auth')
    return NextResponse.redirect(new URL('/auth', request.url));
  if (signedIn && pathname === '/auth')
    return NextResponse.redirect(new URL('/', request.url));
  return NextResponse.next({ request });
}
