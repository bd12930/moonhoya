import Link from 'next/link';
import { cookies } from 'next/headers';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { SESSION_COOKIE } from '@/lib/auth';
import { getCurrentUser } from '@/lib/access';
import { loadDetectionsByBatch } from '@/lib/scan-detections';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CURRENCY,
  DEFAULT_LOCATIONS,
  DEFAULT_POT_SIZES,
  type CategorySetting,
  type CurrencySetting,
  type PotSizeSetting,
} from '@/lib/settings';
import DashboardClient, { type DashboardItem } from './dashboard-client';

// Always render at request time — this page reads live D1 inventory data.
export const dynamic = 'force-dynamic';

async function getInventoryData(): Promise<{
  items: DashboardItem[];
  currency: CurrencySetting;
  categories: CategorySetting[];
  locations: string[];
  potSizes: PotSizeSetting[];
  error?: string;
}> {
  let currency = DEFAULT_CURRENCY;
  let categories = DEFAULT_CATEGORIES;
  let locations = DEFAULT_LOCATIONS;
  let potSizes = DEFAULT_POT_SIZES;

  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return { items: [], currency, categories, locations, potSizes, error: 'D1 Database binding not found.' };
    }

    // Fetch active settings from D1
    try {
      const curRow = await env.DB.prepare(`SELECT value FROM AppSetting WHERE key = 'currency'`).first<{ value: string }>();
      if (curRow?.value) {
        currency = JSON.parse(curRow.value);
      }
    } catch {
      // defaults apply
    }

    try {
      const catRow = await env.DB.prepare(`SELECT value FROM AppSetting WHERE key = 'categories'`).first<{ value: string }>();
      if (catRow?.value) {
        categories = JSON.parse(catRow.value);
      }
    } catch {
      // defaults apply
    }

    try {
      const locRow = await env.DB.prepare(`SELECT value FROM AppSetting WHERE key = 'locations'`).first<{ value: string }>();
      if (locRow?.value) {
        locations = JSON.parse(locRow.value);
      }
    } catch {
      // defaults apply
    }

    try {
      const potRow = await env.DB.prepare(`SELECT value FROM AppSetting WHERE key = 'potSizes'`).first<{ value: string }>();
      if (potRow?.value) {
        potSizes = JSON.parse(potRow.value);
      }
    } catch {
      // defaults apply
    }

    const { results } = await env.DB.prepare(`
      SELECT
        B.id,
        B.sku,
        B.speciesId,
        B.potSizeInches,
        B.quantity,
        B.greenhouseZone,
        B.priceCents,
        B.updatedAt,
        COALESCE(S.category, 'PLANT') AS category,
        S.commonName,
        S.botanicalName,
        S.sunReq,
        S.imageUrl
      FROM InventoryBatch B
      JOIN PlantSpecies S ON B.speciesId = S.id
      ORDER BY B.updatedAt DESC
    `).all();

    // Attach each kind's full photo gallery (slot order) for the item detail view
    const { results: photoRows } = await env.DB.prepare(
      `SELECT speciesId, imageUrl FROM PlantSpeciesPhoto ORDER BY slot ASC, createdAt ASC, id ASC`
    ).all<{ speciesId: string; imageUrl: string }>();

    const photosBySpecies = new Map<string, string[]>();
    for (const row of photoRows ?? []) {
      const list = photosBySpecies.get(row.speciesId) ?? [];
      list.push(row.imageUrl);
      photosBySpecies.set(row.speciesId, list);
    }

    const detectionsByBatch = await loadDetectionsByBatch(env.DB);

    const items = ((results as DashboardItem[]) ?? []).map((item) => {
      const photos = item.speciesId ? photosBySpecies.get(item.speciesId) ?? [] : [];
      return {
        ...item,
        photos,
        photoCount: photos.length,
        aiDetections: detectionsByBatch.get(item.id) ?? [],
      };
    });

    return { items, currency, categories, locations, potSizes };
  } catch (err: unknown) {
    return { items: [], currency, categories, locations, potSizes, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export default async function MoonhoyaDashboard() {
  const { items, currency, categories, locations, potSizes, error } = await getInventoryData();
  const cookieStore = await cookies();
  const currentUser = await getCurrentUser(cookieStore.get(SESSION_COOKIE)?.value);
  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="min-h-screen bg-emerald-50/20 text-slate-800 flex flex-col">
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 m-4 rounded-r-lg text-red-700 shadow-sm">
          <p className="font-bold">Database Notice</p>
          <p>{error}</p>
        </div>
      )}

      {/* Main Interactive Dashboard with Collapsible Sidebar Index */}
      <DashboardClient
        initialItems={items}
        currency={currency}
        categories={categories}
        locations={locations}
        potSizes={potSizes}
        isAdmin={isAdmin}
      />

      {/* Required Footer Page */}
      <footer className="border-t border-emerald-200/80 bg-white/80 backdrop-blur-sm py-5 px-6 text-center text-xs text-slate-500 font-medium">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-emerald-900 font-semibold">
            <span>🌿</span>
            <span>Moonhoya Nursery Management System</span>
          </div>
          <div className="flex items-center gap-4">
            {currentUser && (
              <div className="flex items-center gap-3 text-slate-600 font-medium">
                <Link href="/account" className="hover:text-emerald-800 underline-offset-2 hover:underline">
                  Account ({currentUser.username})
                </Link>
                {isAdmin && (
                  <Link href="/admin/users" className="hover:text-emerald-800 underline-offset-2 hover:underline">
                    Manage users
                  </Link>
                )}
              </div>
            )}
            <div className="text-slate-600 font-medium">
              Design by Budi Setiawan - 18 November 2026
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
