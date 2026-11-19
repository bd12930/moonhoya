import type { UserRole } from '@/lib/auth';

type D1Database = CloudflareEnv['DB'];

/** D1 data access for the AppUser table. Callers pass in env.DB. */

export interface StoredUser {
  username: string;
  role: UserRole;
  passwordHash: string;
}

export interface UserSummary {
  username: string;
  role: UserRole;
}

export async function findStoredUser(db: D1Database, username: string): Promise<StoredUser | null> {
  const row = await db
    .prepare(`SELECT username, role, passwordHash FROM AppUser WHERE username = ?`)
    .bind(username)
    .first<StoredUser>();
  return row ?? null;
}

export async function listUsers(db: D1Database): Promise<UserSummary[]> {
  const { results } = await db
    .prepare(`SELECT username, role FROM AppUser ORDER BY role ASC, username ASC`)
    .all<UserSummary>();
  return results ?? [];
}

export async function updatePasswordHash(db: D1Database, username: string, passwordHash: string): Promise<void> {
  await db
    .prepare(`UPDATE AppUser SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE username = ?`)
    .bind(passwordHash, username)
    .run();
}

export async function updateRole(db: D1Database, username: string, role: UserRole): Promise<void> {
  await db
    .prepare(`UPDATE AppUser SET role = ?, updatedAt = CURRENT_TIMESTAMP WHERE username = ?`)
    .bind(role, username)
    .run();
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM AppUser WHERE role = 'admin'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
