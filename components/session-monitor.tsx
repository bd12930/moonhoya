'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/** Sign out after this long with no user activity. Must match SESSION_IDLE_SECONDS in lib/auth.ts. */
const IDLE_LIMIT_MS = 10 * 60 * 1000;
/** How often the client checks idleness. */
const TICK_MS = 15 * 1000;
/** While the user is active, refresh the server session at most this often. */
const KEEPALIVE_MS = 2 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'scroll', 'touchstart', 'wheel'] as const;

/**
 * Signs the user out after 10 minutes of inactivity and renders a Log out button.
 * Activity is tracked in the browser; the server cookie also expires on the same window,
 * so a closed tab cannot keep the session alive.
 */
export default function SessionMonitor() {
  const pathname = usePathname();
  const hidden = pathname === '/login';
  const [loggingOut, setLoggingOut] = useState(false);
  const lastActivity = useRef(0);
  const lastPing = useRef(0);

  useEffect(() => {
    if (hidden) return;

    lastActivity.current = Date.now();
    lastPing.current = Date.now();

    const markActive = () => {
      lastActivity.current = Date.now();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }

    const endSession = async (reason: 'idle' | 'expired') => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', redirect: 'manual' });
      } finally {
        window.location.assign(`/login?reason=${reason}`);
      }
    };

    const timer = window.setInterval(() => {
      const now = Date.now();

      if (now - lastActivity.current >= IDLE_LIMIT_MS) {
        window.clearInterval(timer);
        void endSession('idle');
        return;
      }

      // Only ping while the user is active, so an idle tab cannot keep the session alive.
      const activeSincePing = lastActivity.current > lastPing.current;
      if (activeSincePing && now - lastPing.current >= KEEPALIVE_MS) {
        lastPing.current = now;
        fetch('/api/auth/session', { cache: 'no-store' })
          .then((res) => {
            if (res.status === 401) {
              window.clearInterval(timer);
              window.location.assign('/login?reason=expired');
            }
          })
          .catch(() => {
            // Network blip: the next tick retries.
          });
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
    };
  }, [hidden]);

  if (hidden) return null;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', redirect: 'manual' });
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loggingOut}
      className="fixed bottom-4 right-4 z-50 rounded-full border border-emerald-200 bg-white/90 px-4 py-2 text-sm font-semibold text-emerald-800 shadow-md backdrop-blur-sm hover:bg-emerald-50 disabled:opacity-60"
    >
      {loggingOut ? 'Logging out…' : 'Log out'}
    </button>
  );
}
