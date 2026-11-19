import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  createSessionToken,
  readSessionToken,
  safeNextPath,
  sessionCookieOptions,
} from '@/lib/auth';

/** Pages and API routes reachable without a session. */
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout']);

/**
 * Login gate for every page and API route.
 * Pages without a valid session redirect to /login; API routes get 401 JSON.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === '/login' && session) {
      const next = safeNextPath(request.nextUrl.searchParams.get('next'));
      return NextResponse.redirect(new URL(next, request.url));
    }
    return NextResponse.next();
  }

  if (session) {
    // Sliding idle window: every authenticated request pushes the expiry forward 10 minutes.
    const refreshed = await createSessionToken(session.username, session.role);
    const response = NextResponse.next();
    if (refreshed) {
      response.cookies.set(SESSION_COOKIE, refreshed, sessionCookieOptions(request.nextUrl.protocol === 'https:'));
    }
    return response;
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('next', `${pathname}${search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
