/**
 * Shared live-device-input engine (issue #204's v1 pilot): a camera and a
 * microphone adapter built on one generic lifecycle hook, following the
 * design doc's own "one shared engine, thin per-device adapters" plan.
 *
 * Neither adapter touches CellGraph directly -- each takes an `onFrame`/
 * `onSamples` callback the CALLING component wires to a `graph.set(...)`
 * on a free cell (`ids.uploadedGrid` for the camera, a new
 * `ids.liveWaveformOverride` for the mic), matching the existing
 * `use-timeline-playback.ts` precedent this design doc calls out: an
 * effect owns the external resource/loop and pushes into a free cell,
 * with every downstream `define()`d cell staying unaware its upstream is
 * a live device rather than a user edit.
 *
 * Design decision from the issue's own "open questions": permission is
 * requested the instant `enabled` flips true (matches the "opt-in
 * checkbox" convention already used everywhere else in this app), and
 * `enabled` itself is never part of a panel's persisted URL state -- a
 * shared link always opens with live input off, requiring a fresh click,
 * so opening a link never silently triggers a camera/mic permission
 * prompt.
 */
import { useEffect, useRef, useState } from "react";

export interface LiveInputStatus {
  /** True once the device is actually acquired and sampling has started (not just "enabled" -- there's a brief window while permission is pending). */
  active: boolean;
  error: string | null;
}

/**
 * The generic lifecycle: SSR-safe, starts `acquire` when `enabled` flips
 * true, always calls the returned cleanup on `enabled` flipping false OR
 * unmount. `acquire` reports its own start/failure via the two callbacks
 * rather than a return value, since acquisition (`getUserMedia`) is
 * inherently async and the effect needs to keep running the RAF/event
 * loop it sets up regardless of when (or whether) that promise resolves.
 */
function useLiveInputLifecycle(
  enabled: boolean,
  acquire: (onActive: () => void, onError: (message: string) => void) => (() => void) | undefined,
): LiveInputStatus {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setActive(false);
      return;
    }
    let cancelled = false;
    setError(null);
    const cleanup = acquire(
      () => {
        if (!cancelled) setActive(true);
      },
      (message) => {
        if (!cancelled) {
          setError(message);
          setActive(false);
        }
      },
    );
    return () => {
      cancelled = true;
      setActive(false);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { active, error };
}

/** True when the current browser exposes the getUserMedia surface at all -- checked before ever touching the API, mirroring pointer-media.ts's own `typeof window.matchMedia !== "function"` feature-detection shape. */
export function hasMediaDevices(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/**
 * Camera adapter: acquires `getUserMedia({video: true})`, draws each frame
 * to an offscreen canvas via requestAnimationFrame, and hands the raw RGBA
 * `ImageData.data` (plus width/height) to `onFrame` -- the caller converts
 * it with whatever grid function it already has (ImageFrequencyPanel
 * reuses its own existing `rgbaToGrayscaleGrid` unchanged, per the design
 * doc: "Structurally identical to handleFile").
 */
export function useLiveCameraFrame(enabled: boolean, onFrame: (data: Uint8ClampedArray, width: number, height: number) => void): LiveInputStatus {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  return useLiveInputLifecycle(enabled, (onActive, onError) => {
    if (!hasMediaDevices()) {
      onError("This browser doesn't support camera access.");
      return undefined;
    }
    let stream: MediaStream | null = null;
    let raf = 0;
    const video = document.createElement("video");
    video.playsInline = true;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((s) => {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(() => {
        onActive();
        const tick = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0 && ctx) {
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            ctx.drawImage(video, 0, 0);
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
            onFrameRef.current(frame.data, canvas.width, canvas.height);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch((e: unknown) => {
        onError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      video.pause();
      video.srcObject = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  });
}

/**
 * Microphone adapter: acquires `getUserMedia({audio: true})`, polls an
 * `AnalyserNode`'s time-domain buffer once per requestAnimationFrame, and
 * hands `{t, y, sampleRate}` (the same shape `signal-waveform.ts`'s
 * `Waveform` already uses) to `onWaveform`.
 */
export function useLiveMicrophoneWaveform(enabled: boolean, onWaveform: (waveform: { t: number[]; y: number[]; sampleRate: number }) => void): LiveInputStatus {
  const onWaveformRef = useRef(onWaveform);
  onWaveformRef.current = onWaveform;

  return useLiveInputLifecycle(enabled, (onActive, onError) => {
    if (!hasMediaDevices()) {
      onError("This browser doesn't support microphone access.");
      return undefined;
    }
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let raf = 0;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        stream = s;
        const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new AudioContextCtor();
        const source = audioCtx.createMediaStreamSource(s);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);
        onActive();
        const tick = () => {
          analyser.getFloatTimeDomainData(buffer);
          const sampleRate = audioCtx?.sampleRate ?? 44100;
          const y = Array.from(buffer);
          const t = y.map((_, i) => i / sampleRate);
          onWaveformRef.current({ t, y, sampleRate });
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch((e: unknown) => {
        onError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close();
    };
  });
}
