import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { SESSION_COOKIE } from '@/lib/auth';
import { getCurrentUser } from '@/lib/access';
import { listUsers } from '@/lib/users';
import AdminUsersClient from './admin-users-client';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const cookieStore = await cookies();
  const user = await getCurrentUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/dashboard');

  const { env } = await getCloudflareContext({ async: true });
  const users = await listUsers(env.DB);

  return <AdminUsersClient currentUsername={user.username} initialUsers={users} />;
}
