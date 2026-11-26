import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  MAX_FULL_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  USERNAME_PATTERN,
  hashPassword,
  isDefaultScreen,
  isUserRole,
  normalizeUsername,
  suggestedDefaultScreen,
  type DefaultScreen,
  type UserRole,
} from '@/lib/auth';
import { requireAdmin } from '@/lib/access';
import {
  createUser,
  findStoredUser,
  listUsers,
  updatePasswordHash,
  updateUserProfile,
} from '@/lib/users';

export const dynamic = 'force-dynamic';

function validateFullName(value: unknown): { value: string } | { error: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: 'Full name is required.' };
  const trimmed = value.trim();
  if (trimmed.length > MAX_FULL_NAME_LENGTH) {
    return { error: `Full name must be ${MAX_FULL_NAME_LENGTH} characters or fewer.` };
  }
  return { value: trimmed };
}

function validatePassword(value: unknown): { value: string } | { error: string } {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { value };
}

/** GET /api/admin/users — list accounts (admin only). */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request.cookies.get(SESSION_COOKIE)?.value);
  if ('response' in auth) return auth.response;

  const { env } = await getCloudflareContext({ async: true });
  return NextResponse.json({ users: await listUsers(env.DB) });
}

/**
 * POST /api/admin/users  { username, fullName, password, role, defaultScreen? } (admin only)
 * Creates an account. The password is hashed before storage and never logged.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request.cookies.get(SESSION_COOKIE)?.value);
  if ('response' in auth) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? normalizeUsername(body.username) : '';
  if (!USERNAME_PATTERN.test(username)) {
    return NextResponse.json(
      { error: 'Username must be 3–32 lowercase letters, digits, dots, dashes, or underscores.' },
      { status: 400 }
    );
  }

  const fullName = validateFullName(body.fullName);
  if ('error' in fullName) return NextResponse.json({ error: fullName.error }, { status: 400 });

  const password = validatePassword(body.password);
  if ('error' in password) return NextResponse.json({ error: password.error }, { status: 400 });

  if (!isUserRole(body.role)) {
    return NextResponse.json({ error: 'Role must be admin, manager, staff, or contractor.' }, { status: 400 });
  }
  const role: UserRole = body.role;

  let defaultScreen: DefaultScreen = suggestedDefaultScreen(role);
  if (body.defaultScreen !== undefined) {
    if (!isDefaultScreen(body.defaultScreen)) {
      return NextResponse.json({ error: 'Default screen must be Dashboard or Quick Scanner.' }, { status: 400 });
    }
    defaultScreen = body.defaultScreen;
  }

  const { env } = await getCloudflareContext({ async: true });
  if (await findStoredUser(env.DB, username)) {
    return NextResponse.json({ error: `Username "${username}" is already taken.` }, { status: 409 });
  }

  try {
    await createUser(env.DB, {
      username,
      fullName: fullName.value,
      role,
      defaultScreen,
      passwordHash: await hashPassword(password.value),
    });
  } catch (error) {
    // Lost a race with another create for the same username.
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return NextResponse.json({ error: `Username "${username}" is already taken.` }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ success: true, message: `Created ${username}.` }, { status: 201 });
}

/**
 * PATCH /api/admin/users  { username, fullName?, role?, defaultScreen?, newPassword? } (admin only)
 * - role: any of admin, manager, staff, contractor.
 * - defaultScreen: where the user lands after sign-in.
 * - newPassword: reset that user's password to the value given.
 * Admins cannot change their own role, so the last admin cannot remove themselves.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request.cookies.get(SESSION_COOKIE)?.value);
  if ('response' in auth) return auth.response;

  let body: Record<string, unknown>;
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
  const hasFullName = body.fullName !== undefined;
  const hasDefaultScreen = body.defaultScreen !== undefined;
  const hasPassword = body.newPassword !== undefined;
  if (!hasRole && !hasFullName && !hasDefaultScreen && !hasPassword) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }

  const profile: { fullName?: string; role?: UserRole; defaultScreen?: DefaultScreen } = {};

  if (hasRole) {
    if (!isUserRole(body.role)) {
      return NextResponse.json(
        { error: 'Role must be admin, manager, staff, or contractor.' },
        { status: 400 }
      );
    }
    if (target.username === auth.user.username && body.role !== 'admin') {
      return NextResponse.json({ error: "You can't remove your own admin role." }, { status: 400 });
    }
    profile.role = body.role;
  }

  if (hasFullName) {
    const fullName = validateFullName(body.fullName);
    if ('error' in fullName) return NextResponse.json({ error: fullName.error }, { status: 400 });
    profile.fullName = fullName.value;
  }

  if (hasDefaultScreen) {
    if (!isDefaultScreen(body.defaultScreen)) {
      return NextResponse.json({ error: 'Default screen must be Dashboard or Quick Scanner.' }, { status: 400 });
    }
    profile.defaultScreen = body.defaultScreen;
  }

  let newPasswordHash: string | null = null;
  if (hasPassword) {
    const password = validatePassword(body.newPassword);
    if ('error' in password) return NextResponse.json({ error: password.error }, { status: 400 });
    newPasswordHash = await hashPassword(password.value);
  }

  await updateUserProfile(env.DB, target.username, profile);
  if (newPasswordHash) {
    await updatePasswordHash(env.DB, target.username, newPasswordHash);
  }

  return NextResponse.json({ success: true, message: `Updated ${target.username}.` });
}
