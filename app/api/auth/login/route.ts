import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  findUser,
  verifyPassword,
} from '@/lib/auth';

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

  const user = findUser(username);
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !passwordOk) {
    return NextResponse.json({ error: 'Incorrect username or password.' }, { status: 401 });
  }

  const token = await createSessionToken(user.username, user.role);
  if (!token) {
    return NextResponse.json({ error: 'Login is not configured on this server (AUTH_SECRET missing).' }, { status: 500 });
  }

  const response = NextResponse.json({ success: true, username: user.username, role: user.role });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
