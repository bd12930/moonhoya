import { getCloudflareContext } from '@opennextjs/cloudflare';

interface InventoryItem {
  id: string;
  sku: string;
  potSizeInches: number;
  quantity: number;
  greenhouseZone: string;
  priceCents: number;
  updatedAt: string;
  commonName: string;
  botanicalName: string;
  sunReq: string;
  imageUrl?: string;
}

async function getInventoryData(): Promise<{ items: InventoryItem[]; error?: string }> {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return { items: [], error: 'D1 Database binding not found.' };
    }

    const { results } = await env.DB.prepare(`
      SELECT
        B.id, B.sku, B.potSizeInches, B.quantity, B.greenhouseZone, B.priceCents, B.updatedAt,
        S.commonName, S.botanicalName, S.sunReq, S.imageUrl
      FROM InventoryBatch B
      JOIN PlantSpecies S ON B.speciesId = S.id
      ORDER BY B.updatedAt DESC
    `).all();

    return { items: (results as InventoryItem[]) ?? [] };
  } catch (err: unknown) {
    return { items: [], error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Map the raw sunReq enum to a human-friendly label. */
function formatSunReq(raw: string): string {
  switch (raw) {
    case 'FULL_SUN':       return '☀️ Full Sun';
    case 'INDIRECT_LIGHT': return '🌤 Indirect Light';
    case 'PARTIAL_SHADE':  return '🌥 Partial Shade';
    default:               return raw;
  }
}

/** Format an ISO date string as "MMM D, YYYY HH:MM" without constructing two Date objects. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default async function MoonhoyaDashboard() {
  const { items, error } = await getInventoryData();

  const totalUnits   = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalBatches = items.length;

  return (
    <main className="min-h-screen bg-emerald-50/30 text-slate-800 p-6 md:p-12">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-emerald-200 pb-6 mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🌿</span>
              <h1 className="text-3xl font-bold tracking-tight text-emerald-900">Moonhoya Dashboard</h1>
            </div>
            <p className="text-slate-600 mt-1">Nursery Inventory &amp; Greenhouse Management System (Cloudflare D1)</p>
          </div>
          <div className="flex gap-3">
            <div className="bg-white border border-emerald-200 rounded-lg px-4 py-2 shadow-sm text-center">
              <span className="block text-xs font-semibold text-emerald-600 uppercase tracking-wider">Total Stock</span>
              <span className="text-xl font-bold text-slate-900">{totalUnits} units</span>
            </div>
            <div className="bg-white border border-emerald-200 rounded-lg px-4 py-2 shadow-sm text-center">
              <span className="block text-xs font-semibold text-emerald-600 uppercase tracking-wider">Active Batches</span>
              <span className="text-xl font-bold text-slate-900">{totalBatches}</span>
            </div>
          </div>
        </header>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg text-red-700">
            <p className="font-bold">Database Error</p>
            <p>{error}</p>
          </div>
        )}

        {/* Inventory Table */}
        {items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-emerald-100 p-12 text-center shadow-sm">
            <div className="text-4xl mb-3">🌱</div>
            <h3 className="text-lg font-medium text-slate-900">No inventory batches found</h3>
            <p className="text-slate-500 mt-1 max-w-md mx-auto">
              Scan your first plant using your API endpoint (<code className="text-emerald-700">/api/inventory/scan</code>) to populate live nursery stock here.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-emerald-50/60 border-b border-emerald-100 text-xs font-semibold text-emerald-900 uppercase tracking-wider">
                    <th className="py-4 px-6">Plant Species</th>
                    <th className="py-4 px-6">SKU / Pot Size</th>
                    <th className="py-4 px-6">Light</th>
                    <th className="py-4 px-6">Greenhouse Zone</th>
                    <th className="py-4 px-6">Quantity</th>
                    <th className="py-4 px-6">Price</th>
                    <th className="py-4 px-6">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-50 text-sm">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-emerald-50/30 transition-colors">
                      <td className="py-4 px-6">
                        <div className="font-semibold text-slate-900">{item.commonName}</div>
                        <div className="text-xs italic text-emerald-700">{item.botanicalName}</div>
                      </td>
                      <td className="py-4 px-6">
                        <span className="inline-block bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md font-mono text-xs font-medium">
                          {item.sku}
                        </span>
                        <div className="text-xs text-slate-500 mt-1">{item.potSizeInches}&quot; Pot</div>
                      </td>
                      <td className="py-4 px-6 text-xs text-slate-600">
                        {formatSunReq(item.sunReq)}
                      </td>
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center gap-1.5 bg-emerald-100/70 text-emerald-800 px-2.5 py-1 rounded-full text-xs font-medium">
                          📍 {item.greenhouseZone}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className="font-bold text-slate-900 text-base">{item.quantity}</span> units
                      </td>
                      <td className="py-4 px-6 font-medium text-slate-700">
                        ${(item.priceCents / 100).toFixed(2)}
                      </td>
                      <td className="py-4 px-6 text-xs text-slate-500">
                        {formatDate(item.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
