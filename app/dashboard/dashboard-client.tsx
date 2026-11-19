'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  DEFAULT_LOCATIONS,
  DEFAULT_POT_SIZES,
  formatPrice,
  type CategorySetting,
  type CurrencySetting,
  type PotSizeSetting,
} from '@/lib/settings';

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
  /** Full photo gallery from PlantSpeciesPhoto (oldest first) */
  photos?: string[];
  photoCount?: number;
}

interface DashboardClientProps {
  initialItems: DashboardItem[];
  currency: CurrencySetting;
  categories?: CategorySetting[];
  locations?: string[];
  potSizes?: PotSizeSetting[];
}

// Currencies that are not shown with fractional (cent) digits
const ZERO_DECIMAL_CURRENCIES = ['IDR', 'JPY', 'KRW', 'VND'];

const R2_PUBLIC_BASE = 'https://pub-r2.moonhoya.com/';

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

// Resolve a stored image reference to a loadable URL.
// Full URLs pass through; bare filenames (as written by the scanner) live in the R2 bucket.
function getValidImageUrl(url?: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  return `${R2_PUBLIC_BASE}${trimmed.replace(/^\/+/, '')}`;
}

// Convert a stored cents value to the major-unit text shown in the price input
function centsToInputText(cents: number, currencyCode: string): string {
  if (ZERO_DECIMAL_CURRENCIES.includes(currencyCode)) {
    return String(Math.round(cents / 100));
  }
  return (cents / 100).toFixed(2);
}

// Convert the price input text (major units) back to cents
function inputTextToCents(text: string, currencyCode: string): number {
  const value = parseFloat(text.replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 0) return 0;
  if (ZERO_DECIMAL_CURRENCIES.includes(currencyCode)) {
    return Math.round(value) * 100;
  }
  return Math.round(value * 100);
}

export default function DashboardClient({ initialItems, currency, categories, locations, potSizes }: DashboardClientProps) {
  const zoneOptions = locations && locations.length > 0 ? locations : DEFAULT_LOCATIONS;
  const potSizeOptions = potSizes && potSizes.length > 0 ? potSizes : DEFAULT_POT_SIZES;
  // Image URLs that failed to load; these render a visible placeholder instead of disappearing
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const categoryOptions = categories && categories.length > 0
    ? [{ id: "ALL", label: "All Categories", icon: "📦" }, ...categories.map((c) => ({ id: c.id, label: c.label, icon: c.icon }))]
    : CATEGORY_FILTERS;
  const [items, setItems] = useState<DashboardItem[]>(initialItems);

  // Sidebar & Help State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [lightFilter, setLightFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('PLANT');
  const [zoneFilter, setZoneFilter] = useState('ALL');

  // Help Modal State
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  // Edit Modal State
  const [editingItem, setEditingItem] = useState<DashboardItem | null>(null);
  const [editPriceText, setEditPriceText] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  function openEditModal(item: DashboardItem) {
    setEditPriceText(centsToInputText(item.priceCents, currency.code));
    setEditingItem(item);
  }

  function markImageFailed(src: string) {
    setFailedImages((prev) => {
      if (prev.has(src)) return prev;
      const next = new Set(prev);
      next.add(src);
      return next;
    });
  }

  // View Item Details & Image Slider Modal State
  const [viewingItem, setViewingItem] = useState<DashboardItem | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Extract unique greenhouse zones from items
  const uniqueZones = Array.from(new Set(items.map((i) => i.greenhouseZone).filter(Boolean)));

  // Filter items based on category and other filters
  const filteredItems = items.filter((item) => {
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

  // Save full edit
  async function handleSaveEdit() {
    if (!editingItem) return;
    const updated: DashboardItem = {
      ...editingItem,
      quantity: Math.max(0, Math.round(editingItem.quantity)),
      priceCents: inputTextToCents(editPriceText, currency.code),
    };
    setIsSavingEdit(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: updated.id,
          quantity: updated.quantity,
          greenhouseZone: updated.greenhouseZone,
          potSizeInches: updated.potSizeInches,
          priceCents: updated.priceCents,
          sunReq: updated.sunReq,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
        setEditingItem(null);
      }
    } catch (e: unknown) {
      alert(`Error saving batch: ${e instanceof Error ? e.message : 'Unknown error'}`);
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
      }
    } catch (e: unknown) {
      alert(`Delete error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  return (
    <div className="min-h-screen bg-emerald-50/20 text-slate-800 flex flex-col">

      {/* Collapsible Sidebar Menu */}
      <aside
        className={`fixed left-0 top-0 h-full bg-white border-r border-emerald-200/85 transition-all duration-300 ease-in-out z-30
           ${isSidebarOpen ? 'w-64' : 'w-20'}
          `}
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
                type="button"
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
              type="button"
              onClick={() => {
                setCategoryFilter('PLANT');
                setShowFilters(false);
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all font-medium text-sm
                 ${categoryFilter === 'PLANT'
                   ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                   : 'text-slate-600 hover:bg-emerald-50/50 hover:text-emerald-700'
                 }`}
            >
              <span className="text-xl">📊</span>
              {isSidebarOpen && <span>Dashboard</span>}
            </button>

            {/* Mobile Scanner Link */}
            <Link
              href="/scanner"
              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all font-medium text-sm text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80"
            >
              <span className="text-xl">📱</span>
              {isSidebarOpen && <span>Mobile Scanner</span>}
            </Link>

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
              type="button"
              onClick={() => setIsHelpModalOpen(true)}
              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all font-medium text-sm text-slate-600 hover:bg-emerald-50/50 hover:text-emerald-700"
            >
              <span className="text-xl">❓</span>
              {isSidebarOpen && <span>Help & Features</span>}
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
                      type="button"
                      onClick={() => {
                        setCategoryFilter(cat.id);
                        setShowFilters(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg text-sm transition-all
                         ${categoryFilter === cat.id
                           ? 'bg-emerald-200 text-emerald-900 font-semibold'
                           : 'text-slate-600 hover:bg-emerald-100'
                         }`}
                    >
                      <span className="inline-block w-5 text-center mr-2">{cat.icon}</span>
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </nav>

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

      {/* Metric Cards */}
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

      {/* Header with Filter Toggle & Scanner Link */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white border border-emerald-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold text-xs uppercase tracking-wider transition-colors"
          >
            <span>🔍</span>
            <span>{showFilters ? 'Hide Filters' : 'Show Filters'}</span>
          </button>
          <span className="text-xs text-slate-500 font-medium">
            Showing {filteredItems.length} of {items.length} items
          </span>
        </div>

        <Link
          href="/scanner"
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm transition-all"
        >
          <span>📱</span>
          <span>Open Mobile Scanner (AI)</span>
        </Link>
      </div>

      {/* Collapsible Filter Section */}
      {showFilters && (
        <section className="bg-white border border-emerald-200/90 rounded-2xl p-5 shadow-sm space-y-4 transition-all duration-300 ease-in-out">
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

            {/* 2. Light Requirement Filter (View only) */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                ☀️ Light Requirement:
              </label>
              <select
                value={lightFilter}
                disabled
                className="w-full bg-slate-100 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-500 font-medium cursor-not-allowed"
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
        </section>
      )}

      {/* INVENTORY TABLE */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-emerald-100 p-12 text-center shadow-sm">
          <div className="text-4xl mb-3">🌱</div>
          <h3 className="text-lg font-bold text-slate-900">No matching inventory items found</h3>
          <p className="text-slate-500 mt-1 max-w-md mx-auto text-sm">
            Try adjusting your search query, category selection, or greenhouse zone filter.
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
                        Update via Scanner
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
                {filteredItems.map((item) => {
                  let imageUrls: string[] = [];
                  if (item.imageUrl) {
                    try {
                      const parsed = JSON.parse(item.imageUrl);
                      if (Array.isArray(parsed)) {
                        imageUrls = parsed;
                      } else {
                        imageUrls = [item.imageUrl];
                      }
                    } catch {
                      imageUrls = item.imageUrl.includes(',')
                        ? item.imageUrl.split(',').map(s => s.trim())
                        : [item.imageUrl];
                    }
                  }
                  const primaryImage = imageUrls.length > 0 ? imageUrls[0] : '';

                  return (
                    <tr
                      key={item.id}
                      onClick={() => {
                        setViewingItem(item);
                        setCurrentImageIndex(0);
                      }}
                      className="hover:bg-emerald-50/40 transition-colors cursor-pointer"
                      title="Click to view full details and image gallery"
                    >
                      {/* Species & Image Thumbnail */}
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-3">
                          {primaryImage && !failedImages.has(getValidImageUrl(primaryImage)) ? (
                            <div className="relative group">
                              <img
                                src={getValidImageUrl(primaryImage)}
                                alt={item.commonName}
                                loading="lazy"
                                className="w-12 h-12 rounded-xl object-cover border border-emerald-200 flex-shrink-0 shadow-sm bg-slate-100"
                                onError={() => markImageFailed(getValidImageUrl(primaryImage))}
                              />
                              {imageUrls.length > 1 && (
                                <span className="absolute -bottom-1 -right-1 bg-emerald-800 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow">
                                  +{imageUrls.length - 1}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-xl flex-shrink-0 border border-emerald-200">
                              🌿
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-slate-900 text-base hover:text-emerald-700 transition-colors">{item.commonName}</div>
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
                      <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-mono text-xs font-semibold">
                          {item.sku}
                        </span>
                        <div className="text-xs text-slate-500 mt-1">
                          {item.potSizeInches > 0 ? `${item.potSizeInches}" Pot` : 'N/A'}
                        </div>
                      </td>

                      {/* Light Requirement (View Only) */}
                      <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2 py-1 rounded">
                            {item.sunReq === 'INDIRECT_LIGHT' && '🌤 Indirect Light'}
                            {item.sunReq === 'FULL_SUN' && '☀️ Full Sun'}
                            {item.sunReq === 'PARTIAL_SHADE' && '🌥 Partial Shade'}
                          </span>
                          <span className="text-[10px] text-slate-500 italic">via scanner</span>
                        </div>
                      </td>

                      {/* Greenhouse Zone */}
                      <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-1.5 bg-emerald-100/70 text-emerald-800 px-2.5 py-1 rounded-full text-xs font-semibold">
                          📍 {item.greenhouseZone}
                        </span>
                      </td>

                      {/* Quantity */}
                      <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <span className="font-black text-slate-900 text-base">{item.quantity}</span>{' '}
                        <span className="text-xs text-slate-500">units</span>
                      </td>

                      {/* Price */}
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900" onClick={(e) => e.stopPropagation()}>
                        {formatPrice(item.priceCents, currency)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors border border-emerald-200"
                            title="Edit batch"
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
                  );
                })}
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
              {/* Light Information - Editable */}
              <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
                <label className="block text-xs font-bold text-emerald-800 mb-1">
                  ☀️ Light Requirement:
                </label>
                <select
                  value={editingItem.sunReq}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, sunReq: e.target.value })
                  }
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="INDIRECT_LIGHT">🌤 Indirect Light</option>
                  <option value="FULL_SUN">☀️ Full Sun</option>
                  <option value="PARTIAL_SHADE">🌥 Partial Shade</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Select the required lighting conditions for this item.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Stock Quantity (Units):</label>
                <div className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingItem({ ...editingItem, quantity: Math.max(0, editingItem.quantity - 1) })
                    }
                    disabled={editingItem.quantity <= 0}
                    aria-label="Decrease quantity"
                    className="w-11 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 font-bold text-lg"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    value={editingItem.quantity}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, quantity: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    className="flex-1 min-w-0 text-center bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 font-bold text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setEditingItem({ ...editingItem, quantity: editingItem.quantity + 1 })
                    }
                    aria-label="Increase quantity"
                    className="w-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-lg"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Greenhouse Zone:</label>
                <select
                  value={editingItem.greenhouseZone}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, greenhouseZone: e.target.value })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900"
                >
                  {editingItem.greenhouseZone && !zoneOptions.includes(editingItem.greenhouseZone) && (
                    <option value={editingItem.greenhouseZone}>{editingItem.greenhouseZone}</option>
                  )}
                  {zoneOptions.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pot Size:</label>
                  <select
                    value={editingItem.potSizeInches}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, potSizeInches: Number(e.target.value) })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                  >
                    {!potSizeOptions.some((p) => p.value === editingItem.potSizeInches) && (
                      <option value={editingItem.potSizeInches}>{editingItem.potSizeInches}&quot;</option>
                    )}
                    {potSizeOptions.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Price ({currency.code}):</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500 font-mono">
                      {currency.symbol}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editPriceText}
                      onChange={(e) => setEditPriceText(e.target.value)}
                      onBlur={() =>
                        setEditPriceText(
                          centsToInputText(inputTextToCents(editPriceText, currency.code), currency.code)
                        )
                      }
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-12 pr-3 py-2 font-mono text-slate-900"
                    />
                  </div>
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

      {/* VIEW ITEM DETAILS & IMAGE SLIDER MODAL */}
      {viewingItem && (() => {
        // Prefer the full gallery from PlantSpeciesPhoto; fall back to the legacy cover field
        let imageUrls: string[] = [];
        if (viewingItem.photos && viewingItem.photos.length > 0) {
          imageUrls = viewingItem.photos;
        } else if (viewingItem.imageUrl) {
          try {
            const parsed = JSON.parse(viewingItem.imageUrl);
            if (Array.isArray(parsed)) {
              imageUrls = parsed;
            } else {
              imageUrls = [viewingItem.imageUrl];
            }
          } catch {
            imageUrls = viewingItem.imageUrl.includes(',')
              ? viewingItem.imageUrl.split(',').map(s => s.trim())
              : [viewingItem.imageUrl];
          }
        }

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-emerald-200 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-xl font-black text-slate-900">{viewingItem.commonName}</h3>
                  <p className="text-xs italic text-emerald-800">{viewingItem.botanicalName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingItem(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Image Slider Gallery */}
              <div className="space-y-3">
                <div className="relative w-full h-64 bg-slate-900 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center">
                  {imageUrls.length > 0 && imageUrls[currentImageIndex] ? (
                    failedImages.has(getValidImageUrl(imageUrls[currentImageIndex])) ? (
                      <div className="text-center text-slate-300 text-xs px-4">
                        <div className="text-4xl mb-2">🖼️</div>
                        <div>Image could not be loaded</div>
                        <div className="font-mono text-[10px] break-all mt-1 opacity-70">{imageUrls[currentImageIndex]}</div>
                      </div>
                    ) : (
                      <img
                        src={getValidImageUrl(imageUrls[currentImageIndex])}
                        alt={`${viewingItem.commonName} photo ${currentImageIndex + 1}`}
                        className="w-full h-full object-contain"
                        onError={() => markImageFailed(getValidImageUrl(imageUrls[currentImageIndex]))}
                      />
                    )
                  ) : (
                    <div className="text-6xl">🌿</div>
                  )}

                  {imageUrls.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setCurrentImageIndex((prev) => (prev === 0 ? imageUrls.length - 1 : prev - 1))}
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center text-lg shadow transition-colors"
                        title="Previous photo"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentImageIndex((prev) => (prev === imageUrls.length - 1 ? 0 : prev + 1))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center text-lg shadow transition-colors"
                        title="Next photo"
                      >
                        ›
                      </button>
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white px-3 py-1 rounded-full text-xs font-mono">
                        {currentImageIndex + 1} / {imageUrls.length}
                      </div>
                    </>
                  )}
                </div>

                {/* Thumbnails row if multiple pictures */}
                {imageUrls.length > 1 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {imageUrls.map((url, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setCurrentImageIndex(idx)}
                        className={`w-14 h-14 rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all ${
                          currentImageIndex === idx ? 'border-emerald-600 scale-105 shadow-md' : 'border-slate-200 opacity-70 hover:opacity-100'
                        }`}
                      >
                        <img src={getValidImageUrl(url)} alt="thumb" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Item Details Specs Grid */}
              <div className="grid grid-cols-2 gap-3 bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100 text-xs">
                <div>
                  <span className="block text-slate-500 font-semibold uppercase tracking-wider">SKU Code</span>
                  <span className="font-mono font-bold text-slate-800 text-sm">{viewingItem.sku}</span>
                </div>
                <div>
                  <span className="block text-slate-500 font-semibold uppercase tracking-wider">Greenhouse Zone</span>
                  <span className="font-bold text-emerald-900 text-sm">📍 {viewingItem.greenhouseZone}</span>
                </div>
                <div>
                  <span className="block text-slate-500 font-semibold uppercase tracking-wider">Stock Quantity</span>
                  <span className="font-black text-slate-900 text-sm">{viewingItem.quantity} units</span>
                </div>
                <div>
                  <span className="block text-slate-500 font-semibold uppercase tracking-wider">Unit Price</span>
                  <span className="font-mono font-bold text-emerald-800 text-sm">{formatPrice(viewingItem.priceCents, currency)}</span>
                </div>
                <div>
                  <span className="block text-slate-500 font-semibold uppercase tracking-wider">Pot Size</span>
                  <span className="font-bold text-slate-800 text-sm">{viewingItem.potSizeInches > 0 ? `${viewingItem.potSizeInches}" Pot` : 'N/A'}</span>
                </div>
                <div>
                  <span className="block text-slate-500 font-semibold uppercase tracking-wider">Light Requirement</span>
                  <span className="font-bold text-emerald-800 text-sm">
                    {viewingItem.sunReq === 'INDIRECT_LIGHT' && '🌤 Indirect Light'}
                    {viewingItem.sunReq === 'FULL_SUN' && '☀️ Full Sun'}
                    {viewingItem.sunReq === 'PARTIAL_SHADE' && '🌥 Partial Shade'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const itemToEdit = viewingItem;
                    setViewingItem(null);
                    openEditModal(itemToEdit);
                  }}
                  className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md transition-all text-center"
                >
                  ✏️ Edit Batch Details
                </button>
                <button
                  type="button"
                  onClick={() => setViewingItem(null)}
                  className="px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* HELP & FEATURES MODAL */}
      {isHelpModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl border border-emerald-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🌱</span>
                <div>
                  <h3 className="text-xl font-black text-slate-900">Moonhoya Help & Features</h3>
                  <p className="text-xs text-slate-500">Nursery Management & AI Scanner System</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHelpModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm text-slate-700">
              <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200 space-y-2">
                <h4 className="font-bold text-emerald-900 text-base flex items-center gap-2">
                  <span>🚀</span> Welcome to Moonhoya
                </h4>
                <p className="text-xs leading-relaxed text-slate-600">
                  Moonhoya is an advanced greenhouse and nursery management platform built for botanical tracking, inventory control, and on-device plant AI recognition.
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider text-emerald-800">
                  Core Features & How to Use
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900 flex items-center gap-2 text-xs">
                      <span>📋</span> Inventory Dashboard
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      View all active plant batches, supplies, and equipment. Click any item row to open its full details and slide through photo galleries. Expand filters to search by SKU or zone.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900 flex items-center gap-2 text-xs">
                      <span>📱</span> Mobile AI Scanner
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Use your camera or photo gallery to instantly capture plant items. Runs local AI recognition for Hoya species, auto-compresses photos, and records quantities to Cloudflare D1.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900 flex items-center gap-2 text-xs">
                      <span>🖼️</span> Image Gallery & Slideshow
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Items support multiple pictures. Click an item in the dashboard to view actual pictures with previous/next sliding arrows and thumbnail navigation.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900 flex items-center gap-2 text-xs">
                      <span>⚙️</span> Nursery Settings
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Customize categories, currencies (USD, IDR, EUR, etc.), greenhouse locations, and pot sizes. All synchronized across devices.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <Link
                  href="/scanner"
                  onClick={() => setIsHelpModalOpen(false)}
                  className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md text-center transition-all"
                >
                  📱 Open Mobile Scanner Now
                </Link>
                <button
                  type="button"
                  onClick={() => setIsHelpModalOpen(false)}
                  className="px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all"
                >
                  Close Help
                </button>
              </div>
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
