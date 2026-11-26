'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

/**
 * Camera capabilities that are missing from some browsers' TypeScript DOM typings.
 * Each control is only shown when the device reports support for it.
 */
interface ExtraCapabilities {
  zoom?: { min: number; max: number; step: number };
  torch?: boolean;
  focusMode?: string[];
  focusDistance?: { min: number; max: number; step: number };
}
interface ExtraSettings {
  zoom?: number;
  focusDistance?: number;
}
interface AdvancedConstraint {
  zoom?: number;
  torch?: boolean;
  focusMode?: string;
  focusDistance?: number;
}

/** auto = continuous autofocus, locked = focus frozen where it is, macro = closest focus distance. */
type FocusState = 'auto' | 'locked' | 'macro';

const TIMER_OPTIONS = [0, 3, 10];

interface CameraViewProps {
  /** Called with the captured photo, or a photo picked from the library. */
  onFile: (file: File) => void;
  onClose: () => void;
}

export default function CameraView({ onFile, onClose }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const systemInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [caps, setCaps] = useState<ExtraCapabilities>({});
  const [zoom, setZoom] = useState(1);
  const [torchOn, setTorchOn] = useState(false);
  const [focus, setFocus] = useState<FocusState>('auto');
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  /** Applies a camera control to the live track. Unsupported controls are simply not shown. */
  function applyAdvanced(constraint: AdvancedConstraint) {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track
      .applyConstraints({ advanced: [constraint] } as unknown as MediaTrackConstraints)
      .catch((err) => console.warn('Camera control not applied', err));
  }

  // Start the live camera once and stop it when the view closes.
  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        const capabilities: ExtraCapabilities =
          typeof track.getCapabilities === 'function'
            ? (track.getCapabilities() as unknown as ExtraCapabilities)
            : {};
        const settings = track.getSettings() as unknown as ExtraSettings;
        setCaps(capabilities);
        if (capabilities.zoom) setZoom(settings.zoom ?? capabilities.zoom.min);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch (err) {
        console.error('Camera unavailable', err);
        if (!cancelled) {
          setError('Camera not available. Check camera permission, or use the phone camera app.');
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError('Camera is not ready yet. Try again in a moment.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Could not capture the photo. Please try again.');
          return;
        }
        onFile(new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92
    );
  }, [onFile]);

  // Timer countdown: tick once per second, then take the photo.
  useEffect(() => {
    if (countdown === null) return;
    const t = window.setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(null);
        capture();
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);
    return () => window.clearTimeout(t);
  }, [countdown, capture]);

  function handleShutter() {
    if (!ready || countdown !== null) return;
    if (timerSeconds === 0) capture();
    else setCountdown(timerSeconds);
  }

  function cycleTimer() {
    const idx = TIMER_OPTIONS.indexOf(timerSeconds);
    setTimerSeconds(TIMER_OPTIONS[(idx + 1) % TIMER_OPTIONS.length]);
  }

  function toggleTorch() {
    const next = !torchOn;
    setTorchOn(next);
    applyAdvanced({ torch: next });
  }

  function handleZoom(value: number) {
    setZoom(value);
    applyAdvanced({ zoom: value });
  }

  function setFocusState(next: FocusState) {
    setFocus(next);
    if (next === 'auto') {
      applyAdvanced({ focusMode: 'continuous' });
      return;
    }
    const range = caps.focusDistance;
    if (next === 'macro') {
      // Closest focus distance the lens supports, for close-up shots.
      applyAdvanced(range ? { focusMode: 'manual', focusDistance: range.min } : { focusMode: 'manual' });
      return;
    }
    // locked: keep the distance the lens is focused on right now.
    const track = streamRef.current?.getVideoTracks()[0];
    const current = (track?.getSettings() as unknown as ExtraSettings | undefined)?.focusDistance;
    applyAdvanced(
      range
        ? { focusMode: 'manual', focusDistance: current ?? (range.min + range.max) / 2 }
        : { focusMode: 'manual' }
    );
  }

  function handleChosenFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onFile(file);
  }

  const supportsLock = caps.focusMode?.includes('manual') ?? false;
  const supportsMacro = supportsLock && !!caps.focusDistance;
  const focusButtons: { id: FocusState; label: string; show: boolean }[] = [
    { id: 'auto', label: 'Auto', show: true },
    { id: 'locked', label: 'Lock', show: supportsLock },
    { id: 'macro', label: 'Macro', show: supportsMacro },
  ];

  const pillClass = 'rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium backdrop-blur';

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between p-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close camera"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-xl"
        >
          ✕
        </button>
        <div className="flex gap-2">
          {caps.torch && (
            <button type="button" onClick={toggleTorch} className={pillClass} aria-pressed={torchOn}>
              {torchOn ? '⚡ Flash on' : '⚡ Flash off'}
            </button>
          )}
          <button type="button" onClick={cycleTimer} className={pillClass}>
            ⏱ {timerSeconds ? `${timerSeconds}s` : 'Off'}
          </button>
        </div>
      </div>

      {/* Timer countdown */}
      {countdown !== null && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="text-8xl font-bold drop-shadow-lg">{countdown}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="relative z-10 mx-4 space-y-3 rounded-2xl bg-black/70 p-4 text-center text-sm">
          <p>{error}</p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => systemInputRef.current?.click()}
              className="rounded-full bg-emerald-600 px-4 py-2 font-semibold"
            >
              Phone camera app
            </button>
            <button type="button" onClick={onClose} className="rounded-full bg-white/20 px-4 py-2">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="relative z-10 mt-auto space-y-4 p-4 pb-10">
        {caps.zoom && (
          <div className="flex items-center gap-3">
            <span className="w-12 text-sm font-medium">{zoom.toFixed(1)}×</span>
            <input
              type="range"
              min={caps.zoom.min}
              max={caps.zoom.max}
              step={caps.zoom.step || 0.1}
              value={zoom}
              onChange={(e) => handleZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="flex-1 accent-emerald-500"
            />
          </div>
        )}

        {supportsLock && (
          <div className="flex justify-center gap-2">
            {focusButtons
              .filter((b) => b.show)
              .map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setFocusState(b.id)}
                  aria-pressed={focus === b.id}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                    focus === b.id ? 'bg-emerald-500 text-white' : 'bg-black/50 text-white/90'
                  }`}
                >
                  {b.label}
                </button>
              ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            className="w-20 text-sm font-medium text-white/90"
          >
            🖼 Library
          </button>
          <button
            type="button"
            onClick={handleShutter}
            disabled={!ready}
            aria-label="Take photo"
            className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white disabled:opacity-40 active:scale-95"
          >
            <span className="h-14 w-14 rounded-full bg-white" />
          </button>
          <div className="w-20" />
        </div>
      </div>

      {/* Photo library (no capture attribute, so the user picks an existing photo) */}
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChosenFile}
      />
      {/* Native camera fallback for browsers where the live camera cannot start */}
      <input
        ref={systemInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChosenFile}
      />
    </div>
  );
}
