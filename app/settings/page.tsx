'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  DEFAULT_SETTINGS,
  COMMON_CURRENCIES,
  formatPrice,
  type AppSettingsData,
  type CategorySetting,
  type CurrencySetting,
  type PotSizeSetting,
} from '@/lib/settings';

const EMOJI_OPTIONS = ['🌿', '🧪', '🪴', '🛠️', '🔩', '🌸', '🌾', '💧', '📦', '🏷️', '✂️', '🐛', '🧰', '☀️'];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettingsData>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // New Category form state
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('🌿');
  const [newCatSubtitle, setNewCatSubtitle] = useState('');

  // New Location form state
  const [newLocation, setNewLocation] = useState('');

  // New Pot Size form state
  const [showAddPot, setShowAddPot] = useState(false);
  const [newPotValue, setNewPotValue] = useState<number>(4);
  const [newPotLabel, setNewPotLabel] = useState('');

  // Load settings on mount (isLoading starts as true, so no synchronous setState here)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (!cancelled && data.success && data.settings) {
          setSettings(data.settings);
        }
      } catch (e: unknown) {
        console.error('Failed to load settings', e);
        if (!cancelled) setErrorMessage('Could not load settings from database. Using defaults.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveSettings(updated = settings) {
    setIsSaving(true);
    setSaveSuccess(false);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        throw new Error(data.error || 'Failed to save settings');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  }

  // --- Category Handlers ---
  function handleAddCategory() {
    if (!newCatLabel.trim()) return;

    const id = newCatLabel.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
    // Prevent duplicate IDs
    if (settings.categories.some((c) => c.id === id)) {
      alert(`Category with ID "${id}" already exists.`);
      return;
    }

    const newCategory: CategorySetting = {
      id,
      label: newCatLabel.trim(),
      icon: newCatIcon,
      subtitle: newCatSubtitle.trim() || `${newCatLabel.trim()} Supplies`,
    };

    const updatedCategories = [...settings.categories, newCategory];
    const newSettings = { ...settings, categories: updatedCategories };
    setSettings(newSettings);
    setNewCatLabel('');
    setNewCatSubtitle('');
    setShowAddCategory(false);
    saveSettings(newSettings);
  }

  function handleDeleteCategory(id: string) {
    if (settings.categories.length <= 1) {
      alert('You must have at least one category.');
      return;
    }
    if (confirm(`Remove category "${id}" from scanner?`)) {
      const updatedCategories = settings.categories.filter((c) => c.id !== id);
      const newSettings = { ...settings, categories: updatedCategories };
      setSettings(newSettings);
      saveSettings(newSettings);
    }
  }

  // --- Currency Handlers ---
  function handleSelectCurrency(cur: CurrencySetting) {
    const newSettings = { ...settings, currency: cur };
    setSettings(newSettings);
    saveSettings(newSettings);
  }

  function handleCustomCurrency(field: keyof CurrencySetting, value: string) {
    const updatedCurrency = { ...settings.currency, [field]: value };
    setSettings({ ...settings, currency: updatedCurrency });
  }

  // --- Location Handlers ---
  function handleAddLocation() {
    if (!newLocation.trim()) return;
    const trimmed = newLocation.trim();
    if (settings.locations.includes(trimmed)) {
      alert('Location already exists.');
      return;
    }
    const updatedLocations = [...settings.locations, trimmed];
    const newSettings = { ...settings, locations: updatedLocations };
    setSettings(newSettings);
    setNewLocation('');
    saveSettings(newSettings);
  }

  function handleDeleteLocation(loc: string) {
    if (settings.locations.length <= 1) {
      alert('You must keep at least one location.');
      return;
    }
    const updatedLocations = settings.locations.filter((l) => l !== loc);
    const newSettings = { ...settings, locations: updatedLocations };
    setSettings(newSettings);
    saveSettings(newSettings);
  }

  // --- Pot Size Handlers ---
  function handleAddPotSize() {
    if (!newPotLabel.trim()) return;
    const newPot: PotSizeSetting = {
      value: newPotValue,
      label: newPotLabel.trim(),
    };
    const updatedPots = [...settings.potSizes, newPot].sort((a, b) => a.value - b.value);
    const newSettings = { ...settings, potSizes: updatedPots };
    setSettings(newSettings);
    setNewPotLabel('');
    setShowAddPot(false);
    saveSettings(newSettings);
  }

  function handleDeletePotSize(label: string) {
    if (settings.potSizes.length <= 1) {
      alert('You must keep at least one pot size.');
      return;
    }
    const updatedPots = settings.potSizes.filter((p) => p.label !== label);
    const newSettings = { ...settings, potSizes: updatedPots };
    setSettings(newSettings);
    saveSettings(newSettings);
  }

  // Reset all to factory defaults
  function handleResetDefaults() {
    if (confirm('Reset all categories, currency, locations, and pot sizes to default values?')) {
      setSettings(DEFAULT_SETTINGS);
      saveSettings(DEFAULT_SETTINGS);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col pb-24">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Link
            href="/scanner"
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 text-lg border border-slate-700 active:scale-95 transition-all"
          >
            ←
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              ⚙️ Nursery Settings
            </h1>
            <p className="text-xs text-slate-400">Configure Categories, Currency, Zones &amp; Sizes</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-2 rounded-xl border border-slate-700 font-medium"
          >
            📊 Dashboard
          </Link>
          <Link
            href="/scanner"
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-2 rounded-xl font-bold shadow-md"
          >
            📷 Scanner
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 pt-4 space-y-6">
        {/* Status Alerts */}
        {saveSuccess && (
          <div className="bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-sm p-3.5 rounded-2xl flex items-center gap-2 animate-fade-in shadow-lg">
            <span>✅</span>
            <span className="font-semibold">Settings saved &amp; synced across scanner app!</span>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-950/80 border border-red-500/50 text-red-300 text-sm p-3.5 rounded-2xl flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {isLoading ? (
          <div className="p-12 text-center text-emerald-400 animate-pulse">
            Loading nursery settings from Cloudflare D1...
          </div>
        ) : (
          <>
            {/* 1. ITEM CATEGORIES SECTION */}
            <section className="bg-slate-800/80 border border-slate-700 rounded-3xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-700/80 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">🏷️</span>
                  <div>
                    <h2 className="text-lg font-bold text-white">Item Categories</h2>
                    <p className="text-xs text-slate-400">Categories presented on the mobile scanner</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddCategory(!showAddCategory)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1 active:scale-95 transition-all shadow-md"
                >
                  {showAddCategory ? '✕ Cancel' : '+ Add Category'}
                </button>
              </div>

              {/* Add Category Form */}
              {showAddCategory && (
                <div className="bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-4 space-y-3">
                  <h3 className="text-xs font-bold uppercase text-emerald-400 tracking-wider">
                    New Category Details
                  </h3>

                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Select Icon:</label>
                    <div className="flex gap-2 flex-wrap">
                      {EMOJI_OPTIONS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => setNewCatIcon(em)}
                          className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center border transition-all ${
                            newCatIcon === em
                              ? 'border-emerald-400 bg-emerald-950 text-white scale-110 shadow-md'
                              : 'border-slate-700 bg-slate-800 text-slate-300'
                          }`}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Category Label:</label>
                    <input
                      type="text"
                      placeholder="e.g. Seeds, Soil Mix, Foliar Spray..."
                      value={newCatLabel}
                      onChange={(e) => setNewCatLabel(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Subtitle / Hint:</label>
                    <input
                      type="text"
                      placeholder="e.g. Seedlings, bulbs, and germinating stock"
                      value={newCatSubtitle}
                      onChange={(e) => setNewCatSubtitle(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleAddCategory}
                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-xl shadow-lg active:scale-95"
                  >
                    Save New Category
                  </button>
                </div>
              )}

              {/* Categories List */}
              <div className="space-y-2">
                {settings.categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="bg-slate-900/60 border border-slate-700 rounded-2xl p-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-3xl w-10 text-center">{cat.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{cat.label}</span>
                          <span className="text-[10px] bg-slate-800 text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">
                            {cat.id}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{cat.subtitle}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-300 flex items-center justify-center text-xs transition-colors"
                      title="Delete category"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* 2. CURRENCY CONFIGURATION SECTION */}
            <section className="bg-slate-800/80 border border-slate-700 rounded-3xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2.5 border-b border-slate-700/80 pb-3">
                <span className="text-2xl">💱</span>
                <div>
                  <h2 className="text-lg font-bold text-white">Currency &amp; Pricing</h2>
                  <p className="text-xs text-slate-400">Used for inventory valuations and sales pricing</p>
                </div>
              </div>

              {/* Current Currency Preview */}
              <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-xs uppercase font-bold text-emerald-400 tracking-wider">
                    Active Currency:
                  </span>
                  <div className="text-xl font-black text-white mt-0.5">
                    {settings.currency.symbol} ({settings.currency.code}) — {settings.currency.name}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Sample Format</span>
                  <span className="text-lg font-mono font-bold text-emerald-300">
                    {formatPrice(1800, settings.currency)}
                  </span>
                </div>
              </div>

              {/* Quick Preset Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Select Currency Preset:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {COMMON_CURRENCIES.map((cur) => {
                    const isSelected = settings.currency.code === cur.code;
                    return (
                      <button
                        key={cur.code}
                        type="button"
                        onClick={() => handleSelectCurrency(cur)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'border-emerald-400 bg-emerald-950/70 text-white font-bold shadow-md'
                            : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="text-sm font-bold flex items-center justify-between">
                          <span>{cur.code}</span>
                          <span className="text-emerald-400 font-mono text-base">{cur.symbol}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">{cur.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Currency Inputs */}
              <div className="pt-2 border-t border-slate-700/60 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Currency Symbol:</label>
                  <input
                    type="text"
                    value={settings.currency.symbol}
                    onChange={(e) => handleCustomCurrency('symbol', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Currency Code (3-letter):</label>
                  <input
                    type="text"
                    value={settings.currency.code}
                    onChange={(e) => handleCustomCurrency('code', e.target.value.toUpperCase())}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </section>

            {/* 3. NURSERY LOCATIONS / ZONES SECTION */}
            <section className="bg-slate-800/80 border border-slate-700 rounded-3xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2.5 border-b border-slate-700/80 pb-3">
                <span className="text-2xl">📍</span>
                <div>
                  <h2 className="text-lg font-bold text-white">Nursery Locations &amp; Zones</h2>
                  <p className="text-xs text-slate-400">Greenhouses, tables, shade houses, and storage areas</p>
                </div>
              </div>

              {/* Add Location Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Propagation Bench 4, North Shade Tunnel..."
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddLocation()}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={handleAddLocation}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-md active:scale-95 transition-all"
                >
                  + Add Zone
                </button>
              </div>

              {/* Locations List */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {settings.locations.map((loc) => (
                  <div
                    key={loc}
                    className="bg-slate-900/60 border border-slate-700 rounded-xl p-3 flex items-center justify-between gap-2"
                  >
                    <span className="text-sm font-medium text-slate-200 truncate flex items-center gap-1.5">
                      <span>📍</span>
                      <span>{loc}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteLocation(loc)}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-300 flex items-center justify-center text-xs transition-colors flex-shrink-0"
                      title="Delete location"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* 4. POT SIZES SECTION */}
            <section className="bg-slate-800/80 border border-slate-700 rounded-3xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-700/80 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">🪴</span>
                  <div>
                    <h2 className="text-lg font-bold text-white">Pot Sizes &amp; Containers</h2>
                    <p className="text-xs text-slate-400">Available container options for plants and planters</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddPot(!showAddPot)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1 active:scale-95 transition-all shadow-md"
                >
                  {showAddPot ? '✕ Cancel' : '+ Add Size'}
                </button>
              </div>

              {/* Add Pot Size Form */}
              {showAddPot && (
                <div className="bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-300 mb-1">Size (Inches):</label>
                      <input
                        type="number"
                        value={newPotValue}
                        onChange={(e) => setNewPotValue(parseInt(e.target.value) || 0)}
                        placeholder="e.g. 5"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-300 mb-1">Display Label:</label>
                      <input
                        type="text"
                        value={newPotLabel}
                        onChange={(e) => setNewPotLabel(e.target.value)}
                        placeholder='e.g. 5" Medium Squat'
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddPotSize}
                    className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-xl shadow-lg active:scale-95"
                  >
                    Save Pot Size
                  </button>
                </div>
              )}

              {/* Pot Sizes Badges/List */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {settings.potSizes.map((pot) => (
                  <div
                    key={pot.label}
                    className="bg-slate-900/60 border border-slate-700 rounded-xl p-3 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="text-sm font-bold text-white">{pot.label}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {pot.value === 0 ? 'No pot (N/A)' : `${pot.value} inches`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeletePotSize(pot.label)}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-300 flex items-center justify-center text-xs transition-colors flex-shrink-0"
                      title="Delete pot size"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Global Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={() => saveSettings(settings)}
                disabled={isSaving}
                className="flex-1 min-h-[56px] bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-emerald-950/50 active:scale-[0.99] transition-all"
              >
                {isSaving ? (
                  <>
                    <span className="animate-spin text-xl">⏳</span>
                    <span>Saving to Cloudflare D1...</span>
                  </>
                ) : (
                  <>
                    <span className="text-xl">💾</span>
                    <span>Save All Settings</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleResetDefaults}
                className="py-3 px-5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-2xl border border-slate-700 transition-colors"
              >
                🔄 Reset to Defaults
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
