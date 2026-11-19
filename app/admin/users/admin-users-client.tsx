'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Role = 'admin' | 'staff';
interface UserRow {
  username: string;
  role: Role;
}

const MIN_PASSWORD_LENGTH = 6;

export default function AdminUsersClient({
  currentUsername,
  initialUsers,
}: {
  currentUsername: string;
  initialUsers: UserRow[];
}) {
  const router = useRouter();
  const users = initialUsers;
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  async function patch(username: string, body: Record<string, unknown>) {
    setBusy(username);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error ?? 'Update failed.' });
        return false;
      }
      setMessage({ kind: 'ok', text: data.message ?? 'Saved.' });
      router.refresh();
      return true;
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach the server.' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleRoleChange(username: string, role: Role) {
    await patch(username, { role });
  }

  async function handleReset(e: FormEvent<HTMLFormElement>, username: string) {
    e.preventDefault();
    if (resetPassword.length < MIN_PASSWORD_LENGTH) {
      setMessage({ kind: 'error', text: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    const ok = await patch(username, { newPassword: resetPassword });
    if (ok) {
      setResetFor(null);
      setResetPassword('');
    }
  }

  return (
    <div className="min-h-screen bg-emerald-50/40 px-4 py-10">
      <div className="mx-auto max-w-2xl bg-white rounded-2xl shadow-sm border border-emerald-200/80 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-emerald-900">Manage users</h1>
            <p className="text-sm text-slate-500">Promote staff to admin or reset passwords.</p>
          </div>
          <Link href="/dashboard" className="text-sm text-emerald-800 hover:underline">Dashboard</Link>
        </div>

        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'}
            className={`mb-4 text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
            {message.text}
          </p>
        )}

        <ul className="divide-y divide-slate-200">
          {users.map((user) => {
            const isSelf = user.username === currentUsername;
            const isResetting = resetFor === user.username;
            return (
              <li key={user.username} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-semibold text-slate-800 capitalize">{user.username}</span>
                    {isSelf && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={`Role for ${user.username}`}
                      value={user.role}
                      disabled={busy === user.username || isSelf}
                      title={isSelf ? "You can't change your own role" : undefined}
                      onChange={(e) => handleRoleChange(user.username, e.target.value as Role)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-60"
                    >
                      <option value="admin">Admin</option>
                      <option value="staff">Staff</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setResetFor(isResetting ? null : user.username);
                        setResetPassword('');
                      }}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      {isResetting ? 'Cancel' : 'Reset password'}
                    </button>
                  </div>
                </div>

                {isResetting && (
                  <form onSubmit={(e) => handleReset(e, user.username)} className="mt-3 flex flex-wrap items-end gap-2">
                    <div>
                      <label htmlFor={`reset-${user.username}`} className="block text-xs font-medium text-slate-600 mb-1">
                        New password for {user.username}
                      </label>
                      <input
                        id={`reset-${user.username}`}
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={MIN_PASSWORD_LENGTH}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                      />
                    </div>
                    <button type="submit" disabled={busy === user.username}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                      Save password
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
