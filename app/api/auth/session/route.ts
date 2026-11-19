import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { getCurrentUser } from '@/lib/access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/session — returns the signed-in user.
 * The client calls this as a keepalive while the user is active; the proxy
 * refreshes the session cookie on the request, sliding the idle window.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  return NextResponse.json({ username: user.username, role: user.role });
}
