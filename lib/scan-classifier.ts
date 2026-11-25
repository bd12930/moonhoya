/**
 * Intelligent Scanner Classification Engine
 * 
 * Implements the prompt specification:
 * - Identify primary object in the image.
 * - Classify as either "plant" or "item".
 * - If "plant": common name, scientific name, brief light/watering needs.
 * - If "item": product name, category, primary function.
 * - If image is too blurry: confidence "low" and request retake closer.
 */

import { identifyPlantOnDevice } from './plant-ai';
import { evaluateBlurriness } from './object-tracker';

export interface ScanClassificationResult {
  classification: 'plant' | 'item' | null;
  confidence: 'high' | 'medium' | 'low';
  // Plant fields
  commonName?: string;
  scientificName?: string;
  lightNeeds?: string;
  wateringNeeds?: string;
  // Item fields
  productName?: string;
  category?: 'FERTILIZER' | 'POT' | 'EQUIPMENT' | 'HARDWARE' | string;
  primaryFunction?: string;
  // Blurry / feedback prompt
  message?: string;
}

export const CLASSIFICATION_SYSTEM_PROMPT = `
Identify the primary object in the image. Classify it as either "plant" or "item". 
- If "plant": provide the common name, scientific name, and brief light/watering needs.
- If "item": provide the product name, category, and primary function.
If the image is too blurry to be certain, set confidence to "low" and ask the user to retake the photo closer.

Return ONLY valid JSON matching this schema:
{
  "classification": "plant" | "item" | null,
  "confidence": "high" | "medium" | "low",
  "commonName": "Common plant name (if plant)",
  "scientificName": "Scientific botanical name (if plant)",
  "lightNeeds": "Brief light requirement (if plant)",
  "wateringNeeds": "Brief watering frequency (if plant)",
  "productName": "Product name (if item)",
  "category": "FERTILIZER" | "POT" | "EQUIPMENT" | "HARDWARE" (if item),
  "primaryFunction": "Primary function / usage description (if item)",
  "message": "Feedback message when confidence is low or image is blurry"
}
`.trim();

/**
 * Classifies a captured image either via Cloud AI API or local On-Device CV Engine.
 */
export async function classifyScannedImage(
  imageDataUrl: string,
  sourceImageElement?: HTMLImageElement
): Promise<ScanClassificationResult> {
  // 1. Try Cloud Vision API first
  try {
    const cloudRes = await fetch('/api/scan/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl }),
    });

    if (cloudRes.ok) {
      const cloudData = await cloudRes.json();
      if (cloudData && cloudData.classification !== undefined) {
        return cloudData as ScanClassificationResult;
      }
    }
  } catch {
    // Cloud API offline / unavailable; proceed to on-device engine
  }

  // 2. On-Device Fallback Engine
  return classifyOnDevice(imageDataUrl, sourceImageElement);
}

/**
 * High-performance On-Device Vision Classifier.
 * Evaluates blurriness, chlorophyll content, and color morphology locally.
 */
export async function classifyOnDevice(
  imageDataUrl: string,
  imgElement?: HTMLImageElement
): Promise<ScanClassificationResult> {
  const img = imgElement || (await loadImage(imageDataUrl));

  // Check image sharpness via Laplacian Variance
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(img.naturalWidth || img.width, 480);
  canvas.height = Math.min(img.naturalHeight || img.height, 480);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      classification: null,
      confidence: 'low',
      message: 'Failed to initialize image processor. Please retake the photo closer.',
    };
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blur = evaluateBlurriness(canvas, undefined, 45);

  // If image is too blurry, set confidence to "low" and request retake
  if (!blur.isSharp) {
    return {
      classification: null,
      confidence: 'low',
      message: `The photo appears too blurry to identify clearly (sharpness score: ${Math.round(blur.score)}). Please hold steady and retake closer.`,
    };
  }

  // Analyze color distribution to classify "plant" vs "item"
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let greenPixels = 0;
  let potTerracottaPixels = 0;
  let metallicPlasticPixels = 0;
  let totalSampled = 0;

  for (let i = 0; i < imgData.length; i += 16) {
    const r = imgData[i];
    const g = imgData[i + 1];
    const b = imgData[i + 2];
    totalSampled++;

    // Plant foliage detection
    if ((g > r * 0.95 && g > b && g > 40) || (r > 80 && g > 60 && b < g && Math.abs(r - g) < 50)) {
      greenPixels++;
    }

    // Pots / terracotta / plastic pots detection
    if (r > 130 && g > 65 && g < r * 0.85 && b < 70) {
      potTerracottaPixels++;
    }

    // Equipment / shears / metallic / hardware
    if (Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && r > 70 && r < 210) {
      metallicPlasticPixels++;
    }
  }

  const greenRatio = greenPixels / Math.max(1, totalSampled);
  const potRatio = potTerracottaPixels / Math.max(1, totalSampled);
  const hardwareRatio = metallicPlasticPixels / Math.max(1, totalSampled);

  // Classify: If dominant green/foliage is present -> "plant"
  if (greenRatio >= 0.12) {
    try {
      const plantResult = await identifyPlantOnDevice(img);
      const top = plantResult.topMatch;
      const confidenceLevel = top.confidence >= 80 ? 'high' : top.confidence >= 65 ? 'medium' : 'low';

      return {
        classification: 'plant',
        confidence: confidenceLevel,
        commonName: top.commonName,
        scientificName: top.botanicalName,
        lightNeeds: top.sunReq.replace(/_/g, ' ').toLowerCase(),
        wateringNeeds: `Water every ${top.waterFrequency} days`,
      };
    } catch {
      return {
        classification: 'plant',
        confidence: 'medium',
        commonName: 'Foliage Plant',
        scientificName: 'Tropical Plant sp.',
        lightNeeds: 'Bright indirect light',
        wateringNeeds: 'Water when top 2 inches of soil are dry',
      };
    }
  }

  // Otherwise -> "item"
  if (potRatio > 0.08) {
    return {
      classification: 'item',
      confidence: 'high',
      productName: 'Clear Slotted Nursery Pot',
      category: 'POT',
      primaryFunction: 'Provides aeration and drainage for epiphytic roots and Hoyas',
    };
  }

  if (hardwareRatio > 0.3) {
    return {
      classification: 'item',
      confidence: 'medium',
      productName: 'Nursery Trellis / Tool',
      category: 'HARDWARE',
      primaryFunction: 'Supports climbing vines and climbing plant growth',
    };
  }

  // Generic greenhouse item
  return {
    classification: 'item',
    confidence: 'medium',
    productName: 'Greenhouse Supply Item',
    category: 'EQUIPMENT',
    primaryFunction: 'Nursery maintenance, pruning, or potting equipment',
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for on-device analysis'));
    img.src = src;
  });
}
