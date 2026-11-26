'use client';

import { useEffect, useState } from 'react';
import { USER_ROLE_LABELS, type UserRole } from '@/lib/auth';

interface SignedInUser {
  username: string;
  role: UserRole;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Compact status line: signed-in username, role, date and a live clock.
 * Meant to sit directly under a page's logo or title at top-left.
 * Pass showUser={false} on /login, where there is no signed-in user yet.
 */
export default function StatusInfo({
  showUser = true,
  tone = 'light',
  className = '',
}: {
  showUser?: boolean;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const [user, setUser] = useState<SignedInUser | null>(null);
  // Initial value is set during render so the first paint has a time; the interval keeps it current.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showUser) return;
    let cancelled = false;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setUser({ username: data.username, role: data.role });
      })
      .catch(() => {
        // Offline or signed out: show date and time only.
      });
    return () => {
      cancelled = true;
    };
  }, [showUser]);

  const dark = tone === 'dark';
  const userClass = dark ? 'text-white' : 'text-emerald-900';
  const roleClass = dark ? 'text-slate-400' : 'text-slate-500';
  const timeClass = dark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`text-xs ${timeClass} ${className}`} suppressHydrationWarning>
      {showUser && user && (
        <div>
          <span className={`font-semibold ${userClass}`}>@{user.username}</span>
          <span className={roleClass}> · {USER_ROLE_LABELS[user.role]}</span>
        </div>
      )}
      <div suppressHydrationWarning>
        {DATE_FORMAT.format(now)} · {TIME_FORMAT.format(now)}
      </div>
    </div>
  );
}
