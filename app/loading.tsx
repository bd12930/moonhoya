// Root-level loading state shown while any top-level async page resolves.
export default function Loading() {
  return (
    <main className="min-h-screen bg-emerald-50/30 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-emerald-100 p-12 text-center shadow-sm">
        <div className="text-4xl mb-3 animate-bounce">🌿</div>
        <p className="text-emerald-700 font-medium animate-pulse">
          Loading Moonhoya Dashboard…
        </p>
      </div>
    </main>
  );
}
