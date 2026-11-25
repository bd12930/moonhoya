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
 * On-Device Fallback Vision Classifier.
 * 
 * IMPORTANT: Without a cloud AI key (Gemini / OpenAI), this classifier can only
 * perform basic blurriness checks. It does NOT attempt to guess plant species or
 * item types from color histograms — that approach was fundamentally unreliable
 * and produced 100% incorrect identifications in real-world testing.
 * 
 * With no cloud AI key configured, the user is prompted to add one in Settings.
 * When a key is configured, the cloud API in /api/scan/identify handles all
 * classification and identification accurately via vision LLMs.
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
  const blur = evaluateBlurriness(canvas, undefined, 28);

  // If image is too blurry, set confidence to "low" and request retake
  if (!blur.isSharp) {
    return {
      classification: null,
      confidence: 'low',
      message: `The photo appears too blurry to identify clearly (sharpness score: ${Math.round(blur.score)}). Please hold steady and retake closer.`,
    };
  }

  // Without a cloud AI key, we cannot reliably identify plants or items.
  // Return low confidence and direct user to configure a Gemini API key.
  return {
    classification: null,
    confidence: 'low',
    message: 'No AI Vision key configured. Add your free Google Gemini API key in Settings (⚙️) → "AI Vision Recognition" to accurately identify plants and items. You can still fill in the details manually below.',
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
