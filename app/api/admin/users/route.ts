import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { MIN_PASSWORD_LENGTH, SESSION_COOKIE, hashPassword, normalizeUsername, type UserRole } from '@/lib/auth';
import { requireAdmin } from '@/lib/access';
import { findStoredUser, listUsers, updatePasswordHash, updateRole } from '@/lib/users';

export const dynamic = 'force-dynamic';

/** GET /api/admin/users — list accounts and roles (admin only). */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request.cookies.get(SESSION_COOKIE)?.value);
  if ('response' in auth) return auth.response;

  const { env } = await getCloudflareContext({ async: true });
  return NextResponse.json({ users: await listUsers(env.DB) });
}

/**
 * PATCH /api/admin/users  { username, role?, newPassword? } (admin only)
 * - role: change between 'admin' and 'staff' (promote or demote).
 * - newPassword: reset that user's password to the value given.
 * Admins cannot change their own role, so the last admin cannot remove themselves.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request.cookies.get(SESSION_COOKIE)?.value);
  if ('response' in auth) return auth.response;

  let body: { username?: unknown; role?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (typeof body.username !== 'string' || !body.username.trim()) {
    return NextResponse.json({ error: 'Username is required.' }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const target = await findStoredUser(env.DB, normalizeUsername(body.username));
  if (!target) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  const hasRole = body.role !== undefined;
  const hasPassword = body.newPassword !== undefined;
  if (!hasRole && !hasPassword) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }

  if (hasRole) {
    if (body.role !== 'admin' && body.role !== 'staff') {
      return NextResponse.json({ error: 'Role must be admin or staff.' }, { status: 400 });
    }
    const role = body.role as UserRole;
    if (target.username === auth.user.username && role !== 'admin') {
      return NextResponse.json({ error: "You can't remove your own admin role." }, { status: 400 });
    }
  }

  if (hasPassword) {
    if (typeof body.newPassword !== 'string' || body.newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }
  }

  if (hasRole) {
    await updateRole(env.DB, target.username, body.role as UserRole);
  }
  if (hasPassword) {
    await updatePasswordHash(env.DB, target.username, await hashPassword(body.newPassword as string));
  }

  return NextResponse.json({ success: true, message: `Updated ${target.username}.` });
}
