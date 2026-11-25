'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { compressImage, formatFileSize, type CompressionResult } from '@/lib/image-compressor';
import { identifyPlantOnDevice, type PlantAIResult } from '@/lib/plant-ai';
import { classifyScannedImage, type ScanClassificationResult } from '@/lib/scan-classifier';
import {
  initMediaPipeVision,
  detectSubject,
  FrameStabilityTracker,
  evaluateBlurriness,
  drawTrackingOverlay,
  captureVideoFrame,
  type StabilityState,
  type BlurMetric,
} from '@/lib/object-tracker';
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

/** Keep only digits and one decimal point, e.g. "1 000.5" → "1000.5". */
function sanitizePriceInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

/** Display a plain price string with a space every three digits, e.g. "100000" → "100 000". */
function formatPriceInput(plain: string): string {
  const [intPart, decPart] = plain.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

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
  /** Picture in each gallery slot (index 0 = slot 1), null when empty. */
  photoSlots?: (string | null)[];
  photoCount?: number;
}

/** Gallery slots 1..MAX as an array (index 0 = slot 1), null when empty. */
function gallerySlots(species: MasterSpecies): (string | null)[] {
  if (species.photoSlots) return species.photoSlots;
  return Array.from({ length: MAX_PHOTOS_PER_SPECIES }, (_, i) => species.photos?.[i] ?? null);
}

/** First empty slot number (1-based); falls back to slot 1 when the gallery is full (that slot gets replaced). */
function firstFreeSlot(slots: (string | null)[]): number {
  const idx = slots.findIndex((url) => !url);
  return idx === -1 ? 1 : idx + 1;
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

  // Live Camera with ML Object Tracking & Stability Engine
  const [isLiveCameraActive, setIsLiveCameraActive] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [stabilityStatus, setStabilityStatus] = useState<StabilityState>({
    isStable: false,
    progress: 0,
    elapsedMs: 0,
  });
  const [blurStatus, setBlurStatus] = useState<BlurMetric>({
    isSharp: true,
    score: 100,
    threshold: 65,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const trackerRef = useRef<FrameStabilityTracker>(new FrameStabilityTracker(800));
  const isCapturingRef = useRef(false);
  const handleCaptureCurrentFrameRef = useRef<() => Promise<void>>(async () => {});

  // Step 3: Local AI Identification & Classification
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [classificationResult, setClassificationResult] = useState<ScanClassificationResult | null>(null);
  const [aiResult, setAiResult] = useState<PlantAIResult | null>(null);
  const [alternativeMatches, setAlternativeMatches] = useState<PlantAIResult[]>([]);
  // Every candidate the on-device AI returned for this photo (saved with the scan)
  const [aiDetections, setAiDetections] = useState<PlantAIResult[]>([]);

  // Step 4: Master Database Matching
  const [masterCatalog, setMasterCatalog] = useState<MasterSpecies[]>([]);
  const [matchedExistingSpecies, setMatchedExistingSpecies] = useState<MasterSpecies | null>(null);
  const [isNewKind, setIsNewKind] = useState<boolean>(true);

  // Step 5: Photo save preference (ask user if new photo should be saved)
  const [saveNewPhoto, setSaveNewPhoto] = useState<boolean>(false);
  // Gallery slot (1-based) the user picked for the new picture (matched kind only)
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  // Gallery slots for the matched kind (MAX_PHOTOS_PER_SPECIES per PlantSpecies)
  const matchedSlots = matchedExistingSpecies ? gallerySlots(matchedExistingSpecies) : [];
  const photoSlotsUsed = matchedSlots.filter(Boolean).length;
  const slotsFull = !!matchedExistingSpecies && photoSlotsUsed >= MAX_PHOTOS_PER_SPECIES;
  // Slot the picture goes into: the picked slot (an occupied slot is replaced). New kinds have no gallery yet.
  const savingSlot = matchedExistingSpecies ? selectedSlot : null;
  // A new photo is saved when the user chose it and, for a matched kind, a slot is picked
  const willSavePhoto = saveNewPhoto && (!matchedExistingSpecies || savingSlot !== null);

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
        if (data.settings.currency) {
          setCurrency(data.settings.currency);
          if (data.settings.currency.code === 'IDR') setFormPriceDollars('100000');
        }
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

  // Choosing a category applies its default pot size, zone, price and (for non-plants) name.
  // IDR uses a fixed default unit price (100,000 Rupiah) instead of the preset price.
  function applyCategoryDefaults(categoryId: string, currencyCode: string) {
    setSelectedCategory(categoryId);
    const idrPrice = currencyCode === 'IDR' ? '100000' : null;

    if (categoryId === 'PLANT') {
      setFormPotSize(4);
      setFormZone('Shade House A');
      setFormPriceDollars(idrPrice ?? '18.00');
    } else if (categoryId === 'FERTILIZER') {
      setFormPotSize(0);
      setFormZone('Fertilizer Shed');
      setFormPriceDollars(idrPrice ?? '12.50');
      setFormCommonName('Slow-Release Nursery Fertilizer');
      setFormBotanicalName('NPK-14-14-14');
    } else if (categoryId === 'POT') {
      setFormPotSize(4);
      setFormZone('Hardware Bay 3');
      setFormPriceDollars(idrPrice ?? '3.50');
      setFormCommonName('4-Inch Clear Slotted Nursery Pot');
      setFormBotanicalName('POT-SLOT-4');
    } else if (categoryId === 'EQUIPMENT') {
      setFormPotSize(0);
      setFormZone('Hardware Bay 3');
      setFormPriceDollars(idrPrice ?? '24.00');
      setFormCommonName('Precision Pruning Shears');
      setFormBotanicalName('EQP-SHEAR-01');
    } else if (categoryId === 'HARDWARE') {
      setFormPotSize(0);
      setFormZone('Hardware Bay 3');
      setFormPriceDollars(idrPrice ?? '6.00');
      setFormCommonName('Bamboo Trellis U-Shape');
      setFormBotanicalName('HDW-TRELLIS-U');
    } else if (idrPrice) {
      setFormPriceDollars(idrPrice);
    }
  }

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

  // Clean up camera stream when component unmounts
  useEffect(() => {
    return () => {
      stopLiveCamera();
    };
  }, []);

  // Request camera and start real-time ML object detection
  async function startLiveCamera() {
    setCameraError(null);
    setIsCameraLoading(true);
    setCapturedPhoto(null);
    setPreviewUrl(null);
    trackerRef.current.reset();
    isCapturingRef.current = false;

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Live camera is not supported on this browser or requires HTTPS.');
      }

      // Initialize MediaPipe vision asynchronously
      initMediaPipeVision().catch(() => {});

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setIsLiveCameraActive(true);
      setIsCameraLoading(false);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: unknown) {
      setIsCameraLoading(false);
      setIsLiveCameraActive(false);
      const msg = err instanceof Error ? err.message : 'Unable to access camera';
      setCameraError(msg);
    }
  }

  // Stop camera stream & cancel detection loop
  function stopLiveCamera() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsLiveCameraActive(false);
    setIsCameraLoading(false);
    trackerRef.current.reset();
    isCapturingRef.current = false;
  }

  // Frame processing loop: object detection, stability (0.8s) & blurriness check
  useEffect(() => {
    if (!isLiveCameraActive) return;

    let mounted = true;
    const tracker = trackerRef.current;
    if (!analysisCanvasRef.current) {
      analysisCanvasRef.current = document.createElement('canvas');
    }

    const processFrame = () => {
      if (!mounted) return;
      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;
      const analysis = analysisCanvasRef.current;

      if (video && overlay && analysis && video.readyState >= 2) {
        const vW = video.videoWidth;
        const vH = video.videoHeight;

        if (overlay.width !== overlay.clientWidth || overlay.height !== overlay.clientHeight) {
          overlay.width = overlay.clientWidth;
          overlay.height = overlay.clientHeight;
        }

        const now = performance.now();

        // 1. Detect subject via MediaPipe / Foliage Saliency
        const subject = detectSubject(video, analysis, now);

        // 2. Track bounding box frame stability (~0.8s)
        const stability = tracker.update(subject, now);
        setStabilityStatus(stability);

        // 3. Evaluate image sharpness (Laplacian variance on subject area)
        const blur = evaluateBlurriness(video, subject ?? undefined, 65);
        setBlurStatus(blur);

        // 4. Render bounding box, corners & stability progress
        const ctx = overlay.getContext('2d');
        if (ctx) {
          drawTrackingOverlay(
            ctx,
            subject,
            stability,
            blur,
            overlay.width,
            overlay.height,
            vW,
            vH
          );
        }

        // 5. Automatically capture frame when subject is stable for >= 0.8s and sharp
        if (
          autoCaptureEnabled &&
          stability.isStable &&
          blur.isSharp &&
          !isCapturingRef.current
        ) {
          isCapturingRef.current = true;
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate(50); } catch {}
          }
          handleCaptureCurrentFrameRef.current();
          return;
        }
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    animFrameRef.current = requestAnimationFrame(processFrame);

    return () => {
      mounted = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isLiveCameraActive, autoCaptureEnabled]);

  // Capture current live frame and send to compression & recognition
  async function handleCaptureCurrentFrame() {
    if (!videoRef.current) return;
    try {
      const file = await captureVideoFrame(videoRef.current, `live-scan-${Date.now()}.jpg`);
      stopLiveCamera();
      await processCapturedImage(file);
    } catch (err: unknown) {
      isCapturingRef.current = false;
      const msg = err instanceof Error ? err.message : 'Failed to capture frame';
      setFeedbackMessage({ type: 'error', text: msg });
    }
  }
  handleCaptureCurrentFrameRef.current = handleCaptureCurrentFrame;

  // Unified image processing for both live stream auto-capture and file upload
  async function processCapturedImage(file: File) {
    setIsCompressing(true);
    setFeedbackMessage(null);

    try {
      // 1. Client-side image compression
      const compressed = await compressImage(file, 960, 0.72);
      setCapturedPhoto(compressed.file);
      setPreviewUrl(compressed.dataUrl);
      setCompressionMetrics(compressed);
      setIsCompressing(false);

      // Default photo save setting
      setSaveNewPhoto(true);

      // 2. Classify object ("plant" vs "item") and identify metadata
      await runClassificationAndIdentification(compressed.dataUrl);
    } catch (err: unknown) {
      setIsCompressing(false);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setFeedbackMessage({ type: 'error', text: `Photo processing error: ${message}` });
    }
  }

  // Handle camera capture or image selection from file input
  async function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processCapturedImage(file);
  }

  // Identify primary object, classify as "plant" or "item", and handle blurriness
  async function runClassificationAndIdentification(imageDataUrl: string) {
    setIsAnalyzing(true);
    setClassificationResult(null);
    setAiResult(null);
    setFeedbackMessage(null);

    try {
      const result = await classifyScannedImage(imageDataUrl);
      setClassificationResult(result);

      // If image is too blurry, set confidence to low and alert user
      if (result.confidence === 'low') {
        setFeedbackMessage({
          type: 'error',
          text: result.message || 'Image is too blurry to be certain. Please retake the photo closer.',
        });
        return;
      }

      if (result.classification === 'plant') {
        setSelectedCategory('PLANT');
        if (result.commonName) setFormCommonName(result.commonName);
        if (result.scientificName) setFormBotanicalName(result.scientificName);

        if (result.lightNeeds) {
          const l = result.lightNeeds.toUpperCase();
          if (l.includes('FULL')) setFormSunReq('FULL_SUN');
          else if (l.includes('SHADE') || l.includes('PARTIAL')) setFormSunReq('PARTIAL_SHADE');
          else setFormSunReq('INDIRECT_LIGHT');
        }

        if (result.wateringNeeds) {
          const daysMatch = result.wateringNeeds.match(/\d+/);
          if (daysMatch) setFormWaterFrequency(parseInt(daysMatch[0], 10));
        }

        // Match with master catalog or run botanical profile
        if (result.scientificName) {
          matchWithMasterCatalog(result.scientificName);
        }
        await runLocalPlantAI(imageDataUrl);
      } else if (result.classification === 'item') {
        const itemCat = result.category || 'EQUIPMENT';
        applyCategoryDefaults(itemCat, currency.code);

        if (result.productName) {
          setFormCommonName(result.productName);
          setFormBotanicalName(result.productName);
        }
        if (result.primaryFunction) {
          setFormDescription(result.primaryFunction);
        }

        setMatchedExistingSpecies(null);
        setIsNewKind(true);
      }
    } catch (err: unknown) {
      console.error('Classification error:', err);
      // Fall back to local plant matcher
      await runLocalPlantAI(imageDataUrl);
    } finally {
      setIsAnalyzing(false);
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
      setAiDetections(result.allMatches);

      // Match against live Master Catalog
      matchWithMasterCatalog(result.topMatch.botanicalName, result.topMatch);
    } catch (err: unknown) {
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
      setSelectedSlot(firstFreeSlot(gallerySlots(existing)));
    } else {
      // New kind / variety detected!
      setMatchedExistingSpecies(null);
      setIsNewKind(true);
      setSaveNewPhoto(true);
      setSelectedSlot(null);

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
        if (savingSlot !== null) {
          formData.append('slot', String(savingSlot));
        }
      }

      // All AI-detected candidates for this photo, saved against the inventory batch
      if (aiDetections.length > 0) {
        formData.append(
          'detections',
          JSON.stringify(
            aiDetections.map((d) => ({
              botanicalName: d.botanicalName,
              commonName: d.commonName,
              confidence: d.confidence,
            }))
          )
        );
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
        setClassificationResult(null);
        setAiResult(null);
        setAiDetections([]);
        setMatchedExistingSpecies(null);
        setFormQuantity(1);
      }, 2500);
    } catch (err: unknown) {
      setFeedbackMessage({ type: 'error', text: err instanceof Error ? err.message : 'Unknown error' });
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
                      onClick={() => applyCategoryDefaults(cat.id, currency.code)}
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
                {isLiveCameraActive && (
                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs px-2.5 py-0.5 rounded-full font-mono font-medium animate-pulse">
                    ● LIVE ML TRACKING
                  </span>
                )}
              </div>

              {/* Camera Error Alert */}
              {cameraError && (
                <div className="p-3 mb-3 bg-red-950/60 border border-red-800/80 rounded-xl text-xs text-red-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">⚠️</span>
                    <span>{cameraError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCameraError(null)}
                    className="text-red-400 hover:text-white font-bold ml-2 text-sm px-1.5 py-0.5 rounded"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* LIVE CAMERA VIEWFINDER WITH REAL-TIME BOUNDING BOX & STABILITY HUD */}
              {isLiveCameraActive && (
                <div className="relative rounded-2xl overflow-hidden border-2 border-emerald-500/50 bg-black shadow-2xl mb-4">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="w-full h-80 object-cover"
                  />
                  <canvas
                    ref={overlayCanvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />

                  {/* Top Bar Status */}
                  <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-2 z-10">
                    <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md px-2.5 py-1 rounded-full border border-slate-700/80 text-xs shadow-md">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          stabilityStatus.isStable && blurStatus.isSharp
                            ? 'bg-emerald-400 animate-ping'
                            : !blurStatus.isSharp
                            ? 'bg-amber-400'
                            : 'bg-sky-400 animate-pulse'
                        }`}
                      />
                      <span className="font-semibold text-slate-200">
                        {!blurStatus.isSharp
                          ? 'Adjusting Focus...'
                          : stabilityStatus.isStable
                          ? 'Target Locked (0.8s)'
                          : `Hold Steady (${Math.round(stabilityStatus.progress * 100)}%)`}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setAutoCaptureEnabled((v) => !v)}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors shadow-md ${
                          autoCaptureEnabled
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-slate-900/80 text-slate-400 border-slate-700'
                        }`}
                        title="Toggle automatic capture when subject is steady for ~0.8s"
                      >
                        {autoCaptureEnabled ? '⚡ Auto ON' : '✋ Auto OFF'}
                      </button>

                      <button
                        type="button"
                        onClick={stopLiveCamera}
                        className="bg-slate-900/85 hover:bg-slate-800 text-slate-300 p-1 rounded-full border border-slate-700 text-xs w-7 h-7 flex items-center justify-center shadow-md"
                        title="Close Camera Viewfinder"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Stability & Blur Metrics Bar */}
                  <div className="absolute bottom-16 inset-x-4 z-10 flex flex-col items-center pointer-events-none">
                    <div className="w-full max-w-xs bg-slate-950/85 backdrop-blur-md border border-slate-700/80 rounded-xl p-2.5 flex items-center gap-3 shadow-lg">
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-slate-300 font-medium">Stability (0.8s)</span>
                          <span
                            className={`font-mono font-bold ${
                              stabilityStatus.isStable ? 'text-emerald-400' : 'text-sky-300'
                            }`}
                          >
                            {Math.round(stabilityStatus.progress * 100)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-75 ${
                              stabilityStatus.isStable
                                ? 'bg-emerald-400'
                                : 'bg-gradient-to-r from-sky-400 to-emerald-400'
                            }`}
                            style={{ width: `${stabilityStatus.progress * 100}%` }}
                          />
                        </div>
                      </div>

                      <div className="text-right border-l border-slate-800 pl-2.5">
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">Sharpness</div>
                        <span
                          className={`text-xs font-mono font-bold ${
                            blurStatus.isSharp ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {blurStatus.isSharp ? 'Sharp' : 'Blurry'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Manual Shutter Button */}
                  <div className="absolute bottom-2.5 inset-x-0 flex items-center justify-center z-10">
                    <button
                      type="button"
                      onClick={handleCaptureCurrentFrame}
                      className="group relative flex items-center justify-center p-1 rounded-full active:scale-95 transition-transform"
                      title="Snap Current Frame"
                    >
                      <span
                        className={`absolute inset-0 rounded-full border-2 transition-all ${
                          stabilityStatus.isStable && blurStatus.isSharp
                            ? 'border-emerald-400 shadow-lg shadow-emerald-500/50 scale-110'
                            : 'border-white/50'
                        }`}
                      />
                      <span className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg text-slate-950 font-bold text-lg group-hover:bg-emerald-50">
                        📸
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* ACTION BUTTONS (When live camera is inactive) */}
              {!isLiveCameraActive && !previewUrl && (
                <div className="space-y-2.5 mb-4">
                  <button
                    type="button"
                    onClick={startLiveCamera}
                    disabled={isCameraLoading}
                    className="w-full min-h-[58px] bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:from-emerald-700 active:to-teal-700 text-white font-bold text-base rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-emerald-950/50 transition-all border border-emerald-400/30"
                  >
                    <span className="text-2xl animate-pulse">🎥</span>
                    <div className="text-left">
                      <div className="leading-tight">Start Live AI Scanner</div>
                      <div className="text-xs font-normal text-emerald-200">
                        Real-time bounding box &amp; 0.8s auto-capture
                      </div>
                    </div>
                  </button>

                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[46px] bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 text-sm font-semibold rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-colors"
                    >
                      <span className="text-lg">📸</span>
                      <span>System Camera</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="min-h-[46px] bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 text-sm font-semibold rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-colors"
                    >
                      <span className="text-lg">🖼️</span>
                      <span>Photo Library</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Compression in progress */}
              {isCompressing && (
                <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-700 text-center animate-pulse mb-4">
                  <p className="text-sm text-emerald-400 font-medium">Compressing photo on mobile device...</p>
                </div>
              )}

              {/* Image Preview & Compression Stats */}
              {previewUrl && !isLiveCameraActive && (
                <div className="space-y-3 mb-4">
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

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={startLiveCamera}
                      className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>🎥 Re-scan with Live AI</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>📸 Pick Another</span>
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* STEP 3: AI OBJECT CLASSIFICATION & IDENTIFICATION */}
            {previewUrl && (
              <section className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-xs font-black">
                      3
                    </span>
                    AI Object Identification
                  </span>
                  {classificationResult && (
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                        classificationResult.confidence === 'high'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : classificationResult.confidence === 'medium'
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      Confidence: {classificationResult.confidence.toUpperCase()}
                    </span>
                  )}
                </div>

                {isAnalyzing ? (
                  <div className="p-6 bg-slate-900/60 rounded-xl border border-slate-700 text-center">
                    <div className="text-4xl mb-2 animate-spin inline-block">🔍</div>
                    <p className="text-sm text-emerald-300 font-semibold animate-pulse">
                      Analyzing subject (Plant vs. Item classification)...
                    </p>
                  </div>
                ) : classificationResult?.confidence === 'low' ? (
                  <div className="p-4 bg-amber-950/40 border border-amber-500/40 rounded-xl text-center space-y-3">
                    <div className="text-3xl">⚠️</div>
                    <div>
                      <div className="text-sm font-bold text-amber-200">Image Too Blurry to Identify</div>
                      <p className="text-xs text-amber-300/80 mt-1">
                        {classificationResult.message || 'Please retake the photo closer and in focus.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={startLiveCamera}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-colors inline-flex items-center gap-1.5"
                    >
                      <span>🎥</span> Retake Photo Closer
                    </button>
                  </div>
                ) : classificationResult?.classification === 'item' ? (
                  <div className="p-3.5 bg-blue-950/40 border border-blue-500/30 rounded-xl space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs text-blue-400 font-semibold uppercase tracking-wider">
                          Item Identified: {classificationResult.category}
                        </div>
                        <div className="text-lg font-bold text-white">{classificationResult.productName}</div>
                      </div>
                      <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs px-2.5 py-1 rounded-lg font-bold">
                        📦 ITEM
                      </span>
                    </div>
                    {classificationResult.primaryFunction && (
                      <p className="text-xs text-slate-300 bg-slate-900/70 p-2.5 rounded-lg border border-slate-800">
                        <span className="font-semibold text-slate-200">Primary Function:</span>{' '}
                        {classificationResult.primaryFunction}
                      </p>
                    )}
                  </div>
                ) : (aiResult || classificationResult?.classification === 'plant') ? (
                  <div className="space-y-3">
                    <div className="p-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">
                            Plant Identified
                          </div>
                          <div className="text-lg font-bold text-white">
                            {classificationResult?.commonName || aiResult?.commonName}
                          </div>
                          <div className="text-sm italic text-emerald-300">
                            {classificationResult?.scientificName || aiResult?.botanicalName}
                          </div>
                        </div>
                        <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs px-2.5 py-1 rounded-lg font-bold">
                          🌿 PLANT
                        </span>
                      </div>

                      {/* Care badges */}
                      <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-emerald-900/50 text-xs">
                        {(classificationResult?.lightNeeds || aiResult?.sunReq) && (
                          <span className="bg-slate-800/80 text-amber-300 px-2 py-0.5 rounded-md">
                            ☀️ {classificationResult?.lightNeeds || aiResult?.sunReq.replace('_', ' ')}
                          </span>
                        )}
                        {(classificationResult?.wateringNeeds || aiResult?.waterFrequency) && (
                          <span className="bg-slate-800/80 text-blue-300 px-2 py-0.5 rounded-md">
                            💧 {classificationResult?.wateringNeeds || `Every ${aiResult?.waterFrequency} days`}
                          </span>
                        )}
                        {aiResult && (
                          <span className="bg-slate-800/80 text-emerald-300 px-2 py-0.5 rounded-md">
                            🐾 {aiResult.petSafe ? 'Pet Safe' : 'Keep Away From Pets'}
                          </span>
                        )}
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
                    {matchedSlots.map((url, i) => {
                      const slot = i + 1;
                      const isPicked = willSavePhoto && savingSlot === slot;
                      return (
                        <button
                          key={`slot-${slot}`}
                          type="button"
                          onClick={() => {
                            setSelectedSlot(slot);
                            setSaveNewPhoto(true);
                          }}
                          aria-pressed={isPicked}
                          aria-label={`Save new picture to slot ${slot}${url ? ' (replaces current)' : ' (empty)'}`}
                          className={`relative aspect-square w-full rounded-lg overflow-hidden transition-all ${
                            isPicked
                              ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-900'
                              : 'hover:ring-1 hover:ring-slate-500'
                          } ${url ? 'border border-slate-700' : 'bg-slate-800/60 border border-dashed border-slate-700 text-slate-600 text-lg flex items-center justify-center'}`}
                        >
                          {url ? (
                            <img
                              src={url}
                              alt={`${matchedExistingSpecies.commonName} photo ${slot}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span>🌿</span>
                          )}
                          <span className="absolute bottom-0.5 right-1 text-[10px] font-bold text-white bg-slate-900/70 rounded px-1">
                            {slot}
                          </span>
                        </button>
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
                        disabled={savingSlot === null}
                        onClick={() => setSaveNewPhoto(true)}
                        className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                          willSavePhoto
                            ? 'border-emerald-400 bg-emerald-950/60 text-white font-semibold'
                            : 'border-slate-700 bg-slate-800/50 text-slate-400'
                        }`}
                      >
                        <div className="font-bold text-slate-200">
                          {savingSlot === null ? '📸 Pick a slot above' : `📸 Save to slot ${savingSlot}`}
                        </div>
                        <div className="text-[11px] mt-0.5 text-slate-400">
                          {savingSlot === null
                            ? 'Tap a slot in the gallery to choose where the picture goes'
                            : matchedSlots[savingSlot - 1]
                              ? `Replaces the picture in slot ${savingSlot} (~50 KB)`
                              : `Fills empty slot ${savingSlot} of ${MAX_PHOTOS_PER_SPECIES} (~50 KB)`}
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
                    <span className="absolute left-3.5 top-3.5 text-base text-slate-400 font-bold">{currency.symbol}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatPriceInput(formPriceDollars)}
                      onChange={(e) => setFormPriceDollars(sanitizePriceInput(e.target.value))}
                      style={{ paddingLeft: `calc(0.875rem + ${currency.symbol.length}ch + 0.375rem)` }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl pr-3 py-3 text-base text-white font-mono focus:outline-none focus:border-emerald-500"
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
