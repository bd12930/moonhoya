/**
 * Login and session helpers for the Moonhoya app.
 *
 * - Usernames are matched case-insensitively (stored lowercase).
 * - Passwords are case-sensitive and stored only as PBKDF2-SHA256 hashes.
 * - Sessions are an HMAC-signed cookie. The signing key is the AUTH_SECRET
 *   environment variable (Wrangler secret in production, .dev.vars locally).
 *   If AUTH_SECRET is missing, login and session checks fail closed.
 */

export const SESSION_COOKIE = 'moonhoya_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const PBKDF2_ITERATIONS = 100_000; // Workers Web Crypto limit

export type UserRole = 'admin' | 'staff';

export interface AppUser {
  username: string;
  role: UserRole;
  passwordHash: string;
}

/**
 * Users. Every account starts with the default password "setiawan".
 * To change a password, replace its hash with the output of `hashPassword()`.
 */
export const USERS: AppUser[] = [
  { username: 'budi', role: 'admin', passwordHash: 'pbkdf2-sha256$100000$XO73EcLfwIdpIJyvYlfWUA==$oCFpw6AOpGQc7rJnn9wTJAfyzwjHsKxxd3rk4QSZ32A=' },
  { username: 'shitarini', role: 'staff', passwordHash: 'pbkdf2-sha256$100000$R9Zc8dggVM5fSA3EbEEyQQ==$2v1xBvqdGqC0xOWm3XjUxAWAnu3vIhdLNyQXKT81DlM=' },
  { username: 'andy', role: 'staff', passwordHash: 'pbkdf2-sha256$100000$/cDnxYWGqPRj3cfDAlbfBw==$ZcrKPqH2i0EXw3RzGuy2oh3c8nr+qF88i4r/j7cmkiQ=' },
  { username: 'debora', role: 'staff', passwordHash: 'pbkdf2-sha256$100000$7o89dsGpnb1+2q9ddziL4Q==$keddDkMnkhc+Rcl2rp4g539L7g8nQxrYTrUOsMnWVIs=' },
];

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

/** Produces `pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256' || !iterStr || !saltB64 || !hashB64) return false;
  const hash = await derive(password, fromBase64(saltB64), Number(iterStr));
  return constantTimeEqual(hash, fromBase64(hashB64));
}

export function findUser(username: string): AppUser | undefined {
  const normalized = username.trim().toLowerCase();
  return USERS.find((u) => u.username === normalized);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export interface Session {
  username: string;
  role: UserRole;
  expiresAt: number; // unix seconds
}

/** Creates the cookie value `<username>.<role>.<expiresAt>.<signature>`. Returns null if no secret is set. */
export async function createSessionToken(username: string, role: UserRole): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `${username}.${role}.${expiresAt}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64(new Uint8Array(sig))}`;
}

/** Verifies a session cookie value. Returns null when missing, tampered, expired, or no secret is set. */
export async function readSessionToken(token: string | undefined): Promise<Session | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || !token) return null;

  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [username, role, expiresStr, sigB64] = parts;

  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return null;
  if (role !== 'admin' && role !== 'staff') return null;

  const payload = `${username}.${role}.${expiresStr}`;
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64(sigB64) as BufferSource,
      encoder.encode(payload)
    );
  } catch {
    return null; // malformed signature encoding
  }
  if (!valid) return null;

  return { username, role, expiresAt };
}

/** Only allow same-site relative paths after login (prevents open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/dashboard';
  }
  return next;
}
