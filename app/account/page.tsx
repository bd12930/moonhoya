'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

export default function AccountPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not change password.');
      } else {
        setSuccess('Password changed.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';

  return (
    <div className="min-h-screen bg-emerald-50/40 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-emerald-200/80 p-8">
        <h1 className="text-xl font-bold text-emerald-900 mb-1">Change password</h1>
        <p className="text-sm text-slate-500 mb-6">Passwords are case-sensitive.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-slate-700 mb-1">Current password</label>
            <input id="currentPassword" type="password" autoComplete="current-password" required
              value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700 mb-1">New password</label>
            <input id="newPassword" type="password" autoComplete="new-password" required minLength={6}
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</label>
            <input id="confirmPassword" type="password" autoComplete="new-password" required minLength={6}
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} />
          </div>

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}

          <button type="submit" disabled={submitting}
            className="w-full rounded-lg bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {submitting ? 'Saving…' : 'Change password'}
          </button>
        </form>

        <Link href="/dashboard" className="block text-center text-sm text-emerald-800 hover:underline mt-6">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
