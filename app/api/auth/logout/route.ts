import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — clears the session cookie and returns to the login page. */
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
