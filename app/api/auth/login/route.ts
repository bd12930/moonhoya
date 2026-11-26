import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  SESSION_COOKIE,
  createSessionToken,
  normalizeUsername,
  sessionCookieOptions,
  verifyPassword,
} from '@/lib/auth';
import { findStoredUser } from '@/lib/users';

export const dynamic = 'force-dynamic';

/** POST /api/auth/login  { username, password } */
export async function POST(request: NextRequest) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username.trim() || !password) {
    return NextResponse.json({ error: 'Enter your username and password.' }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.DB) {
    return NextResponse.json({ error: 'D1 Database binding not found.' }, { status: 500 });
  }

  const user = await findStoredUser(env.DB, normalizeUsername(username));
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !passwordOk) {
    return NextResponse.json({ error: 'Incorrect username or password.' }, { status: 401 });
  }

  const envSecret = (env as unknown as Record<string, unknown>)?.AUTH_SECRET as string | undefined;
  const token = await createSessionToken(user.username, user.role, envSecret);
  if (!token) {
    return NextResponse.json({ error: 'Login is not configured on this server (AUTH_SECRET missing).' }, { status: 500 });
  }

  const response = NextResponse.json({
    success: true,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    defaultScreen: user.defaultScreen,
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(request.nextUrl.protocol === 'https:'));
  return response;
}
