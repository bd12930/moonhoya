// Dashboard-level loading skeleton shown while the async Server Component resolves.
export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-emerald-50/30 text-slate-800 p-6 md:p-12">
      <div className="max-w-6xl mx-auto">
        {/* Header skeleton */}
        <header className="border-b border-emerald-200 pb-6 mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">🌿</span>
            <div className="h-8 w-64 bg-emerald-100 rounded animate-pulse" />
          </div>
          <div className="h-4 w-80 bg-emerald-50 rounded animate-pulse mt-2" />
        </header>

        {/* Metric cards skeleton */}
        <div className="flex gap-3 mb-8">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="bg-white border border-emerald-200 rounded-lg px-4 py-2 shadow-sm w-36 h-14 animate-pulse"
            />
          ))}
        </div>

        {/* Table skeleton */}
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
          <div className="p-6 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-emerald-50 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
