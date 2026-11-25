/**
 * Real-time Object Detection, Tracking, Frame Stability, and Blurriness Engine.
 * 
 * Provides:
 * 1. Real-time Object Detection with bounding box tracking (using MediaPipe Vision / Saliency fallback).
 * 2. Frame Stability Tracking: monitors bounding box stationary position for ~0.8s.
 * 3. Blurriness Detection: fast Laplacian variance analysis on the subject region before triggering cloud identification.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedSubject extends BoundingBox {
  label: string;
  confidence: number;
}

// MediaPipe detector singleton
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mediaPipeDetector: any = null;
let isLoadingMediaPipe = false;

/** Initialize MediaPipe Tasks Vision ObjectDetector dynamically in browser */
export async function initMediaPipeVision(): Promise<boolean> {
  if (typeof window === 'undefined' || mediaPipeDetector) return !!mediaPipeDetector;
  if (isLoadingMediaPipe) return false;

  isLoadingMediaPipe = true;
  try {
    // Dynamic ESM import from CDN so Next.js SSR / Cloudflare build is never affected
    const { FilesetResolver, ObjectDetector } = await (Function(
      'return import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm")'
    )());

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    mediaPipeDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
        delegate: 'GPU',
      },
      scoreThreshold: 0.35,
      runningMode: 'VIDEO',
    });
    return true;
  } catch (err) {
    console.info('MediaPipe dynamic CDN unavailable or offline; using local vision detector', err);
    return false;
  } finally {
    isLoadingMediaPipe = false;
  }
}

/** Detect subject using MediaPipe when available, falling back to local foliage vision */
export function detectSubject(
  video: HTMLVideoElement,
  analysisCanvas: HTMLCanvasElement,
  timestampMs = performance.now()
): DetectedSubject | null {
  const vW = video.videoWidth || 640;
  const vH = video.videoHeight || 480;

  if (mediaPipeDetector) {
    try {
      const results = mediaPipeDetector.detectForVideo(video, timestampMs);
      if (results && results.detections && results.detections.length > 0) {
        // Pick best detection
        const best = results.detections[0];
        const bbox = best.boundingBox;
        const category = best.categories?.[0];
        return {
          x: Math.max(0, Math.round(bbox.originX)),
          y: Math.max(0, Math.round(bbox.originY)),
          width: Math.min(vW - bbox.originX, Math.round(bbox.width)),
          height: Math.min(vH - bbox.originY, Math.round(bbox.height)),
          label: category?.categoryName || 'Subject',
          confidence: Math.round((category?.score ?? 0.8) * 100),
        };
      }
    } catch {
      // fallback on frame error
    }
  }

  return detectFoliageSubject(video, analysisCanvas);
}

export interface StabilityState {
  isStable: boolean;
  progress: number; // 0.0 to 1.0
  elapsedMs: number;
}

export interface BlurMetric {
  isSharp: boolean;
  score: number;
  threshold: number;
}

/** Compute Intersection over Union (IoU) between two bounding boxes */
export function calculateIoU(a: BoundingBox, b: BoundingBox): number {
  const xA = Math.max(a.x, b.x);
  const yA = Math.max(a.y, b.y);
  const xB = Math.min(a.x + a.width, b.x + b.width);
  const yB = Math.min(a.y + a.height, b.y + b.height);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  const unionArea = aArea + bArea - interArea;

  return unionArea <= 0 ? 0 : interArea / unionArea;
}

/** Check blurriness of an image region using Laplacian Variance */
export function evaluateBlurriness(
  sourceCanvasOrVideo: HTMLCanvasElement | HTMLVideoElement,
  box?: BoundingBox,
  threshold = 35
): BlurMetric {
  const sampleW = 120;
  const sampleH = 120;

  // Offscreen canvas for fast pixel extraction
  const offscreen = document.createElement('canvas');
  offscreen.width = sampleW;
  offscreen.height = sampleH;
  const ctx = offscreen.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return { isSharp: true, score: 999, threshold };
  }

  const sW = 'videoWidth' in sourceCanvasOrVideo ? sourceCanvasOrVideo.videoWidth : sourceCanvasOrVideo.width;
  const sH = 'videoHeight' in sourceCanvasOrVideo ? sourceCanvasOrVideo.videoHeight : sourceCanvasOrVideo.height;

  const cropX = box ? Math.max(0, Math.min(box.x, sW - 10)) : 0;
  const cropY = box ? Math.max(0, Math.min(box.y, sH - 10)) : 0;
  const cropW = box ? Math.max(10, Math.min(box.width, sW - cropX)) : sW;
  const cropH = box ? Math.max(10, Math.min(box.height, sH - cropY)) : sH;

  ctx.drawImage(sourceCanvasOrVideo, cropX, cropY, cropW, cropH, 0, 0, sampleW, sampleH);
  const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
  const data = imgData.data;

  // Grayscale conversion
  const gray = new Float32Array(sampleW * sampleH);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // 3x3 discrete Laplacian filter convolution
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const idx = y * sampleW + x;
      const lap =
        gray[idx - sampleW] +
        gray[idx + sampleW] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];

      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return { isSharp: false, score: 0, threshold };

  const mean = sum / count;
  const variance = Math.round((sumSq / count - mean * mean) * 10) / 10;

  return {
    isSharp: variance >= threshold,
    score: variance,
    threshold,
  };
}

/**
 * Fallback heuristic saliency & plant detector:
 * Identifies the primary central foreground object (e.g. plant / leaves) by color & edge density.
 */
export function detectFoliageSubject(
  video: HTMLVideoElement,
  analysisCanvas: HTMLCanvasElement
): DetectedSubject | null {
  const vW = video.videoWidth || 640;
  const vH = video.videoHeight || 480;

  const smallW = 160;
  const smallH = 120;
  analysisCanvas.width = smallW;
  analysisCanvas.height = smallH;
  const ctx = analysisCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, smallW, smallH);
  const data = ctx.getImageData(0, 0, smallW, smallH).data;

  let minX = smallW;
  let minY = smallH;
  let maxX = 0;
  let maxY = 0;
  let subjectPixels = 0;

  for (let y = 0; y < smallH; y++) {
    for (let x = 0; x < smallW; x++) {
      const i = (y * smallW + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Green vegetation or high-contrast foreground subject
      const isPlant = g > r * 0.92 && g > b && g > 35;
      const isBronze = r > 80 && g > 55 && b < g && Math.abs(r - g) < 50;

      if (isPlant || isBronze) {
        subjectPixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // If sufficient subject pixels detected, scale back to full video coordinates
  const minRequiredPixels = (smallW * smallH) * 0.03;
  if (subjectPixels > minRequiredPixels && maxX > minX && maxY > minY) {
    const scaleX = vW / smallW;
    const scaleY = vH / smallH;

    // Add gentle padding to bounding box
    const padX = 12 * scaleX;
    const padY = 12 * scaleY;

    const x = Math.max(0, minX * scaleX - padX);
    const y = Math.max(0, minY * scaleY - padY);
    const width = Math.min(vW - x, (maxX - minX) * scaleX + padX * 2);
    const height = Math.min(vH - y, (maxY - minY) * scaleY + padY * 2);

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      label: 'Plant Subject',
      confidence: Math.min(95, Math.round(50 + (subjectPixels / (smallW * smallH)) * 80)),
    };
  }

  // If no specific green contrast found, center a default targeting region
  const defaultW = Math.round(vW * 0.65);
  const defaultH = Math.round(vH * 0.65);
  return {
    x: Math.round((vW - defaultW) / 2),
    y: Math.round((vH - defaultH) / 2),
    width: defaultW,
    height: defaultH,
    label: 'Focus Subject',
    confidence: 60,
  };
}

/**
 * Tracks stability of an object bounding box over time.
 * Required duration default: 800ms (0.8s).
 */
export class FrameStabilityTracker {
  private stableStartTime: number | null = null;
  private lastBox: BoundingBox | null = null;
  private requiredDurationMs: number;

  constructor(requiredDurationMs = 800) {
    this.requiredDurationMs = requiredDurationMs;
  }

  public reset(): void {
    this.stableStartTime = null;
    this.lastBox = null;
  }

  public update(currentBox: BoundingBox | null, now = performance.now()): StabilityState {
    if (!currentBox) {
      this.reset();
      return { isStable: false, progress: 0, elapsedMs: 0 };
    }

    if (!this.lastBox || !this.stableStartTime) {
      this.lastBox = { ...currentBox };
      this.stableStartTime = now;
      return { isStable: false, progress: 0, elapsedMs: 0 };
    }

    const iou = calculateIoU(this.lastBox, currentBox);

    // Center displacement
    const c1X = this.lastBox.x + this.lastBox.width / 2;
    const c1Y = this.lastBox.y + this.lastBox.height / 2;
    const c2X = currentBox.x + currentBox.width / 2;
    const c2Y = currentBox.y + currentBox.height / 2;
    const dist = Math.hypot(c2X - c1X, c2Y - c1Y);
    const maxDimension = Math.max(currentBox.width, currentBox.height);
    const normalizedShift = maxDimension > 0 ? dist / maxDimension : 1;

    // Smooth position interpolation to prevent jitter
    this.lastBox.x = this.lastBox.x * 0.7 + currentBox.x * 0.3;
    this.lastBox.y = this.lastBox.y * 0.7 + currentBox.y * 0.3;
    this.lastBox.width = this.lastBox.width * 0.7 + currentBox.width * 0.3;
    this.lastBox.height = this.lastBox.height * 0.7 + currentBox.height * 0.3;

    // Check if the subject has moved excessively (forgiving threshold for hand-held phone stability)
    if (iou < 0.65 || normalizedShift > 0.14) {
      this.stableStartTime = now;
      return { isStable: false, progress: 0, elapsedMs: 0 };
    }

    const elapsed = now - this.stableStartTime;
    const progress = Math.min(1.0, elapsed / this.requiredDurationMs);
    const isStable = elapsed >= this.requiredDurationMs;

    return {
      isStable,
      progress,
      elapsedMs: Math.round(elapsed),
    };
  }
}

/**
 * Draws the real-time bounding box, corner brackets, and stability HUD on an overlay canvas.
 */
export function drawTrackingOverlay(
  ctx: CanvasRenderingContext2D,
  box: DetectedSubject | null,
  stability: StabilityState,
  blur: BlurMetric,
  canvasW: number,
  canvasH: number,
  videoW: number,
  videoH: number
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  if (!box || videoW <= 0 || videoH <= 0) return;

  // Coordinate scaling from video natural size to display canvas size
  const scaleX = canvasW / videoW;
  const scaleY = canvasH / videoH;

  const bx = box.x * scaleX;
  const by = box.y * scaleY;
  const bw = box.width * scaleX;
  const bh = box.height * scaleY;

  const isLocked = stability.isStable && blur.isSharp;
  const accentColor = isLocked ? '#10b981' : stability.progress > 0.5 ? '#34d399' : '#38bdf8';
  const bracketLen = Math.min(28, Math.min(bw, bh) * 0.25);

  ctx.save();

  // Subtle translucent bounding box fill
  ctx.fillStyle = isLocked ? 'rgba(16, 185, 129, 0.12)' : 'rgba(56, 189, 248, 0.06)';
  ctx.fillRect(bx, by, bw, bh);

  // Corner brackets
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Top-left
  ctx.beginPath();
  ctx.moveTo(bx, by + bracketLen);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + bracketLen, by);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(bx + bw - bracketLen, by);
  ctx.lineTo(bx + bw, by);
  ctx.lineTo(bx + bw, by + bracketLen);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(bx + bw, by + bh - bracketLen);
  ctx.lineTo(bx + bw, by + bh);
  ctx.lineTo(bx + bw - bracketLen, by + bh);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(bx + bracketLen, by + bh);
  ctx.lineTo(bx, by + bh);
  ctx.lineTo(bx, by + bh - bracketLen);
  ctx.stroke();

  // Stability progress bar at top of bounding box
  const barHeight = 4;
  const barY = Math.max(6, by - 12);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.fillRect(bx, barY, bw, barHeight);

  if (stability.progress > 0) {
    ctx.fillStyle = accentColor;
    ctx.fillRect(bx, barY, bw * stability.progress, barHeight);
  }

  // Label tag badge
  const labelText = `${box.label} (${box.confidence}%)`;
  ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif';
  const textMetrics = ctx.measureText(labelText);
  const badgeW = textMetrics.width + 16;
  const badgeH = 22;
  const badgeY = Math.max(0, by - badgeH - 16);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.beginPath();
  ctx.roundRect(bx, badgeY, badgeW, badgeH, 6);
  ctx.fill();

  ctx.fillStyle = accentColor;
  ctx.fillText(labelText, bx + 8, badgeY + 15);

  // Status message at bottom of bounding box
  let statusText = '';
  if (!blur.isSharp) {
    statusText = '⚠️ Adjusting focus...';
  } else if (!stability.isStable) {
    statusText = `⏳ Hold steady (${Math.round(stability.progress * 100)}%)`;
  } else {
    statusText = '✨ Auto-Capturing...';
  }

  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  const statusMetrics = ctx.measureText(statusText);
  const statusBadgeW = statusMetrics.width + 14;
  const statusY = Math.min(canvasH - 24, by + bh + 8);

  ctx.fillStyle = isLocked ? 'rgba(6, 78, 59, 0.9)' : 'rgba(15, 23, 42, 0.85)';
  ctx.beginPath();
  ctx.roundRect(bx, statusY, statusBadgeW, 20, 6);
  ctx.fill();

  ctx.fillStyle = isLocked ? '#6ee7b7' : !blur.isSharp ? '#fcd34d' : '#93c5fd';
  ctx.fillText(statusText, bx + 7, statusY + 14);

  ctx.restore();
}

/**
 * Capture high-resolution still frame from HTMLVideoElement as a File
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  fileName = 'live-scan.jpg'
): Promise<File> {
  const vW = video.videoWidth || 1280;
  const vH = video.videoHeight || 720;

  const canvas = document.createElement('canvas');
  canvas.width = vW;
  canvas.height = vH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context for video capture');

  ctx.drawImage(video, 0, 0, vW, vH);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to generate image blob from video stream'));
          return;
        }
        const file = new File([blob], fileName, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        resolve(file);
      },
      'image/jpeg',
      0.92
    );
  });
}
