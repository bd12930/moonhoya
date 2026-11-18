'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatPrice, type CategorySetting, type CurrencySetting } from '@/lib/settings';

export interface DashboardItem {
  id: string;
  sku: string;
  speciesId?: string;
  potSizeInches: number;
  quantity: number;
  greenhouseZone: string;
  priceCents: number;
  updatedAt: string;
  category?: string;
  commonName: string;
  botanicalName: string;
  sunReq: string;
  imageUrl?: string;
}

interface DashboardClientProps {
  initialItems: DashboardItem[];
  currency: CurrencySetting;
  categories?: CategorySetting[];
}

const LIGHT_OPTIONS = [
  { value: 'ALL', label: 'All Light Levels', icon: '☀️' },
  { value: 'INDIRECT_LIGHT', label: 'Indirect Light (Bright Filtered)', icon: '🌤' },
  { value: 'FULL_SUN', label: 'Full Sun (Direct)', icon: '☀️' },
  { value: 'PARTIAL_SHADE', label: 'Partial Shade (Low/Medium)', icon: '🌥' },
];

const CATEGORY_FILTERS = [
  { id: 'ALL', label: 'All Categories', icon: '📦' },
  { id: 'PLANT', label: 'Plants', icon: '🌿' },
  { id: 'FERTILIZER', label: 'Fertilizer', icon: '🧪' },
  { id: 'POT', label: 'Pots', icon: '🪴' },
  { id: 'EQUIPMENT', label: 'Equipment', icon: '🛠️' },
  { id: 'HARDWARE', label: 'Hardware', icon: '🔩' },
];

export default function DashboardClient({ initialItems, currency, categories }: DashboardClientProps) {
  const categoryOptions = categories && categories.length > 0
    ? [{ id: "ALL", label: "All Categories", icon: "📦" }, ...categories.map((c) => ({ id: c.id, label: c.label, icon: c.icon }))]
    : CATEGORY_FILTERS;
  const [items, setItems] = useState<DashboardItem[]>(initialItems);

  // Sidebar & Help State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [activeHelpSection, setActiveHelpSection] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [lightFilter, setLightFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('PLANT');
  const [zoneFilter, setZoneFilter] = useState('ALL');

  // Updating light information state
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Edit Modal State
  const [editingItem, setEditingItem] = useState<DashboardItem | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Extract unique greenhouse zones from items
  const uniqueZones = Array.from(new Set(items.map((i) => i.greenhouseZone).filter(Boolean)));

  // Filter items based on category and other filters
  const filteredItems = items.filter((item) => {
    // Light filter
    if (lightFilter !== 'ALL' && item.sunReq !== lightFilter) return false;

    // Category filter
    const cat = item.category || 'PLANT';
    if (categoryFilter !== 'ALL' && cat !== categoryFilter) return false;

    // Zone filter
    if (zoneFilter !== 'ALL' && item.greenhouseZone !== zoneFilter) return false;

    // Search query
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase();
      const matchCommon = item.commonName.toLowerCase().includes(q);
      const matchBot = item.botanicalName.toLowerCase().includes(q);
      const matchSku = item.sku.toLowerCase().includes(q);
      const matchZone = item.greenhouseZone.toLowerCase().includes(q);
      return matchCommon || matchBot || matchSku || matchZone;
    }

    return true;
  });

  // Dynamic Metrics
  const totalUnits = filteredItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalBatches = filteredItems.length;
  const totalInventoryCents = filteredItems.reduce((sum, item) => sum + item.quantity * item.priceCents, 0);

  // Quick In-place Light Requirement Update
  async function handleQuickLightUpdate(itemId: string, newLight: string) {
    setUpdatingItemId(itemId);
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: itemId, sunReq: newLight }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setItems((prev) =>
          prev.map((it) => (it.id === itemId ? { ...it, sunReq: newLight } : it))
        );
        const lightLabel = LIGHT_OPTIONS.find((l) => l.value === newLight)?.label || newLight;
        setSuccessToast(`Updated light requirement to "${lightLabel}"!`);
        setTimeout(() => setSuccessToast(null), 3000);
      } else {
        alert(data.error || 'Failed to update light information');
      }
    } catch (e: unknown) {
      alert(`Error updating light: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setUpdatingItemId(null);
    }
  }

  // Save full edit
  async function handleSaveEdit() {
    if (!editingItem) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingItem.id,
          quantity: editingItem.quantity,
          greenhouseZone: editingItem.greenhouseZone,
          potSizeInches: editingItem.potSizeInches,
          priceCents: editingItem.priceCents,
          sunReq: editingItem.sunReq,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setItems((prev) =>
          prev.map((it) => (it.id === editingItem.id ? { ...editingItem } : it))
        );
        setEditingItem(null);
        setSuccessToast('Inventory batch & light requirements saved!');
        setTimeout(() => setSuccessToast(null), 3000);
      } else {
        alert(data.error || 'Failed to save changes');
      }
    } catch (e: unknown) {
      alert(`Error saving batch: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsSavingEdit(false);
    }
  }

  // Delete batch
  async function handleDelete(batchId: string) {
    try {
      const res = await fetch(`/api/inventory?id=${encodeURIComponent(batchId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setItems((prev) => prev.filter((it) => it.id !== batchId));
        setDeletingId(null);
        setSuccessToast('Batch removed from inventory.');
        setTimeout(() => setSuccessToast(null), 3000);
      } else {
        alert(data.error || 'Failed to delete');
      }
    } catch (e: unknown) {
      alert(`Delete error: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }

  return (
    <div className="min-h-screen bg-emerald-50/20 text-slate-800 flex flex-col">

      {/* Collapsible Sidebar Menu */}
      <aside
        className={
          `fixed left-0 top-0 h-full bg-white border-r border-emerald-200/80 transition-all duration-300 ease-in-out z-30
           ${isSidebarOpen ? 'w-64' : 'w-20'}
          `
        }
      >
        <div className="flex flex-col h-full">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-emerald-200/80 bg-emerald-50/50">
            <div className="flex items-center justify-between">
              {isSidebarOpen && (
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🌿</span>
                  <h2 className="text-lg font-bold text-emerald-900">Moonhoya</h2>
                </div>
              )}
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-2 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 transition-colors"
              >
                {isSidebarOpen ? '◀' : '▶'}
              </button>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="flex-1 p-3 space-y-2">
            {/* Dashboard Link */}
            <button
              onClick={() => setCategoryFilter('PLANT')}
              className={
                `w-full flex items-center gap-3 p-3 rounded-xl transition-all font-medium text-sm
                 ${categoryFilter === 'PLANT' 
                   ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                   : 'text-slate-600 hover:bg-emerald-50/50 hover:text-emerald-700'
                 }`
              }
            >
              <span className="text-xl">📊</span>
              {isSidebarOpen && <span>Dashboard</span>}
            </button>

            {/* Settings Link */}
            <Link
              href="/settings"
              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all font-medium text-sm text-slate-600 hover:bg-emerald-50/50 hover:text-emerald-700"
            >
              <span className="text-xl">⚙️</span>
              {isSidebarOpen && <span>Settings</span>}
            </Link>

            {/* Help Link */}
            <button
              onClick={() => {
                if (!isSidebarOpen) setIsSidebarOpen(true);
                setIsHelpOpen(!isHelpOpen);
              }}
              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all font-medium text-sm text-slate-600 hover:bg-emerald-50/50 hover:text-emerald-700"
            >
              <span className="text-xl">❓</span>
              {isSidebarOpen && <span>Help & Index</span>}
            </button>

            {/* Collapsible Category Selection */}
            {isSidebarOpen && (
              <div className="mt-4 p-3 bg-emerald-50/30 rounded-xl border border-emerald-200/60">
                <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-2">
                  Display Category
                </div>
                <div className="space-y-1">
                  {categoryOptions.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setCategoryFilter(cat.id)}
                      className={
                        `w-full text-left p-2 rounded-lg text-sm transition-all
                         ${categoryFilter === cat.id
                           ? 'bg-emerald-200 text-emerald-900 font-semibold'
                           : 'text-slate-600 hover:bg-emerald-100'
                         }`
                      }
                    >
                      <span className="inline-block w-5 text-center mr-2">{cat.icon}</span>
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </nav>

          {/* Help Section */}
          {isHelpOpen && isSidebarOpen && (
            <div className="mx-3 mb-3 bg-slate-50 rounded-xl border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                Quick Index
              </div>
              <div className="space-y-1 text-xs">
                <button
                  onClick={() => setActiveHelpSection('inventory')}
                  className="block w-full text-left p-2 rounded-lg hover:bg-emerald-100 text-slate-600"
                >
                  📋 Inventory Management
                </button>
                <button
                  onClick={() => setActiveHelpSection('scanner')}
                  className="block w-full text-left p-2 rounded-lg hover:bg-emerald-100 text-slate-600"
                >
                  📷 Mobile Scanner
                </button>
                <button
                  onClick={() => setActiveHelpSection('categories')}
                  className="block w-full text-left p-2 rounded-lg hover:bg-emerald-100 text-slate-600"
                >
                  🏷️ Categories & Settings
                </button>
                <button
                  onClick={() => setActiveHelpSection('reports')}
                  className="block w-full text-left p-2 rounded-lg hover:bg-emerald-100 text-slate-600"
                >
                  📊 Reports & Analytics
                </button>
              </div>

              {activeHelpSection && (
                <div className="mt-3 p-2 bg-emerald-50 rounded-lg border border-emerald-200 text-xs">
                  <div className="font-semibold text-emerald-800 mb-1">
                    {activeHelpSection === 'inventory' && 'Inventory Management'}
                    {activeHelpSection === 'scanner' && 'Mobile Scanner'}
                    {activeHelpSection === 'categories' && 'Categories & Settings'}
                    {activeHelpSection === 'reports' && 'Reports & Analytics'}
                  </div>
                  <div className="text-slate-600 space-y-1">
                    {activeHelpSection === 'inventory' && (
                      <>Manage inventory batches, update quantities, edit plant details, and delete items. Use filters to focus on specific categories or light requirements.</>
                    )}
                    {activeHelpSection === 'scanner' && (
                      <>Scan plant photos to identify species, capture new inventory, and update master catalog. Perfect for fieldwork and mobile data collection.</>
                    )}
                    {activeHelpSection === 'categories' && (
                      <>Configure item categories, pricing currency, greenhouse locations, and pot sizes. Settings sync across all devices and applications.</>
                    )}
                    {activeHelpSection === 'reports' && (
                      <>View inventory analytics, value summaries, and category distributions. Export data for record-keeping and reporting.</>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer in Sidebar */}
          <div className="p-4 border-t border-emerald-200/80 bg-emerald-50/30">
            {isSidebarOpen ? (
              <div className="text-center">
                <div className="text-xs text-emerald-900 font-semibold">Moonhoya Nursery</div>
                <div className="text-xs text-slate-500 mt-1">Management System</div>
                <div className="text-xs text-slate-400 mt-2">Design by Budi Setiawan</div>
                <div className="text-xs text-slate-400">18 November 2026</div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-xs text-emerald-900 font-semibold">MS</div>
                <div className="text-xs text-slate-400">BS - 18 Nov</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content with Sidebar Offset */}
      <div
        className={`flex-1 p-6 space-y-6 transition-all duration-300 ease-in-out ${isSidebarOpen ? 'ml-64' : 'ml-20'}`}
      >

      {/* Toast feedback */}
      {successToast && (
        <div className="bg-emerald-800 text-white font-medium px-4 py-3 rounded-2xl shadow-lg border border-emerald-600 flex items-center gap-2 animate-bounce">
          <span>✅</span>
          <span>{successToast}</span>
        </div>
      )}

      {/* Metric Cards (Reflect Filtered Results) */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
        <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
          <span className="block text-xs font-bold text-emerald-700 uppercase tracking-wider">
            Filtered Total Stock
          </span>
          <span className="text-2xl font-black text-slate-900 mt-1 block">
            {totalUnits.toLocaleString()} <span className="text-sm font-semibold text-slate-500">units</span>
          </span>
        </div>

        <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
          <span className="block text-xs font-bold text-emerald-700 uppercase tracking-wider">
            Active Batches
          </span>
          <span className="text-2xl font-black text-slate-900 mt-1 block">
            {totalBatches} <span className="text-sm font-semibold text-slate-500">batches</span>
          </span>
        </div>

        <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm col-span-2 md:col-span-1">
          <span className="block text-xs font-bold text-emerald-700 uppercase tracking-wider">
            Est. Inventory Value
          </span>
          <span className="text-2xl font-black text-emerald-800 font-mono mt-1 block">
            {formatPrice(totalInventoryCents, currency)}
          </span>
        </div>
      </div>

      {/* FILTER CONTROLS BAR */}
      <section className="bg-white border border-emerald-200/90 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔍</span>
            <span className="font-bold text-slate-900 text-sm uppercase tracking-wide">
              Filter Inventory
            </span>
          </div>

          {(searchTerm || lightFilter !== 'ALL' || categoryFilter !== 'ALL' || zoneFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setLightFilter('ALL');
                setCategoryFilter('ALL');
                setZoneFilter('ALL');
              }}
              className="text-xs text-emerald-700 font-semibold hover:underline flex items-center gap-1 self-start md:self-auto"
            >
              ✕ Clear All Filters
            </button>
          )}
        </div>

        {/* Filter Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. Real-time Search Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Search Item, SKU, or Species:
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 text-sm">🔎</span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="e.g. Hoya carnosa, MH-..., Zone A..."
                className="w-full bg-slate-50 border border-slate-500 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* 2. Light Requirement Filter (Requested) */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              ☀️ Filter by Light Requirement:
            </label>
            <select
              value={lightFilter}
              onChange={(e) => setLightFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-500 rounded-xl px-3 py-2 text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {LIGHT_OPTIONS.map((lo) => (
                <option key={lo.value} value={lo.value}>
                  {lo.icon} {lo.label}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Category Filter */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              🏷️ Filter by Category:
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-500 rounded-xl px-3 py-2 text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {categoryOptions.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.icon} {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Greenhouse Zone Filter */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              📍 Filter by Greenhouse Zone:
            </label>
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-500 rounded-xl px-3 py-2 text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All Zones ({uniqueZones.length})</option>
              {uniqueZones.map((z) => (
                <option key={z} value={z}>
                  📍 {z}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick Light Filter Chips */}
        <div className="pt-2 border-t border-emerald-100 flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-500 font-semibold mr-1">Quick Light Filter:</span>
          {LIGHT_OPTIONS.map((lo) => (
            <button
              key={lo.value}
              type="button"
              onClick={() => setLightFilter(lo.value)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${
                lightFilter === lo.value
                  ? 'bg-emerald-600 text-white font-bold shadow-sm'
                  : 'bg-emerald-50/80 text-emerald-900 hover:bg-emerald-100 border border-emerald-200'
              }`}
            >
              <span>{lo.icon}</span> <span>{lo.value === 'ALL' ? 'All' : lo.label.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </section>

      {/* INVENTORY TABLE */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-emerald-100 p-12 text-center shadow-sm">
          <div className="text-4xl mb-3">🌱</div>
          <h3 className="text-lg font-bold text-slate-900">No matching inventory items found</h3>
          <p className="text-slate-500 mt-1 max-w-md mx-auto text-sm">
            Try adjusting your search query, light requirement filter, or category selection.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-emerald-50/70 border-b border-emerald-100 text-xs font-bold text-emerald-950 uppercase tracking-wider">
                  <th className="py-4 px-5">Plant / Item Species</th>
                  <th className="py-4 px-4">SKU / Pot</th>
                  <th className="py-4 px-4">
                    <span className="flex items-center gap-1">
                      ☀️ Light Requirement
                      <span className="text-[10px] bg-emerald-200/60 text-emerald-900 px-1.5 py-0.5 rounded font-normal normal-case">
                        Editable
                      </span>
                    </span>
                  </th>
                  <th className="py-4 px-4">Greenhouse Zone</th>
                  <th className="py-4 px-4">Stock</th>
                  <th className="py-4 px-4">Price</th>
                  <th className="py-4 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-50 text-sm">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-emerald-50/30 transition-colors">
                    {/* Species & Image */}
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-3">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.commonName}
                            className="w-12 h-12 rounded-xl object-cover border border-emerald-200 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-xl flex-shrink-0">
                            🌿
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-slate-900 text-base">{item.commonName}</div>
                          <div className="text-xs italic text-emerald-800">{item.botanicalName}</div>
                          {item.category && item.category !== 'PLANT' && (
                            <span className="inline-block mt-1 bg-slate-100 text-slate-600 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded">
                              {item.category}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* SKU & Pot size */}
                    <td className="py-3.5 px-4">
                      <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-mono text-xs font-semibold">
                        {item.sku}
                      </span>
                      <div className="text-xs text-slate-500 mt-1">
                        {item.potSizeInches > 0 ? `${item.potSizeInches}" Pot` : 'N/A'}
                      </div>
                    </td>

                    {/* LIGHT REQUIREMENT (DIRECTLY EDITABLE) */}
                    <td className="py-3.5 px-4">
                      <div className="space-y-1">
                        {/* Interactive Dropdown to update light information on the fly */}
                        <select
                          value={item.sunReq}
                          disabled={updatingItemId === item.id}
                          onChange={(e) => handleQuickLightUpdate(item.id, e.target.value)}
                          className="bg-white border border-emerald-300 rounded-lg text-xs font-semibold text-slate-800 px-2.5 py-1.5 shadow-sm hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                          title="Click to update light requirements for this plant"
                        >
                          <option value="INDIRECT_LIGHT">🌤 Indirect Light</option>
                          <option value="FULL_SUN">☀️ Full Sun</option>
                          <option value="PARTIAL_SHADE">🌥 Partial Shade</option>
                        </select>

                        {updatingItemId === item.id && (
                          <span className="block text-[11px] text-emerald-600 animate-pulse font-medium">
                            Saving light...
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Greenhouse Zone */}
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1.5 bg-emerald-100/70 text-emerald-800 px-2.5 py-1 rounded-full text-xs font-semibold">
                        📍 {item.greenhouseZone}
                      </span>
                    </td>

                    {/* Quantity */}
                    <td className="py-3.5 px-4">
                      <span className="font-black text-slate-900 text-base">{item.quantity}</span>{' '}
                      <span className="text-xs text-slate-500">units</span>
                    </td>

                    {/* Price */}
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      {formatPrice(item.priceCents, currency)}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingItem(item)}
                          className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors border border-emerald-200"
                          title="Edit batch and light"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(item.id)}
                          className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition-colors border border-red-200"
                          title="Delete batch"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EDIT MODAL FOR BATCH & LIGHT INFO */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-emerald-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Edit Inventory Item</h3>
                <p className="text-xs text-slate-500">{editingItem.commonName} ({editingItem.sku})</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-sm">
              {/* Light Information Editor */}
              <div>
                <label className="block text-xs font-bold text-emerald-800 mb-1">
                  ☀️ Update Light Information:
                </label>
                <select
                  value={editingItem.sunReq}
                  onChange={(e) => setEditingItem({ ...editingItem, sunReq: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 font-semibold focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="INDIRECT_LIGHT">🌤 Indirect Light (Bright Filtered)</option>
                  <option value="FULL_SUN">☀️ Full Sun (Direct Sunlight)</option>
                  <option value="PARTIAL_SHADE">🌥 Partial Shade (Low / Medium Light)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Stock Quantity (Units):</label>
                <input
                  type="number"
                  value={editingItem.quantity}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, quantity: parseInt(e.target.value) || 0 })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Greenhouse Zone:</label>
                <input
                  type="text"
                  value={editingItem.greenhouseZone}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, greenhouseZone: e.target.value })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pot Size (Inches):</label>
                  <input
                    type="number"
                    value={editingItem.potSizeInches}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, potSizeInches: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Price (Cents):</label>
                  <input
                    type="number"
                    value={editingItem.priceCents}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, priceCents: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono text-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md"
              >
                {isSavingEdit ? 'Saving...' : 'Save Updates'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-red-200 text-center">
            <div className="text-4xl">⚠️</div>
            <h3 className="text-lg font-bold text-slate-900">Delete Inventory Batch?</h3>
            <p className="text-xs text-slate-500">
              Are you sure you want to delete this batch from Cloudflare D1?
            </p>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deletingId)}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm"
              >
                Delete
              </button>

            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}