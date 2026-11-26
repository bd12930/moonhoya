'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import StatusInfo from '@/components/status-info';
import { compressImage, formatFileSize } from '@/lib/image-compressor';
import { MAX_PHOTOS_PER_SPECIES } from '@/lib/species-photos';
import type { ScanClassificationResult } from '@/lib/scan-classifier';
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
import CameraView from './camera-view';

/** Zeros offered after the typed price number, e.g. "15" + "000" = 15000. */
const ZERO_SUFFIXES = ['0', '00', '000', '0000', '00000', '000000'];

/** Maximum digits typed into the price number box. */
const PRICE_MAX_DIGITS = 6;

/** Longest common name or botanical name/code accepted. */
const MAX_TEXT_LENGTH = 120;

/** Largest quantity accepted in one save. */
const MAX_QUANTITY = 9999;

/** Form fields that can be flagged as invalid before saving. */
type FieldKey =
  | 'photo'
  | 'category'
  | 'commonName'
  | 'botanicalName'
  | 'sunReq'
  | 'potSize'
  | 'quantity'
  | 'zone'
  | 'price';

type FieldErrors = Partial<Record<FieldKey, string>>;

const SUN_OPTIONS = [
  { value: 'FULL_SUN', label: 'Full sun' },
  { value: 'INDIRECT_LIGHT', label: 'Indirect light' },
  { value: 'PARTIAL_SHADE', label: 'Partial shade' },
];

/** A master catalog entry (PlantSpecies) as returned by GET /api/species. */
interface CatalogSpecies {
  id: string;
  category: string;
  commonName: string;
  botanicalName: string;
  sunReq: string;
  imageUrl?: string | null;
  photoCount?: number;
}

type Step = 'home' | 'review' | 'done';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Builds a catalog code from a product name, e.g. "Slow release 14-14-14" → "SLOW-RELEASE-14-14-14". */
function codeFromName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function QuickScannerPage() {
  const [step, setStep] = useState<Step>('home');
  const [cameraOpen, setCameraOpen] = useState(false);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // Captured photo (compressed for upload and AI)
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Settings and master catalog
  const [categories, setCategories] = useState<CategorySetting[]>(DEFAULT_CATEGORIES);
  const [locations, setLocations] = useState<string[]>(DEFAULT_LOCATIONS);
  const [potSizes, setPotSizes] = useState<PotSizeSetting[]>(DEFAULT_POT_SIZES);
  const [currency, setCurrency] = useState<CurrencySetting>(DEFAULT_CURRENCY);
  const [catalog, setCatalog] = useState<CatalogSpecies[]>([]);

  // Attributes of the picture
  const [category, setCategory] = useState('PLANT');
  const [commonName, setCommonName] = useState('');
  const [botanicalName, setBotanicalName] = useState('');
  const [sunReq, setSunReq] = useState('INDIRECT_LIGHT');
  const [potSize, setPotSize] = useState(4);
  const [zone, setZone] = useState(DEFAULT_LOCATIONS[0]);
  const [quantity, setQuantity] = useState(1);
  const [priceDigits, setPriceDigits] = useState('');
  const [priceZeros, setPriceZeros] = useState('000');

  // Existing catalog entry chosen by the user (avoids duplicates)
  const [picked, setPicked] = useState<CatalogSpecies | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [replaceSlot, setReplaceSlot] = useState(1);

  // AI identification
  const [aiResult, setAiResult] = useState<ScanClassificationResult | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Saving
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Price: typed number + chosen zeros (major currency units)
  const priceAmount = priceDigits ? Number(priceDigits + priceZeros) : 0;
  const priceCents = Math.round(priceAmount * 100);

  // Existing catalog entry whose names match what is typed (possible duplicate)
  const nameMatch = useMemo<CatalogSpecies | null>(() => {
    if (picked) return null;
    const c = normalize(commonName);
    const b = normalize(botanicalName);
    if (!c && !b) return null;
    return (
      catalog.find(
        (s) =>
          (b && normalize(s.botanicalName) === b) ||
          (c && normalize(s.commonName) === c)
      ) ?? null
    );
  }, [catalog, picked, commonName, botanicalName]);

  const catalogResults = useMemo(() => {
    const q = normalize(catalogSearch);
    const list = q
      ? catalog.filter(
          (s) => normalize(s.commonName).includes(q) || normalize(s.botanicalName).includes(q)
        )
      : catalog;
    return list.slice(0, 12);
  }, [catalog, catalogSearch]);

  const pickedGalleryFull = !!picked && (picked.photoCount ?? 0) >= MAX_PHOTOS_PER_SPECIES;

  // Load settings and master catalog once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.success && data.settings) {
          if (data.settings.categories) setCategories(data.settings.categories);
          if (data.settings.currency) setCurrency(data.settings.currency);
          if (data.settings.locations?.length) {
            setLocations(data.settings.locations);
            setZone(data.settings.locations[0]);
          }
          if (data.settings.potSizes) setPotSizes(data.settings.potSizes);
        }
      } catch (err) {
        console.error('Failed to load settings in quick scanner', err);
      }
      try {
        const res = await fetch('/api/species');
        const data = await res.json();
        if (data.success) setCatalog(data.species || []);
      } catch (err) {
        console.error('Failed to load master catalog in quick scanner', err);
      }
    })();
  }, []);

  async function refreshCatalog() {
    try {
      const res = await fetch('/api/species');
      const data = await res.json();
      if (data.success) setCatalog(data.species || []);
    } catch (err) {
      console.error('Failed to refresh master catalog', err);
    }
  }

  /** Clears per-item fields; keeps category, zone, pot size and sun light for faster batch scanning. */
  function resetItemFields() {
    setCommonName('');
    setBotanicalName('');
    setQuantity(1);
    setPriceDigits('');
    setPicked(null);
    setCatalogSearch('');
    setReplaceSlot(1);
    setAiResult(null);
    setAiError(null);
    setSaveError(null);
    setFieldErrors({});
  }

  /** Chosen from the photo library (file input without capture). */
  async function handleLibraryChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same picture again
    if (file) await handleFile(file);
  }

  /** Compresses a photo from the live camera or the library, then moves to the review step. */
  async function handleFile(file: File) {
    setIsProcessingPhoto(true);
    setPhotoError(null);
    try {
      const compressed = await compressImage(file, 960, 0.72);
      setPhotoFile(compressed.file);
      setPhotoDataUrl(compressed.dataUrl);
      resetItemFields();
      setStep('review');
    } catch (err) {
      console.error('Photo processing failed', err);
      setPhotoError('Could not read that photo. Please try again.');
    } finally {
      setIsProcessingPhoto(false);
    }
  }

  function openCamera() {
    setPhotoError(null);
    setCameraOpen(true);
  }

  /** Camera overlay returned a photo: close the camera and process it. */
  function handleCameraFile(file: File) {
    setCameraOpen(false);
    void handleFile(file);
  }

  function startOver() {
    setPhotoFile(null);
    setPhotoDataUrl(null);
    setSavedMessage(null);
    resetItemFields();
    setStep('home');
  }

  async function handleIdentify() {
    if (!photoDataUrl) return;
    setIsIdentifying(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch('/api/scan/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: photoDataUrl }),
      });
      const data = (await res.json()) as ScanClassificationResult;
      setAiResult(data);
      if (!data || data.classification === null) {
        setAiError(data?.message || 'AI could not identify this photo. Fill in the details manually.');
      }
    } catch (err) {
      console.error('AI identify failed', err);
      setAiError('Could not reach the AI service. Fill in the details manually.');
    } finally {
      setIsIdentifying(false);
    }
  }

  /** Overwrites the form with the AI suggestion. The user can still edit every field afterwards. */
  function useAiSuggestion() {
    if (!aiResult?.classification) return;
    setPicked(null);
    if (aiResult.classification === 'plant') {
      setCategory('PLANT');
      setCommonName(aiResult.commonName ?? '');
      setBotanicalName(aiResult.scientificName ?? '');
    } else {
      const aiCategory =
        aiResult.category && categories.some((c) => c.id === aiResult.category)
          ? aiResult.category
          : category;
      const name = aiResult.productName ?? '';
      setCategory(aiCategory);
      setCommonName(name);
      setBotanicalName(codeFromName(name));
    }
  }

  /** Selects an existing catalog entry so the item is saved under it (no duplicate kind). */
  function pickExisting(species: CatalogSpecies) {
    setPicked(species);
    setCategory(species.category);
    setCommonName(species.commonName);
    setBotanicalName(species.botanicalName);
    setSunReq(species.sunReq);
    setReplaceSlot(1);
  }

  /** Checks every field and returns a message per invalid field. An empty result means the record is complete. */
  function validateForm(): FieldErrors {
    const errors: FieldErrors = {};
    if (!photoFile) errors.photo = 'Take or import a photo first.';

    if (!picked) {
      const name = commonName.trim();
      const code = botanicalName.trim();
      if (!name) errors.commonName = 'Enter a common name, or pick an existing item.';
      else if (name.length > MAX_TEXT_LENGTH) errors.commonName = `Keep the name under ${MAX_TEXT_LENGTH} characters.`;
      if (!code) errors.botanicalName = 'Enter a botanical name or code, or pick an existing item.';
      else if (code.length > MAX_TEXT_LENGTH) errors.botanicalName = `Keep it under ${MAX_TEXT_LENGTH} characters.`;
    }

    if (!categories.some((c) => c.id === category)) errors.category = 'Choose a category.';
    if (!SUN_OPTIONS.some((o) => o.value === sunReq)) errors.sunReq = 'Choose a light level.';
    if (!potSizes.some((p) => p.value === potSize)) errors.potSize = 'Choose a pot size.';
    if (!locations.includes(zone)) errors.zone = 'Choose a zone.';

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      errors.quantity = `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`;
    }

    if (!priceDigits) errors.price = 'Enter the price.';
    else if (!/^\d+$/.test(priceDigits) || priceDigits.length > PRICE_MAX_DIGITS) {
      errors.price = `Use up to ${PRICE_MAX_DIGITS} digits.`;
    } else if (priceCents <= 0) {
      errors.price = 'The price must be more than zero.';
    }

    return errors;
  }

  async function handleSave() {
    setSaveError(null);
    const errors = validateForm();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError(errors.photo ?? 'Please fix the highlighted fields before saving.');
      return;
    }
    if (!photoFile) return; // unreachable: validateForm flags a missing photo

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append('photo', photoFile);
      formData.append('savePhoto', 'true');
      if (picked) {
        formData.append('speciesId', picked.id);
        if (pickedGalleryFull) formData.append('slot', String(replaceSlot));
      }
      formData.append('category', category);
      formData.append('commonName', commonName.trim());
      formData.append('botanicalName', botanicalName.trim());
      formData.append('sunReq', sunReq);
      formData.append('potSize', String(potSize));
      formData.append('greenhouseZone', zone);
      formData.append('quantity', String(quantity));
      formData.append('priceCents', String(priceCents));

      const res = await fetch('/api/inventory/scan', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save to inventory.');
      }

      setSavedMessage(data.message || 'Saved to inventory.');
      setStep('done');
      await refreshCatalog();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  }

  // Hidden photo-library input (no capture attribute, so the user picks an existing photo).
  const libraryInput = (
    <input
      ref={libraryInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={handleLibraryChange}
    />
  );

  // Full-screen live camera with zoom, flash, focus, and timer controls.
  const cameraOverlay = cameraOpen ? (
    <CameraView onFile={handleCameraFile} onClose={() => setCameraOpen(false)} />
  ) : null;

  if (step === 'home') {
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center bg-slate-900 p-6 text-white">
        {libraryInput}
        {cameraOverlay}
        <Link
          href="/dashboard"
          className="absolute left-4 top-4 rounded-full border border-white/30 px-4 py-2 text-sm font-medium text-white/90 active:scale-95"
        >
          ← Dashboard
        </Link>
        <StatusInfo tone="dark" className="absolute left-4 top-14" />
        <h1 className="mb-10 text-2xl font-semibold">Quick Scanner</h1>

        <button
          type="button"
          onClick={openCamera}
          disabled={isProcessingPhoto}
          className="flex h-64 w-64 flex-col items-center justify-center rounded-full bg-emerald-500 shadow-2xl transition active:scale-95 disabled:opacity-60"
        >
          <span className="text-6xl" aria-hidden="true">📷</span>
          <span className="mt-2 text-xl font-semibold">
            {isProcessingPhoto ? 'Processing…' : 'Scan'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => libraryInputRef.current?.click()}
          disabled={isProcessingPhoto}
          className="mt-8 h-12 rounded-full border border-white/30 px-6 text-base font-medium text-white/90 active:scale-95 disabled:opacity-60"
        >
          🖼 Import from photo library
        </button>

        {photoError && (
          <p className="mt-6 rounded-lg bg-red-500/20 px-4 py-2 text-center text-sm text-red-200">
            {photoError}
          </p>
        )}
      </main>
    );
  }

  if (step === 'done') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-slate-50 p-6 text-center">
        <div className="text-5xl" aria-hidden="true">✅</div>
        <p className="text-lg font-semibold text-slate-800">{savedMessage}</p>
        <button
          type="button"
          onClick={startOver}
          className="h-14 w-full max-w-xs rounded-full bg-emerald-600 text-lg font-semibold text-white active:scale-95"
        >
          Scan next item
        </button>
        <Link
          href="/dashboard"
          className="h-12 w-full max-w-xs rounded-full border border-slate-300 text-base font-medium leading-[3rem] text-slate-700 active:scale-95"
        >
          📊 Back to dashboard
        </Link>
      </main>
    );
  }

  // Review step
  const inputClass =
    'w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none';
  const labelClass = 'mb-1 block text-xs font-medium text-slate-300';

  /** Input style with a red border when that field failed validation. */
  const inputClassFor = (key: FieldKey) =>
    fieldErrors[key] ? inputClass.replace('border-slate-700', 'border-red-500').replace('bg-slate-900', 'bg-red-950/40') : inputClass;

  /** Message under a field that failed validation. */
  const fieldError = (key: FieldKey) =>
    fieldErrors[key] ? <p className="mt-1 text-sm text-red-600">{fieldErrors[key]}</p> : null;

  return (
    <main className="min-h-dvh bg-slate-900 pb-32 text-slate-100">
      {libraryInput}
      {cameraOverlay}

      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3.5 backdrop-blur-md">
        <button type="button" onClick={startOver} className="text-sm font-medium text-slate-300">
          ← Cancel
        </button>
        <h1 className="text-base font-semibold text-white">Quick Scanner</h1>
        <div className="flex gap-3">
          <Link href="/dashboard" aria-label="Back to dashboard" className="text-sm font-medium text-slate-300">
            📊
          </Link>
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            className="text-sm font-medium text-slate-300"
          >
            Library
          </button>
          <button type="button" onClick={openCamera} className="text-sm font-medium text-emerald-400">
            Retake
          </button>
        </div>
      </header>

      <div className="space-y-5 p-4">
        {/* Photo */}
        {photoDataUrl && (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoDataUrl}
              alt="Captured item"
              className="max-h-72 w-full rounded-2xl bg-slate-800 object-contain"
            />
            {photoFile && (
              <p className="mt-1 text-right text-xs text-slate-400">{formatFileSize(photoFile.size)}</p>
            )}
          </div>
        )}

        {/* AI identification */}
        <section className="space-y-3 rounded-2xl border border-slate-700/80 bg-slate-800/80 p-4 shadow-sm">
          <button
            type="button"
            onClick={handleIdentify}
            disabled={isIdentifying || !photoDataUrl}
            className="h-12 w-full rounded-xl bg-indigo-500 text-base font-semibold text-white active:scale-95 disabled:opacity-60"
          >
            {isIdentifying ? 'Identifying…' : '✨ AI Identify'}
          </button>

          {aiError && (
            <p className="rounded-lg bg-amber-950/60 border border-amber-500/40 px-3 py-2 text-sm text-amber-200">{aiError}</p>
          )}

          {aiResult?.classification && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/40 bg-indigo-950/50 p-3">
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-white truncate">
                  {aiResult.classification === 'plant'
                    ? aiResult.commonName || 'Unknown plant'
                    : aiResult.productName || 'Unknown item'}
                </p>
                <p className="truncate text-slate-300">
                  {aiResult.classification === 'plant'
                    ? aiResult.scientificName || '—'
                    : aiResult.category || 'Item'}{' '}
                  · confidence {aiResult.confidence}
                </p>
              </div>
              <button
                type="button"
                onClick={useAiSuggestion}
                className="shrink-0 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white active:scale-95"
              >
                Use AI
              </button>
            </div>
          )}
        </section>

        {/* Duplicate check */}
        {nameMatch && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-950/60 p-4">
            <p className="min-w-0 text-sm text-amber-200">
              Already in catalog: <span className="font-semibold text-amber-100">{nameMatch.commonName}</span>{' '}
              <span className="italic">({nameMatch.botanicalName})</span>
            </p>
            <button
              type="button"
              onClick={() => pickExisting(nameMatch)}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 active:scale-95"
            >
              Use existing
            </button>
          </div>
        )}

        {/* Existing catalog picker */}
        <section className="space-y-3 rounded-2xl border border-slate-700/80 bg-slate-800/80 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Select existing item</h2>
            {picked && (
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="text-sm font-medium text-red-400"
              >
                Clear selection
              </button>
            )}
          </div>

          {picked ? (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/50 p-3 text-sm">
              <p className="font-semibold text-emerald-200">{picked.commonName}</p>
              <p className="italic text-emerald-300">{picked.botanicalName}</p>
              <p className="mt-1 text-xs text-emerald-400">
                Saved under this existing item. Editing the name below clears the selection.
              </p>
            </div>
          ) : (
            <>
              <input
                type="search"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="Search name or code…"
                className={inputClass}
              />
              <ul className="max-h-64 divide-y divide-slate-700 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900">
                {catalogResults.length === 0 && (
                  <li className="p-3 text-sm text-slate-400">No matching items. Enter a new one below.</li>
                )}
                {catalogResults.map((s) => {
                  const categoryLabel = categories.find((c) => c.id === s.category)?.label ?? s.category;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => pickExisting(s)}
                        className="flex w-full items-center gap-3 p-3 text-left active:bg-slate-800"
                      >
                        {s.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-800" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{s.commonName}</p>
                          <p className="truncate text-xs italic text-slate-400">{s.botanicalName}</p>
                        </div>
                        <span className="ml-auto shrink-0 text-xs text-slate-500">{categoryLabel}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {/* Attributes */}
        <section className="space-y-4 rounded-2xl border border-slate-700/80 bg-slate-800/80 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-100">Details</h2>

          <div>
            <label className={labelClass}>Category</label>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPicked(null);
              }}
              className={inputClassFor('category')}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {fieldError('category')}
          </div>

          <div>
            <label className={labelClass}>Common name</label>
            <input
              type="text"
              value={commonName}
              onChange={(e) => {
                setCommonName(e.target.value);
                setPicked(null);
              }}
              placeholder="e.g. Wax Plant"
              maxLength={MAX_TEXT_LENGTH}
              className={inputClassFor('commonName')}
            />
            {fieldError('commonName')}
          </div>

          <div>
            <label className={labelClass}>Botanical name / code</label>
            <input
              type="text"
              value={botanicalName}
              onChange={(e) => {
                setBotanicalName(e.target.value);
                setPicked(null);
              }}
              placeholder="e.g. Hoya carnosa"
              maxLength={MAX_TEXT_LENGTH}
              className={inputClassFor('botanicalName')}
            />
            {fieldError('botanicalName')}
          </div>

          <div>
            <label className={labelClass}>Light</label>
            <select
              value={sunReq}
              onChange={(e) => setSunReq(e.target.value)}
              className={inputClassFor('sunReq')}
            >
              {SUN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {fieldError('sunReq')}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Pot size</label>
              <select
                value={potSize}
                onChange={(e) => setPotSize(Number(e.target.value))}
                className={inputClassFor('potSize')}
              >
                {potSizes.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              {fieldError('potSize')}
            </div>
            <div>
              <label className={labelClass}>Quantity</label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_QUANTITY}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className={inputClassFor('quantity')}
              />
              {fieldError('quantity')}
            </div>
          </div>

          <div>
            <label className={labelClass}>Zone</label>
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className={inputClassFor('zone')}
            >
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            {fieldError('zone')}
          </div>

          <div>
            <label className={labelClass}>Price ({currency.code})</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span
                  className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-2xl font-semibold text-slate-400"
                  aria-hidden="true"
                >
                  {currency.symbol}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={priceDigits}
                  onChange={(e) =>
                    setPriceDigits(e.target.value.replace(/\D/g, '').slice(0, PRICE_MAX_DIGITS))
                  }
                  maxLength={PRICE_MAX_DIGITS}
                  placeholder="e.g. 15"
                  aria-label={`Price number in ${currency.code}, up to ${PRICE_MAX_DIGITS} digits`}
                  className={`h-16 w-full rounded-xl border bg-slate-900 pl-14 pr-4 text-3xl font-semibold tabular-nums text-white placeholder:text-base placeholder:font-normal placeholder:text-slate-500 focus:outline-none ${
                    fieldErrors.price ? 'border-red-500 bg-red-950/40 focus:border-red-500' : 'border-slate-700 focus:border-emerald-500'
                  }`}
                />
              </div>
              <select
                value={priceZeros}
                onChange={(e) => setPriceZeros(e.target.value)}
                aria-label="Number of zeros to add"
                className="h-16 w-32 shrink-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xl font-semibold text-white focus:border-emerald-500 focus:outline-none"
              >
                {ZERO_SUFFIXES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {priceAmount > 0 ? (
                <>
                  Price: <span className="font-semibold text-white">{formatPrice(priceCents, currency)}</span>
                  <span className="text-slate-400"> ({currency.code})</span>
                </>
              ) : (
                <span className="text-slate-400">
                  Type up to {PRICE_MAX_DIGITS} digits (e.g. 15), then pick zeros (e.g. 000) to get 15,000 {currency.code}.
                </span>
              )}
            </p>
            {fieldError('price')}
          </div>

          {picked && pickedGalleryFull && (
            <div>
              <label className={labelClass}>Replace photo in slot</label>
              <select
                value={replaceSlot}
                onChange={(e) => setReplaceSlot(Number(e.target.value))}
                className={inputClass}
              >
                {Array.from({ length: MAX_PHOTOS_PER_SPECIES }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Slot {n}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">This item&apos;s photo gallery is full.</p>
            </div>
          )}
        </section>

        {saveError && (
          <p className="rounded-xl border border-red-500/40 bg-red-950/60 px-4 py-3 text-sm text-red-200">{saveError}</p>
        )}
      </div>

      {/* Save bar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-md">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="h-14 w-full rounded-full bg-emerald-500 text-lg font-bold text-slate-950 shadow-xl hover:bg-emerald-400 active:scale-95 disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isSaving ? 'Saving…' : 'Save to inventory'}
        </button>
        <p className="mt-1 text-center text-xs text-slate-400">
          Saving to an existing pot size and zone adds to its stock.
        </p>
      </div>
    </main>
  );
}
