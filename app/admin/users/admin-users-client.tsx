'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_SCREEN_LABELS,
  DEFAULT_SCREENS,
  MAX_FULL_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  USER_ROLES,
  USER_ROLE_LABELS,
  USERNAME_PATTERN,
  suggestedDefaultScreen,
  type DefaultScreen,
  type UserRole,
} from '@/lib/auth';
import StatusInfo from '@/components/status-info';

interface UserRow {
  username: string;
  fullName: string;
  role: UserRole;
  defaultScreen: DefaultScreen;
}

interface Draft {
  fullName: string;
  role: UserRole;
  defaultScreen: DefaultScreen;
}

interface CreateForm {
  username: string;
  fullName: string;
  password: string;
  role: UserRole;
  defaultScreen: DefaultScreen;
}

type Message = { kind: 'ok' | 'error'; text: string } | null;

const EMPTY_CREATE: CreateForm = {
  username: '',
  fullName: '',
  password: '',
  role: 'staff',
  defaultScreen: suggestedDefaultScreen('staff'),
};

const inputClass =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:opacity-60';

export default function AdminUsersClient({
  currentUsername,
  initialUsers,
}: {
  currentUsername: string;
  initialUsers: UserRow[];
}) {
  const router = useRouter();
  const users = initialUsers;
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  // Once the admin picks a default screen by hand, stop following the role suggestion.
  const [screenTouched, setScreenTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  const [editFor, setEditFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  async function send(method: 'POST' | 'PATCH', body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/users', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  function updateCreateRole(role: UserRole) {
    setCreateForm((f) => ({
      ...f,
      role,
      defaultScreen: screenTouched ? f.defaultScreen : suggestedDefaultScreen(role),
    }));
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    const ok = await send('POST', { ...createForm }, 'create');
    setCreating(false);
    if (ok) {
      setCreateForm(EMPTY_CREATE);
      setScreenTouched(false);
      setCreateOpen(false);
    }
  }

  function startEdit(user: UserRow) {
    setEditFor(user.username);
    setDraft({ fullName: user.fullName, role: user.role, defaultScreen: user.defaultScreen });
    setResetFor(null);
  }

  async function handleSaveEdit(username: string) {
    if (!draft) return;
    const ok = await send('PATCH', { username, ...draft }, username);
    if (ok) {
      setEditFor(null);
      setDraft(null);
    }
  }

  async function handleReset(e: FormEvent<HTMLFormElement>, username: string) {
    e.preventDefault();
    if (resetPassword.length < MIN_PASSWORD_LENGTH) {
      setMessage({ kind: 'error', text: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    const ok = await send('PATCH', { username, newPassword: resetPassword }, username);
    if (ok) {
      setResetFor(null);
      setResetPassword('');
    }
  }

  return (
    <div className="min-h-screen bg-emerald-50/40 px-4 py-10">
      <div className="mx-auto max-w-4xl bg-white rounded-2xl shadow-sm border border-emerald-200/80 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-emerald-900">Manage users</h1>
            <p className="text-sm text-slate-500">Create accounts, set roles, default screens, and passwords.</p>
            <StatusInfo className="mt-1" />
          </div>
          <Link href="/dashboard" className="text-sm text-emerald-800 hover:underline">Dashboard</Link>
        </div>

        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'}
            className={`mb-4 text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
            {message.text}
          </p>
        )}

        <div className="mb-6">
          {!createOpen ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Create user
            </button>
          ) : (
            <form
              onSubmit={handleCreate}
              className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 grid gap-3 sm:grid-cols-2"
            >
              <h2 className="sm:col-span-2 font-semibold text-emerald-900">New user</h2>

              <div>
                <label htmlFor="new-username" className="block text-xs font-medium text-slate-600 mb-1">
                  Username
                </label>
                <input
                  id="new-username"
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  pattern={USERNAME_PATTERN.source.replace(/^\^|\$$/g, '')}
                  placeholder="e.g. jane.doe"
                  value={createForm.username}
                  onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                  className={`w-full ${inputClass}`}
                />
                <p className="mt-1 text-xs text-slate-500">3–32 lowercase letters, digits, . _ -</p>
              </div>

              <div>
                <label htmlFor="new-fullname" className="block text-xs font-medium text-slate-600 mb-1">
                  Full name
                </label>
                <input
                  id="new-fullname"
                  type="text"
                  required
                  maxLength={MAX_FULL_NAME_LENGTH}
                  placeholder="e.g. Jane Doe"
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm((f) => ({ ...f, fullName: e.target.value }))}
                  className={`w-full ${inputClass}`}
                />
              </div>

              <div>
                <label htmlFor="new-password" className="block text-xs font-medium text-slate-600 mb-1">
                  Temporary password
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  className={`w-full ${inputClass}`}
                />
              </div>

              <div>
                <label htmlFor="new-role" className="block text-xs font-medium text-slate-600 mb-1">
                  Role
                </label>
                <select
                  id="new-role"
                  value={createForm.role}
                  onChange={(e) => updateCreateRole(e.target.value as UserRole)}
                  className={`w-full ${inputClass}`}
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>{USER_ROLE_LABELS[role]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="new-screen" className="block text-xs font-medium text-slate-600 mb-1">
                  Default screen after sign-in
                </label>
                <select
                  id="new-screen"
                  value={createForm.defaultScreen}
                  onChange={(e) => {
                    setScreenTouched(true);
                    setCreateForm((f) => ({ ...f, defaultScreen: e.target.value as DefaultScreen }));
                  }}
                  className={`w-full ${inputClass}`}
                >
                  {DEFAULT_SCREENS.map((screen) => (
                    <option key={screen} value={screen}>{DEFAULT_SCREEN_LABELS[screen]}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 flex gap-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {creating ? 'Creating…' : 'Create user'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateForm(EMPTY_CREATE);
                    setScreenTouched(false);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        <ul className="divide-y divide-slate-200">
          {users.map((user) => {
            const isSelf = user.username === currentUsername;
            const isEditing = editFor === user.username && draft !== null;
            const isResetting = resetFor === user.username;
            const rowBusy = busy === user.username;
            return (
              <li key={user.username} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div>
                      <span className="font-semibold text-slate-800">{user.fullName || user.username}</span>
                      {isSelf && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      @{user.username} · {USER_ROLE_LABELS[user.role]} · opens {DEFAULT_SCREEN_LABELS[user.defaultScreen]}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => startEdit(user)}
                        disabled={rowBusy}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setResetFor(isResetting ? null : user.username);
                        setResetPassword('');
                        setEditFor(null);
                      }}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      {isResetting ? 'Cancel' : 'Reset password'}
                    </button>
                  </div>
                </div>

                {isEditing && draft && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveEdit(user.username);
                    }}
                    className="mt-3 grid gap-3 sm:grid-cols-3 items-end"
                  >
                    <div>
                      <label htmlFor={`fullname-${user.username}`} className="block text-xs font-medium text-slate-600 mb-1">
                        Full name
                      </label>
                      <input
                        id={`fullname-${user.username}`}
                        type="text"
                        required
                        maxLength={MAX_FULL_NAME_LENGTH}
                        value={draft.fullName}
                        onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                        className={`w-full ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label htmlFor={`role-${user.username}`} className="block text-xs font-medium text-slate-600 mb-1">
                        Role
                      </label>
                      <select
                        id={`role-${user.username}`}
                        value={draft.role}
                        disabled={isSelf}
                        title={isSelf ? "You can't change your own role" : undefined}
                        onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRole })}
                        className={`w-full ${inputClass}`}
                      >
                        {USER_ROLES.map((role) => (
                          <option key={role} value={role}>{USER_ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`screen-${user.username}`} className="block text-xs font-medium text-slate-600 mb-1">
                        Default screen
                      </label>
                      <select
                        id={`screen-${user.username}`}
                        value={draft.defaultScreen}
                        onChange={(e) => setDraft({ ...draft, defaultScreen: e.target.value as DefaultScreen })}
                        className={`w-full ${inputClass}`}
                      >
                        {DEFAULT_SCREENS.map((screen) => (
                          <option key={screen} value={screen}>{DEFAULT_SCREEN_LABELS[screen]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-3 flex gap-2">
                      <button
                        type="submit"
                        disabled={rowBusy}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        Save changes
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditFor(null);
                          setDraft(null);
                        }}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

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
                        className={inputClass}
                      />
                    </div>
                    <button type="submit" disabled={rowBusy}
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
