import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse } from 'next/server';
import { readSessionToken, type UserRole } from '@/lib/auth';
import { findStoredUser, type UserSummary } from '@/lib/users';

export type CurrentUser = UserSummary;

/**
 * Resolves the signed-in user from the session cookie value and reads the role
 * from D1. The DB role wins over the cookie role, so demotions apply immediately.
 */
export async function getCurrentUser(cookieValue: string | undefined): Promise<CurrentUser | null> {
  const { env } = await getCloudflareContext({ async: true });
  const envSecret = (env as unknown as Record<string, unknown>)?.AUTH_SECRET as string | undefined;
  const session = await readSessionToken(cookieValue, envSecret);
  if (!session) return null;

  if (!env.DB) return null;

  const user = await findStoredUser(env.DB, session.username);
  if (!user) return null;
  return { username: user.username, role: user.role };
}

/** Use in route handlers. Returns the user, or a 401/403 response to send back. */
export async function requireUser(
  cookieValue: string | undefined
): Promise<{ user: CurrentUser } | { response: NextResponse }> {
  const user = await getCurrentUser(cookieValue);
  if (!user) {
    return { response: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
  }
  return { user };
}

export async function requireAdmin(
  cookieValue: string | undefined
): Promise<{ user: CurrentUser } | { response: NextResponse }> {
  const result = await requireUser(cookieValue);
  if ('response' in result) return result;
  if (result.user.role !== 'admin') {
    return { response: NextResponse.json({ error: 'Only admins can do this.' }, { status: 403 }) };
  }
  return result;
}

export type { UserRole };
