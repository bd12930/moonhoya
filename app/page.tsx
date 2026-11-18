import { permanentRedirect } from 'next/navigation';

/**
 * Root route — permanently redirects to the canonical dashboard page.
 * All inventory UI lives at /dashboard.
 */
export default function RootPage() {
  permanentRedirect('/dashboard');
}
