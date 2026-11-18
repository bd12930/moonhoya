/**
 * High-efficiency client-side image compression for mobile devices (iOS & Android).
 * Resizes camera photos to an optimal max dimension and converts to WebP/JPEG,
 * shrinking 5MB-15MB phone photos down to ~30KB-80KB (>98% reduction) before upload.
 */

export interface CompressionResult {
  file: File;
  dataUrl: string;
  originalSize: number;
  compressedSize: number;
  reductionPercentage: number;
  dimensions: { width: number; height: number };
}

export async function compressImage(
  file: File,
  maxDimension = 960,
  quality = 0.72
): Promise<CompressionResult> {
  const originalSize = file.size;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate aspect-ratio-preserving scaled dimensions
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('Canvas 2D context could not be created'));
          return;
        }

        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);

        // Prefer modern WebP, fall back gracefully to JPEG on legacy iOS
        const mimeType = isWebPSupported() ? 'image/webp' : 'image/jpeg';
        const fileExt = mimeType === 'image/webp' ? '.webp' : '.jpg';
        const dataUrl = canvas.toDataURL(mimeType, quality);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Image compression blob failed'));
              return;
            }

            const cleanBaseName = file.name.replace(/\.[^/.]+$/, '');
            const compressedFileName = `${cleanBaseName}-compressed${fileExt}`;
            const compressedFile = new File([blob], compressedFileName, {
              type: mimeType,
              lastModified: Date.now(),
            });

            const reductionPercentage = Math.round(
              ((originalSize - blob.size) / originalSize) * 100
            );

            resolve({
              file: compressedFile,
              dataUrl,
              originalSize,
              compressedSize: blob.size,
              reductionPercentage: Math.max(0, reductionPercentage),
              dimensions: { width, height },
            });
          },
          mimeType,
          quality
        );
      };

      img.onerror = () => reject(new Error('Failed to load image into browser'));
      img.src = event.target?.result as string;
    };

    reader.onerror = () => reject(new Error('Failed to read photo file'));
    reader.readAsDataURL(file);
  });
}

/** Check if current browser (e.g. mobile Safari / Chrome) supports WebP export from canvas */
function isWebPSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
}

/** Format byte size to human readable (KB, MB) */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
