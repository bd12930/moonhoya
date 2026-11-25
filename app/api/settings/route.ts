import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { DEFAULT_SETTINGS, type AppSettingsData } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings
 * Retrieves nursery settings from Cloudflare D1. Falls back to default settings.
 */
export async function GET() {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ success: true, settings: DEFAULT_SETTINGS, source: 'fallback' });
    }

    // Auto-create table if not exists
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS AppSetting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    const { results } = await env.DB.prepare(`SELECT key, value FROM AppSetting`).all<{ key: string; value: string }>();

    const settingsMap: Record<string, unknown> = {};
    if (results && results.length > 0) {
      for (const row of results) {
        try {
          settingsMap[row.key] = JSON.parse(row.value);
        } catch {
          settingsMap[row.key] = row.value;
        }
      }
    }

    const mergedSettings: AppSettingsData = {
      categories: (settingsMap.categories as AppSettingsData['categories'] | undefined) || DEFAULT_SETTINGS.categories,
      currency: (settingsMap.currency as AppSettingsData['currency'] | undefined) || DEFAULT_SETTINGS.currency,
      locations: (settingsMap.locations as AppSettingsData['locations'] | undefined) || DEFAULT_SETTINGS.locations,
      potSizes: (settingsMap.potSizes as AppSettingsData['potSizes'] | undefined) || DEFAULT_SETTINGS.potSizes,
      geminiApiKey: typeof settingsMap.geminiApiKey === 'string' ? settingsMap.geminiApiKey : undefined,
    };

    return NextResponse.json({ success: true, settings: mergedSettings, source: 'd1' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message, settings: DEFAULT_SETTINGS }, { status: 500 });
  }
}

/**
 * POST /api/settings
 * Updates one or more settings in Cloudflare D1.
 * Body: { categories?, currency?, locations?, potSizes? }
 */
export async function POST(request: NextRequest) {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ error: 'Cloudflare D1 database binding not found' }, { status: 500 });
    }

    const body = await request.json();

    // Ensure AppSetting table exists
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS AppSetting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    const allowedKeys: (keyof AppSettingsData)[] = ['categories', 'currency', 'locations', 'potSizes', 'geminiApiKey'];
    const updatedKeys: string[] = [];

    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        const valueJson = JSON.stringify(body[key]);
        await env.DB.prepare(`
          INSERT INTO AppSetting (key, value, updatedAt)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updatedAt = CURRENT_TIMESTAMP
        `).bind(key, valueJson).run();
        updatedKeys.push(key);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Settings updated successfully: ${updatedKeys.join(', ')}`,
      updatedKeys,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
