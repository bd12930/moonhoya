/**
 * Login and session helpers for the Moonhoya app.
 *
 * - Usernames are matched case-insensitively (stored lowercase).
 * - Passwords are case-sensitive and stored only as PBKDF2-SHA256 hashes in the D1 AppUser table.
 * - Sessions are an HMAC-signed cookie. The signing key is the AUTH_SECRET
 *   environment variable (Wrangler secret in production, .dev.vars locally).
 *   If AUTH_SECRET is missing, login and session checks fail closed.
 */

export const SESSION_COOKIE = 'moonhoya_session';
/** Sliding idle timeout: every authenticated request re-issues the cookie with a fresh 10-minute expiry. */
export const SESSION_IDLE_SECONDS = 60 * 10;

const PBKDF2_ITERATIONS = 100_000; // Workers Web Crypto limit

export type UserRole = 'admin' | 'staff';

export interface AppUser {
  username: string;
  role: UserRole;
  passwordHash: string;
}

/** Minimum length for a new password. Passwords are case-sensitive. */
export const MIN_PASSWORD_LENGTH = 6;

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

/** Usernames are stored lowercase; lookups are case-insensitive. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
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
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_IDLE_SECONDS;
  const payload = `${username}.${role}.${expiresAt}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64(new Uint8Array(sig))}`;
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_IDLE_SECONDS,
  };
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
