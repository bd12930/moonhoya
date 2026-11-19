import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { MIN_PASSWORD_LENGTH, SESSION_COOKIE, hashPassword, verifyPassword } from '@/lib/auth';
import { requireUser } from '@/lib/access';
import { findStoredUser, updatePasswordHash } from '@/lib/users';

export const dynamic = 'force-dynamic';

/** POST /api/account/password  { currentPassword, newPassword } — signed-in user changes their own password. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request.cookies.get(SESSION_COOKIE)?.value);
  if ('response' in auth) return auth.response;

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Enter your current and new password.' }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const { env } = await getCloudflareContext({ async: true });
  const stored = await findStoredUser(env.DB, auth.user.username);
  if (!stored) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  if (!(await verifyPassword(currentPassword, stored.passwordHash))) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
  }

  await updatePasswordHash(env.DB, stored.username, await hashPassword(newPassword));
  return NextResponse.json({ success: true, message: 'Password changed.' });
}
