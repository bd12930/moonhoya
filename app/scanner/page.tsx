'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { compressImage, formatFileSize, type CompressionResult } from '@/lib/image-compressor';
import { identifyPlantOnDevice, type PlantAIResult } from '@/lib/plant-ai';
import { MAX_PHOTOS_PER_SPECIES } from '@/lib/species-photos';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CURRENCY,
  DEFAULT_LOCATIONS,
  DEFAULT_POT_SIZES,
  formatPrice,
  type CategorySetting,
  type CurrencySetting,
  type PotSizeSetting,
} from '@/lib/settings';

// Item category types
type ItemCategory = 'PLANT' | 'FERTILIZER' | 'POT' | 'EQUIPMENT' | 'HARDWARE';

interface MasterSpecies {
  id: string;
  category: ItemCategory;
  commonName: string;
  botanicalName: string;
  description: string;
  sunReq: string;
  waterFrequency: number;
  petSafe: number;
  imageUrl?: string | null;
  photos?: string[];
  photoCount?: number;
}

interface InventoryBatch {
  id: string;
  sku: string;
  speciesId: string;
  potSizeInches: number;
  quantity: number;
  greenhouseZone: string;
  priceCents: number;
  growthStage: string;
  updatedAt: string;
  category: string;
  commonName: string;
  botanicalName: string;
  sunReq: string;
  imageUrl?: string | null;
}

export default function MobileScannerPage() {
  // Navigation tab: 'scanner' | 'inventory' | 'master'
  const [activeTab, setActiveTab] = useState<'scanner' | 'inventory' | 'master'>('scanner');
  // Only admins can change or delete inventory batches. The server enforces this too.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIsAdmin(data?.role === 'admin'))
      .catch(() => setIsAdmin(false));
  }, []);

  // Dynamic Settings (loaded from Cloudflare D1 /api/settings)
  const [categories, setCategories] = useState<CategorySetting[]>(DEFAULT_CATEGORIES);
  const [currency, setCurrency] = useState<CurrencySetting>(DEFAULT_CURRENCY);
  const [locations, setLocations] = useState<string[]>(DEFAULT_LOCATIONS);
  const [potSizes, setPotSizes] = useState<PotSizeSetting[]>(DEFAULT_POT_SIZES);

  // Step 1: Category
  const [selectedCategory, setSelectedCategory] = useState<string>('PLANT');

  // Step 2: Photo & Compression
  const [capturedPhoto, setCapturedPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compressionMetrics, setCompressionMetrics] = useState<CompressionResult | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);

  // Step 3: Local AI Identification
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<PlantAIResult | null>(null);
  const [alternativeMatches, setAlternativeMatches] = useState<PlantAIResult[]>([]);

  // Step 4: Master Database Matching
  const [masterCatalog, setMasterCatalog] = useState<MasterSpecies[]>([]);
  const [matchedExistingSpecies, setMatchedExistingSpecies] = useState<MasterSpecies | null>(null);
  const [isNewKind, setIsNewKind] = useState<boolean>(true);

  // Step 5: Photo save preference (ask user if new photo should be saved)
  const [saveNewPhoto, setSaveNewPhoto] = useState<boolean>(false);

  // Gallery slots for the matched kind (max MAX_PHOTOS_PER_SPECIES per PlantSpecies)
  const matchedPhotos = matchedExistingSpecies?.photos ?? [];
  const photoSlotsUsed = matchedExistingSpecies ? (matchedExistingSpecies.photoCount ?? matchedPhotos.length) : 0;
  const slotsFull = !!matchedExistingSpecies && photoSlotsUsed >= MAX_PHOTOS_PER_SPECIES;
  // A new photo is only saved when the user chose it AND a slot is free
  const willSavePhoto = saveNewPhoto && !slotsFull;

  // Step 6: Inventory Batch inputs
  const [formCommonName, setFormCommonName] = useState('');
  const [formBotanicalName, setFormBotanicalName] = useState('');
  const [formSunReq, setFormSunReq] = useState('INDIRECT_LIGHT');
  const [formWaterFrequency, setFormWaterFrequency] = useState(14);
  const [formPetSafe, setFormPetSafe] = useState(1);
  const [formDescription, setFormDescription] = useState('');
  const [formPotSize, setFormPotSize] = useState(4);
  const [formZone, setFormZone] = useState('Shade House A');
  const [formQuantity, setFormQuantity] = useState(1);
  const [formPriceDollars, setFormPriceDollars] = useState('18.00');

  // Submission & UI feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Inventory Management State
  const [inventoryItems, setInventoryItems] = useState<InventoryBatch[]>([]);
  const [inventoryFilter, setInventoryFilter] = useState<string>('ALL');
  const [inventorySearch, setInventorySearch] = useState<string>('');
  const [editingBatch, setEditingBatch] = useState<InventoryBatch | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Load settings, master catalog, and inventory on mount
  useEffect(() => {
    fetchSettings();
    fetchMasterCatalog();
    fetchInventory();
  }, []);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success && data.settings) {
        if (data.settings.categories) setCategories(data.settings.categories);
        if (data.settings.currency) setCurrency(data.settings.currency);
        if (data.settings.locations) {
          setLocations(data.settings.locations);
          if (data.settings.locations.length > 0) setFormZone(data.settings.locations[0]);
        }
        if (data.settings.potSizes) setPotSizes(data.settings.potSizes);
      }
    } catch (e) {
      console.error('Failed to load settings in scanner', e);
    }
  }

  // Sync category changes to default pot size and zone
  useEffect(() => {
    if (selectedCategory === 'PLANT') {
      setFormPotSize(4);
      setFormZone('Shade House A');
      setFormPriceDollars('18.00');
    } else if (selectedCategory === 'FERTILIZER') {
      setFormPotSize(0);
      setFormZone('Fertilizer Shed');
      setFormPriceDollars('12.50');
      setFormCommonName('Slow-Release Nursery Fertilizer');
      setFormBotanicalName('NPK-14-14-14');
    } else if (selectedCategory === 'POT') {
      setFormPotSize(4);
      setFormZone('Hardware Bay 3');
      setFormPriceDollars('3.50');
      setFormCommonName('4-Inch Clear Slotted Nursery Pot');
      setFormBotanicalName('POT-SLOT-4');
    } else if (selectedCategory === 'EQUIPMENT') {
      setFormPotSize(0);
      setFormZone('Hardware Bay 3');
      setFormPriceDollars('24.00');
      setFormCommonName('Precision Pruning Shears');
      setFormBotanicalName('EQP-SHEAR-01');
    } else if (selectedCategory === 'HARDWARE') {
      setFormPotSize(0);
      setFormZone('Hardware Bay 3');
      setFormPriceDollars('6.00');
      setFormCommonName('Bamboo Trellis U-Shape');
      setFormBotanicalName('HDW-TRELLIS-U');
    }
  }, [selectedCategory]);

  async function fetchMasterCatalog() {
    try {
      const res = await fetch('/api/species');
      const data = await res.json();
      if (data.success) {
        setMasterCatalog(data.species || []);
      }
    } catch (e) {
      console.error('Failed to load master catalog', e);
    }
  }

  async function fetchInventory() {
    try {
      const res = await fetch('/api/inventory');
      const data = await res.json();
      if (data.success) {
        setInventoryItems(data.items || []);
      }
    } catch (e) {
      console.error('Failed to load inventory', e);
    }
  }

  // Handle camera capture or image selection
  async function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressing(true);
    setFeedbackMessage(null);

    try {
      // 1. Client-side image compression (runs locally on phone/tablet)
      const compressed = await compressImage(file, 960, 0.72);
      setCapturedPhoto(compressed.file);
      setPreviewUrl(compressed.dataUrl);
      setCompressionMetrics(compressed);
      setIsCompressing(false);

      // Default photo save setting: if it's a new kind, save photo. If existing, default to using existing.
      setSaveNewPhoto(true);

      // 2. If item is a Plant, run Local On-Device AI Plant Identifier
      if (selectedCategory === 'PLANT') {
        await runLocalPlantAI(compressed.dataUrl);
      }
    } catch (err: any) {
      setIsCompressing(false);
      setFeedbackMessage({ type: 'error', text: `Photo processing error: ${err.message}` });
    }
  }

  // Run on-device plant identification locally on the phone
  async function runLocalPlantAI(imageDataUrl: string) {
    setIsAnalyzing(true);
    try {
      const img = new Image();
      img.src = imageDataUrl;
      await new Promise((resolve) => {
        img.onload = resolve;
      });

      // Run on-device computer vision & botanical matching
      const result = await identifyPlantOnDevice(img);
      setAiResult(result.topMatch);
      setAlternativeMatches(result.allMatches.slice(1, 4));

      // Match against live Master Catalog
      matchWithMasterCatalog(result.topMatch.botanicalName, result.topMatch);
    } catch (err: any) {
      console.error('AI identification error', err);
    } finally {
      setIsAnalyzing(false);
    }
  }

  // Check if botanical name exists in Master Database
  function matchWithMasterCatalog(botanical: string, fallbackAiData?: PlantAIResult) {
    const cleanSearch = botanical.trim().toLowerCase();
    const existing = masterCatalog.find(
      (s) => s.botanicalName.toLowerCase() === cleanSearch || s.commonName.toLowerCase().includes(cleanSearch)
    );

    if (existing) {
      // Existing species found
      setMatchedExistingSpecies(existing);
      setIsNewKind(false);
      setFormCommonName(existing.commonName);
      setFormBotanicalName(existing.botanicalName);
      setFormSunReq(existing.sunReq);
      setFormWaterFrequency(existing.waterFrequency);
      setFormPetSafe(existing.petSafe);
      setFormDescription(existing.description || '');

      // Default: keep the gallery if it has photos; otherwise offer to save the new one
      setSaveNewPhoto((existing.photoCount ?? 0) === 0);
    } else {
      // New kind / variety detected!
      setMatchedExistingSpecies(null);
      setIsNewKind(true);
      setSaveNewPhoto(true);

      if (fallbackAiData) {
        setFormCommonName(fallbackAiData.commonName);
        setFormBotanicalName(fallbackAiData.botanicalName);
        setFormSunReq(fallbackAiData.sunReq);
        setFormWaterFrequency(fallbackAiData.waterFrequency);
        setFormPetSafe(fallbackAiData.petSafe);
        setFormDescription(fallbackAiData.description);
      }
    }
  }

  // Submit scan to database
  async function handleSubmitScan() {
    if (!formCommonName || !formBotanicalName) {
      setFeedbackMessage({ type: 'error', text: 'Please provide both common and botanical/code names.' });
      return;
    }

    setIsSubmitting(true);
    setFeedbackMessage(null);

    try {
      const formData = new FormData();
      formData.append('category', selectedCategory);
      formData.append('commonName', formCommonName);
      formData.append('botanicalName', formBotanicalName);
      formData.append('potSize', formPotSize.toString());
      formData.append('greenhouseZone', formZone);
      formData.append('quantity', formQuantity.toString());

      const priceInCents = Math.round((parseFloat(formPriceDollars) || 18.0) * 100);
      formData.append('priceCents', priceInCents.toString());

      formData.append('sunReq', formSunReq);
      formData.append('waterFrequency', formWaterFrequency.toString());
      formData.append('petSafe', formPetSafe.toString());
      formData.append('description', formDescription);

      // Photo handling: append new compressed picture only if a gallery slot is free
      formData.append('savePhoto', willSavePhoto ? 'true' : 'false');
      if (matchedExistingSpecies) {
        formData.append('speciesId', matchedExistingSpecies.id);
      }

      if (willSavePhoto && capturedPhoto) {
        formData.append('photo', capturedPhoto);
      }

      const res = await fetch('/api/inventory/scan', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to record inventory');
      }

      setFeedbackMessage({
        type: 'success',
        text: data.message || `Successfully posted ${formCommonName} to inventory!`,
      });

      // Refresh master list & inventory
      await fetchMasterCatalog();
      await fetchInventory();

      // Reset photo & inputs after brief delay
      setTimeout(() => {
        setCapturedPhoto(null);
        setPreviewUrl(null);
        setCompressionMetrics(null);
        setAiResult(null);
        setMatchedExistingSpecies(null);
        setFormQuantity(1);
      }, 2500);
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: err.message });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Update batch quantity directly
  async function handleQuickStockChange(batchId: string, currentQty: number, delta: number) {
    const newQty = Math.max(0, currentQty + delta);
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: batchId, quantity: newQty }),
      });
      if (res.ok) {
        setInventoryItems((prev) =>
          prev.map((item) => (item.id === batchId ? { ...item, quantity: newQty } : item))
        );
      }
    } catch (e) {
      console.error('Quick stock update failed', e);
    }
  }

  // Save edit modal
  async function handleSaveBatchEdit() {
    if (!editingBatch) return;
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingBatch.id,
          quantity: editingBatch.quantity,
          greenhouseZone: editingBatch.greenhouseZone,
          potSizeInches: editingBatch.potSizeInches,
          priceCents: editingBatch.priceCents,
          growthStage: editingBatch.growthStage,
          sunReq: editingBatch.sunReq,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingBatch(null);
        await fetchInventory();
        await fetchMasterCatalog();
      }
    } catch (e) {
      console.error('Save batch edit failed', e);
    }
  }

  // Delete inventory batch
  async function handleDeleteBatch(batchId: string) {
    try {
      const res = await fetch(`/api/inventory?id=${encodeURIComponent(batchId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setDeleteConfirmId(null);
        await fetchInventory();
      } else {
        alert(data.error || 'Failed to delete');
      }
    } catch (e) {
      console.error('Delete failed', e);
    }
  }

  // Filtered inventory list
  const filteredInventory = inventoryItems.filter((item) => {
    const matchesCategory = inventoryFilter === 'ALL' || item.category === inventoryFilter;
    const matchesSearch =
      inventorySearch === '' ||
      item.commonName.toLowerCase().includes(inventorySearch.toLowerCase()) ||
      item.botanicalName.toLowerCase().includes(inventorySearch.toLowerCase()) ||
      item.greenhouseZone.toLowerCase().includes(inventorySearch.toLowerCase()) ||
      item.sku.toLowerCase().includes(inventorySearch.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col pb-28 select-none">
      {/* Hidden file inputs for Camera and Gallery */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhotoCapture}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoCapture}
      />

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-3xl">🌿</span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Moonhoya
              <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-0.5 rounded-full font-mono font-medium">
                AI SCANNER
              </span>
            </h1>
            <p className="text-xs text-slate-400">Greenhouse Mobile Inventory</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-2 rounded-xl border border-slate-700 flex items-center gap-1.5 font-medium transition-colors"
          >
            📊 Dashboard
          </Link>
          <Link
            href="/settings"
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-2 rounded-xl border border-slate-700 flex items-center gap-1.5 font-medium transition-colors"
            title="Configure Categories, Currency, Zones & Sizes"
          >
            ⚙️ Settings
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 pt-4">
        {/* Tab 1: SCANNER & INPUT */}
        {activeTab === 'scanner' && (
          <div className="space-y-5">
            {/* STEP 1: CATEGORY SELECTION */}
            <section className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-xs font-black">
                    1
                  </span>
                  Select Item Category
                </span>
                <Link href="/settings" className="text-xs text-emerald-400 hover:underline">
                  + Edit Categories
                </Link>
              </div>

              {/* Big tactile category buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {categories.map((cat) => {
                  const isSelected = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`min-h-[72px] p-3 rounded-xl border-2 flex flex-col items-center justify-center text-center transition-all ${
                        isSelected
                          ? 'border-emerald-400 bg-emerald-950/70 text-white shadow-lg shadow-emerald-950/50 scale-[1.02]'
                          : 'border-slate-700/80 bg-slate-800/50 text-slate-300 hover:border-slate-600 hover:bg-slate-700/40'
                      }`}
                    >
                      <span className="text-2xl mb-1">{cat.icon}</span>
                      <span className="text-sm font-bold tracking-tight leading-tight">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* STEP 2: CAMERA CAPTURE & PHOTO COMPRESSION */}
            <section className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-xs font-black">
                    2
                  </span>
                  Capture or Choose Photo
                </span>
                {compressionMetrics && (
                  <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-mono">
                    ⚡ {compressionMetrics.reductionPercentage}% Compressed
                  </span>
                )}
              </div>

              {/* Action buttons: Camera & Gallery */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[58px] bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-base rounded-xl flex items-center justify-center gap-2.5 shadow-md shadow-emerald-950/40 transition-colors"
                >
                  <span className="text-2xl">📸</span>
                  <span>Take Photo</span>
                </button>

                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="min-h-[58px] bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-slate-200 font-bold text-base rounded-xl border border-slate-600 flex items-center justify-center gap-2.5 transition-colors"
                >
                  <span className="text-2xl">🖼️</span>
                  <span>Photo Library</span>
                </button>
              </div>

              {/* Compression in progress */}
              {isCompressing && (
                <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-700 text-center animate-pulse">
                  <p className="text-sm text-emerald-400 font-medium">Compressing photo on mobile device...</p>
                </div>
              )}

              {/* Image Preview & Compression Stats */}
              {previewUrl && (
                <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-black/40">
                  <img
                    src={previewUrl}
                    alt="Captured Item"
                    className="w-full h-56 object-cover object-center"
                  />

                  {compressionMetrics && (
                    <div className="absolute bottom-0 inset-x-0 bg-slate-950/85 backdrop-blur-sm px-3.5 py-2 text-xs flex items-center justify-between border-t border-slate-800">
                      <span className="text-slate-300">
                        {formatFileSize(compressionMetrics.originalSize)} ➔{' '}
                        <strong className="text-emerald-400">
                          {formatFileSize(compressionMetrics.compressedSize)}
                        </strong>
                      </span>
                      <span className="text-emerald-400 font-semibold">
                        Ready for storage ({compressionMetrics.reductionPercentage}% saved)
                      </span>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* STEP 3: ON-DEVICE AI IDENTIFICATION (FOR PLANTS) */}
            {selectedCategory === 'PLANT' && previewUrl && (
              <section className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-xs font-black">
                      3
                    </span>
                    Local Mobile AI Identification
                  </span>
                  <span className="text-xs text-slate-400 font-mono">100% On-Device</span>
                </div>

                {isAnalyzing ? (
                  <div className="p-6 bg-slate-900/60 rounded-xl border border-slate-700 text-center">
                    <div className="text-4xl mb-2 animate-spin inline-block">🌱</div>
                    <p className="text-sm text-emerald-300 font-semibold animate-pulse">
                      Analyzing leaf morphology &amp; foliage patterns...
                    </p>
                  </div>
                ) : aiResult ? (
                  <div className="space-y-3">
                    <div className="p-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">
                            Top Identification Match
                          </div>
                          <div className="text-lg font-bold text-white">{aiResult.commonName}</div>
                          <div className="text-sm italic text-emerald-300">{aiResult.botanicalName}</div>
                        </div>
                        <div className="text-right">
                          <span className="inline-block bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold text-sm px-2.5 py-1 rounded-lg">
                            {aiResult.confidence}%
                          </span>
                        </div>
                      </div>

                      {/* Care badges */}
                      <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-emerald-900/50 text-xs">
                        <span className="bg-slate-800/80 text-amber-300 px-2 py-0.5 rounded-md">
                          ☀️ {aiResult.sunReq.replace('_', ' ')}
                        </span>
                        <span className="bg-slate-800/80 text-blue-300 px-2 py-0.5 rounded-md">
                          💧 Every {aiResult.waterFrequency} days
                        </span>
                        <span className="bg-slate-800/80 text-emerald-300 px-2 py-0.5 rounded-md">
                          🐾 {aiResult.petSafe ? 'Pet Safe' : 'Keep Away From Pets'}
                        </span>
                      </div>
                    </div>

                    {/* Alternative species candidates */}
                    {alternativeMatches.length > 0 && (
                      <div className="pt-1">
                        <div className="text-xs text-slate-400 mb-1.5">Alternative Candidates:</div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {alternativeMatches.map((alt) => (
                            <button
                              key={alt.botanicalName}
                              type="button"
                              onClick={() => {
                                setAiResult(alt);
                                matchWithMasterCatalog(alt.botanicalName, alt);
                              }}
                              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-lg whitespace-nowrap text-left"
                            >
                              <div className="font-semibold text-white">{alt.commonName}</div>
                              <div className="text-emerald-400 font-mono">{alt.confidence}% Match</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </section>
            )}

            {/* STEP 4: MASTER DATABASE MATCH STATUS & PHOTO SELECTION */}
            <section className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-xs font-black">
                    4
                  </span>
                  Master Database Status
                </span>
                {matchedExistingSpecies ? (
                  <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                    ✅ Existing in Database
                  </span>
                ) : (
                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                    ✨ New Kind / Variety
                  </span>
                )}
              </div>

              {/* Existing Species Card */}
              {matchedExistingSpecies && (
                <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-700 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-xs text-blue-400 font-semibold">Matched Master Record</div>
                      <div className="font-bold text-white text-base">{matchedExistingSpecies.commonName}</div>
                      <div className="text-xs italic text-slate-400">{matchedExistingSpecies.botanicalName}</div>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        slotsFull
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {photoSlotsUsed}/{MAX_PHOTOS_PER_SPECIES} slots used
                    </span>
                  </div>

                  {/* Photo gallery: existing pictures + empty slots */}
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: MAX_PHOTOS_PER_SPECIES }).map((_, i) => {
                      const url = matchedPhotos[i];
                      return url ? (
                        <img
                          key={`${url}-${i}`}
                          src={url}
                          alt={`${matchedExistingSpecies.commonName} photo ${i + 1}`}
                          className="aspect-square w-full rounded-lg object-cover border border-slate-700"
                        />
                      ) : (
                        <div
                          key={`empty-${i}`}
                          className="aspect-square w-full rounded-lg bg-slate-800/60 border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-lg"
                        >
                          🌿
                        </div>
                      );
                    })}
                  </div>

                  {/* USER PHOTO CHOICE: add a new picture only while a slot is free */}
                  <div className="mt-4 pt-3 border-t border-slate-800">
                    <div className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                      <span>📸</span> Picture Storage Option:
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSaveNewPhoto(false)}
                        className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                          !willSavePhoto
                            ? 'border-emerald-400 bg-emerald-950/60 text-white font-semibold'
                            : 'border-slate-700 bg-slate-800/50 text-slate-400'
                        }`}
                      >
                        <div className="font-bold text-slate-200">🖼️ Keep Existing Photos</div>
                        <div className="text-[11px] text-emerald-400 mt-0.5">Saves storage space (0 KB added)</div>
                      </button>

                      <button
                        type="button"
                        disabled={slotsFull}
                        onClick={() => setSaveNewPhoto(true)}
                        className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                          slotsFull
                            ? 'border-slate-800 bg-slate-900/60 text-slate-600 cursor-not-allowed'
                            : willSavePhoto
                              ? 'border-emerald-400 bg-emerald-950/60 text-white font-semibold'
                              : 'border-slate-700 bg-slate-800/50 text-slate-400'
                        }`}
                      >
                        <div className="font-bold text-slate-200">
                          {slotsFull ? '🔒 All slots used' : '📸 Add New Photo'}
                        </div>
                        <div className="text-[11px] mt-0.5 text-slate-400">
                          {slotsFull
                            ? `Limit is ${MAX_PHOTOS_PER_SPECIES} photos per kind`
                            : `Adds slot ${photoSlotsUsed + 1} of ${MAX_PHOTOS_PER_SPECIES} (~50 KB)`}
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* New Kind notice */}
              {isNewKind && (
                <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl text-xs text-amber-200 mb-3">
                  This item is not yet in your Master Database. Posting will register it into the master catalog and create the initial inventory batch.
                </div>
              )}

              {/* Item Name Inputs */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Common Name / Display Label:
                  </label>
                  <input
                    type="text"
                    value={formCommonName}
                    onChange={(e) => setFormCommonName(e.target.value)}
                    placeholder="e.g. Sweetheart Hoya, Clear Slotted Pot, Osmocote..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-base text-white focus:outline-none focus:border-emerald-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Botanical Name / SKU Code:
                  </label>
                  <input
                    type="text"
                    value={formBotanicalName}
                    onChange={(e) => setFormBotanicalName(e.target.value)}
                    placeholder="e.g. Hoya kerrii, POT-4IN-SLOT, NPK-14-14-14..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-base text-white focus:outline-none focus:border-emerald-500 font-mono text-sm"
                  />
                </div>
              </div>
            </section>

            {/* STEP 5: INVENTORY BATCH & QUANTITY */}
            <section className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow-sm space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-xs font-black">
                  5
                </span>
                Inventory &amp; Stock Details
              </span>

              {/* Quantity Stepper with Large Touch Buttons */}
              <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-700">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider text-center mb-2">
                  Quantity to Add / Stock Count
                </label>
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setFormQuantity(Math.max(1, formQuantity - 5))}
                    className="w-12 h-14 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-lg rounded-xl border border-slate-700 active:scale-95"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormQuantity(Math.max(1, formQuantity - 1))}
                    className="w-14 h-14 bg-slate-800 hover:bg-slate-700 text-white font-bold text-2xl rounded-xl border border-slate-700 active:scale-95"
                  >
                    -
                  </button>

                  <div className="min-w-[90px] text-center">
                    <span className="text-4xl font-black text-emerald-400">{formQuantity}</span>
                    <span className="block text-[11px] text-slate-400 uppercase font-semibold">Units</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setFormQuantity(formQuantity + 1)}
                    className="w-14 h-14 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-2xl rounded-xl shadow-md active:scale-95"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormQuantity(formQuantity + 5)}
                    className="w-12 h-14 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-lg rounded-xl border border-slate-700 active:scale-95"
                  >
                    +5
                  </button>
                </div>
              </div>

              {/* Greenhouse Zone Picker */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  📍 Greenhouse / Nursery Location:
                </label>
                <select
                  value={formZone}
                  onChange={(e) => setFormZone(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-base text-white focus:outline-none focus:border-emerald-500"
                >
                  {locations.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>

              {/* Pot Size & Price Grid */}
              {selectedCategory === 'PLANT' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">☀️ Light Requirement:</label>
                  <select
                    value={formSunReq}
                    onChange={(e) => setFormSunReq(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-base text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="INDIRECT_LIGHT">🌤 Indirect Light (Bright Filtered)</option>
                    <option value="FULL_SUN">☀️ Full Sun (Direct Sunlight)</option>
                    <option value="PARTIAL_SHADE">🌥 Partial Shade (Low/Medium Light)</option>
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    🪴 Pot Size:
                  </label>
                  <select
                    value={formPotSize}
                    onChange={(e) => setFormPotSize(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-base text-white focus:outline-none focus:border-emerald-500"
                  >
                    {potSizes.map((ps) => (
                      <option key={ps.label} value={ps.value}>
                        {ps.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    💲 Unit Price ({currency.code}):
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-3.5 text-slate-400 font-bold">{currency.symbol}</span>
                    <input
                      type="number"
                      step="0.50"
                      value={formPriceDollars}
                      onChange={(e) => setFormPriceDollars(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-3 py-3 text-base text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Feedback Alert */}
              {feedbackMessage && (
                <div
                  className={`p-4 rounded-xl text-sm font-medium border ${
                    feedbackMessage.type === 'success'
                      ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200'
                      : 'bg-red-950/70 border-red-500/40 text-red-200'
                  }`}
                >
                  {feedbackMessage.text}
                </div>
              )}

              {/* Big Post to Inventory Button */}
              <button
                type="button"
                onClick={handleSubmitScan}
                disabled={isSubmitting}
                className={`w-full min-h-[64px] rounded-2xl font-bold text-lg flex items-center justify-center gap-2.5 shadow-xl transition-all ${
                  isSubmitting
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 shadow-emerald-950/50'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <span className="animate-spin text-2xl">⏳</span>
                    <span>Posting to Cloudflare D1...</span>
                  </>
                ) : (
                  <>
                    <span className="text-2xl">💾</span>
                    <span>Post to Inventory Database</span>
                  </>
                )}
              </button>
            </section>
          </div>
        )}

        {/* Tab 2: INVENTORY MANAGEMENT (UPDATE & DELETE) */}
        {activeTab === 'inventory' && (
          <div className="space-y-4">
            {/* Search and Category Filter Bar */}
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-3.5 space-y-3">
              <div className="relative">
                <span className="absolute left-3.5 top-3 text-slate-400">🔍</span>
                <input
                  type="text"
                  placeholder="Search plant, SKU, or greenhouse zone..."
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Category Pills */}
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setInventoryFilter('ALL')}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
                    inventoryFilter === 'ALL'
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  All Items ({inventoryItems.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setInventoryFilter(cat.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap flex items-center gap-1 transition-colors ${
                      inventoryFilter === cat.id
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span>{cat.icon}</span>
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Inventory List Cards */}
            {filteredInventory.length === 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-10 text-center">
                <div className="text-4xl mb-2">📦</div>
                <h3 className="text-base font-bold text-white">No Inventory Items Found</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  Scan an item using the camera tab to register live nursery stock.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredInventory.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 shadow-sm flex flex-col gap-3"
                  >
                    <div className="flex items-start gap-3">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.commonName}
                          className="w-16 h-16 rounded-xl object-cover border border-slate-700 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-2xl flex-shrink-0">
                          🌿
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-slate-900 text-slate-400 px-2 py-0.5 rounded font-mono">
                            {item.sku}
                          </span>
                          <span className="text-xs bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                            📍 {item.greenhouseZone}
                          </span>
                        </div>
                        <h4 className="text-base font-bold text-white truncate mt-1">{item.commonName}</h4>
                        <p className="text-xs italic text-slate-400 truncate">{item.botanicalName}</p>
                      </div>

                      <div className="text-right">
                        <span className="text-base font-bold text-emerald-400">
                          {formatPrice(item.priceCents, currency)}
                        </span>
                        {item.potSizeInches > 0 && (
                          <div className="text-xs text-slate-400">{item.potSizeInches}&quot; Pot</div>
                        )}
                      </div>
                    </div>

                    {/* Quick Stock Stepper & CRUD Actions */}
                    <div className="flex items-center justify-between pt-2.5 border-t border-slate-700/60">
                      {/* Quantity quick adjustment buttons */}
                      {isAdmin ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleQuickStockChange(item.id, item.quantity, -1)}
                          className="w-9 h-9 rounded-lg bg-slate-900 hover:bg-slate-700 text-white font-bold flex items-center justify-center text-lg active:scale-95 border border-slate-700"
                        >
                          -
                        </button>
                        <span className="text-sm font-bold text-white px-2">
                          {item.quantity} <span className="text-xs font-normal text-slate-400">units</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuickStockChange(item.id, item.quantity, 1)}
                          className="w-9 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center text-lg active:scale-95"
                        >
                          +
                        </button>
                      </div>
                      ) : (
                      <span className="text-sm font-bold text-white px-2">
                        {item.quantity} <span className="text-xs font-normal text-slate-400">units</span>
                      </span>
                      )}

                      {/* Edit and Delete Actions (admins only) */}
                      {isAdmin && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingBatch(item)}
                          className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-600 transition-colors flex items-center gap-1"
                        >
                          ✏️ Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(item.id)}
                          className="bg-red-950/60 hover:bg-red-900 text-red-300 text-xs font-semibold px-3 py-2 rounded-xl border border-red-800/50 transition-colors flex items-center gap-1"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: MASTER CATALOG */}
        {activeTab === 'master' && (
          <div className="space-y-4">
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">Master Species &amp; Catalog</h3>
                  <p className="text-xs text-slate-400">
                    Botanical database entries tracked across all greenhouse zones.
                  </p>
                </div>
                <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2.5 py-1 rounded-full font-bold">
                  {masterCatalog.length} Registered
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {masterCatalog.map((spec) => (
                <div
                  key={spec.id}
                  className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 flex items-center gap-3"
                >
                  {spec.imageUrl ? (
                    <img
                      src={spec.imageUrl}
                      alt={spec.commonName}
                      className="w-14 h-14 rounded-xl object-cover border border-slate-700"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-2xl">
                      🌿
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] bg-slate-900 text-emerald-400 px-2 py-0.5 rounded font-bold uppercase">
                      {spec.category || 'PLANT'}
                    </span>
                    <h4 className="text-base font-bold text-white truncate mt-0.5">{spec.commonName}</h4>
                    <p className="text-xs italic text-slate-400 truncate">{spec.botanicalName}</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div>☀️ {spec.sunReq.replace('_', ' ')}</div>
                    <div>💧 {spec.waterFrequency}d</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* EDIT MODAL */}
      {editingBatch && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">Edit Inventory Batch</h3>
                <p className="text-xs text-slate-400">{editingBatch.sku}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingBatch(null)}
                className="w-8 h-8 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Quantity (Units):</label>
                <input
                  type="number"
                  value={editingBatch.quantity}
                  onChange={(e) =>
                    setEditingBatch({ ...editingBatch, quantity: parseInt(e.target.value) || 0 })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-base text-white font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Greenhouse Zone:</label>
                <select
                  value={editingBatch.greenhouseZone}
                  onChange={(e) => setEditingBatch({ ...editingBatch, greenhouseZone: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-base text-white"
                >
                  {locations.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">☀️ Light Requirement:</label>
                <select
                  value={editingBatch.sunReq || 'INDIRECT_LIGHT'}
                  onChange={(e) => setEditingBatch({ ...editingBatch, sunReq: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-base text-white"
                >
                  <option value="INDIRECT_LIGHT">🌤 Indirect Light (Bright Filtered)</option>
                  <option value="FULL_SUN">☀️ Full Sun (Direct Sunlight)</option>
                  <option value="PARTIAL_SHADE">🌥 Partial Shade (Low/Medium Light)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Pot Size (Inches):</label>
                  <input
                    type="number"
                    value={editingBatch.potSizeInches}
                    onChange={(e) =>
                      setEditingBatch({ ...editingBatch, potSizeInches: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-base text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Price (Cents):</label>
                  <input
                    type="number"
                    value={editingBatch.priceCents}
                    onChange={(e) =>
                      setEditingBatch({ ...editingBatch, priceCents: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-base text-white font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditingBatch(null)}
                className="flex-1 py-3.5 rounded-xl bg-slate-700 text-slate-300 font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveBatchEdit}
                className="flex-1 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-red-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-center">
            <div className="text-4xl">⚠️</div>
            <h3 className="text-lg font-bold text-white">Delete Inventory Batch?</h3>
            <p className="text-xs text-slate-400">
              This action permanently removes this batch record from Cloudflare D1. This cannot be undone.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-3 rounded-xl bg-slate-700 text-slate-300 font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteBatch(deleteConfirmId)}
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm shadow-lg"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STICKY BOTTOM NAVIGATION BAR (Mobile & Tablet Friendly) */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 px-4 py-2.5 flex items-center justify-around max-w-2xl mx-auto shadow-2xl">
        <button
          type="button"
          onClick={() => setActiveTab('scanner')}
          className={`flex flex-col items-center justify-center min-w-[72px] py-1 transition-all ${
            activeTab === 'scanner' ? 'text-emerald-400 scale-105 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="text-2xl">📷</span>
          <span className="text-xs mt-0.5">Scanner</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('inventory')}
          className={`flex flex-col items-center justify-center min-w-[72px] py-1 transition-all ${
            activeTab === 'inventory' ? 'text-emerald-400 scale-105 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="text-2xl">📦</span>
          <span className="text-xs mt-0.5">Inventory ({inventoryItems.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('master')}
          className={`flex flex-col items-center justify-center min-w-[72px] py-1 transition-all ${
            activeTab === 'master' ? 'text-emerald-400 scale-105 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="text-2xl">🌿</span>
          <span className="text-xs mt-0.5">Catalog ({masterCatalog.length})</span>
        </button>

        <Link
          href="/settings"
          className="flex flex-col items-center justify-center min-w-[72px] py-1 text-slate-400 hover:text-slate-200 transition-all"
        >
          <span className="text-2xl">⚙️</span>
          <span className="text-xs mt-0.5">Settings</span>
        </Link>
      </nav>
    </div>
  );
}
