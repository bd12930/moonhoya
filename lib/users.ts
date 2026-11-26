import type { DefaultScreen, UserRole } from '@/lib/auth';

type D1Database = CloudflareEnv['DB'];

/** D1 data access for the AppUser table. Callers pass in env.DB. */

export interface StoredUser {
  username: string;
  fullName: string;
  role: UserRole;
  defaultScreen: DefaultScreen;
  passwordHash: string;
}

export interface UserSummary {
  username: string;
  fullName: string;
  role: UserRole;
  defaultScreen: DefaultScreen;
}

const SUMMARY_COLUMNS = `username, fullName, role, defaultScreen`;

export async function findStoredUser(db: D1Database, username: string): Promise<StoredUser | null> {
  const row = await db
    .prepare(`SELECT username, fullName, role, defaultScreen, passwordHash FROM AppUser WHERE username = ?`)
    .bind(username)
    .first<StoredUser>();
  return row ?? null;
}

export async function listUsers(db: D1Database): Promise<UserSummary[]> {
  const { results } = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM AppUser ORDER BY username ASC`)
    .all<UserSummary>();
  return results ?? [];
}

export async function createUser(
  db: D1Database,
  user: { username: string; fullName: string; role: UserRole; defaultScreen: DefaultScreen; passwordHash: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO AppUser (username, fullName, role, defaultScreen, passwordHash) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(user.username, user.fullName, user.role, user.defaultScreen, user.passwordHash)
    .run();
}

export async function updateUserProfile(
  db: D1Database,
  username: string,
  profile: { fullName?: string; role?: UserRole; defaultScreen?: DefaultScreen }
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (profile.fullName !== undefined) {
    sets.push('fullName = ?');
    values.push(profile.fullName);
  }
  if (profile.role !== undefined) {
    sets.push('role = ?');
    values.push(profile.role);
  }
  if (profile.defaultScreen !== undefined) {
    sets.push('defaultScreen = ?');
    values.push(profile.defaultScreen);
  }
  if (sets.length === 0) return;
  sets.push('updatedAt = CURRENT_TIMESTAMP');
  await db
    .prepare(`UPDATE AppUser SET ${sets.join(', ')} WHERE username = ?`)
    .bind(...values, username)
    .run();
}

export async function updatePasswordHash(db: D1Database, username: string, passwordHash: string): Promise<void> {
  await db
    .prepare(`UPDATE AppUser SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE username = ?`)
    .bind(passwordHash, username)
    .run();
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM AppUser WHERE role = 'admin'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
