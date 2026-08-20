/**
 * Issue #50's sonification half: sweep x across the viewport mapping f(x)
 * to pitch. Split into a pure, testable schedule builder (the actual
 * "what should play when" logic) and a thin real-Web-Audio player (not
 * unit tested -- real timers/hardware, matching `live-input.ts`'s own
 * "engine vs. adapter" split and its `AudioContext`/`webkitAudioContext`
 * fallback convention).
 */
import type { Path2D } from "mallory-math";
import type { Viewport } from "./viewport.ts";

export interface SonificationStep {
  /** Seconds since the sweep started. */
  time: number;
  /** null = silence (inside a discontinuity gap, or no sample found here). */
  frequency: number | null;
}

interface DiscontinuityGap {
  before: { x: number; y: number };
  after: { x: number; y: number };
}

function findNearestY(path: Path2D, x: number): number | null {
  let bestY: number | null = null;
  let bestDist = Infinity;
  for (const c of path.commands) {
    const d = Math.abs(c.x - x);
    if (d < bestDist) {
      bestDist = d;
      bestY = c.y;
    }
  }
  return bestY;
}

function inAnyGap(x: number, discontinuities: readonly DiscontinuityGap[]): boolean {
  return discontinuities.some((g) => x > g.before.x && x < g.after.x);
}

/** Maps an x in [viewport.xMin, viewport.xMax] to a time in [0, durationSeconds] -- the same linear sweep the schedule itself uses, exposed so a caller can place event markers (e.g. root clicks) at the right moment. */
export function xToSweepTime(x: number, viewport: Viewport, durationSeconds: number): number {
  const span = viewport.xMax - viewport.xMin;
  if (span <= 0) return 0;
  return ((x - viewport.xMin) / span) * durationSeconds;
}

/**
 * Builds an evenly time-spaced sweep across the viewport's x-range,
 * mapping each step's y (nearest-sampled-point, clamped to the viewport's
 * y-range) linearly onto [minFrequency, maxFrequency]. A step lands on
 * `frequency: null` (silence) whenever its x falls inside a
 * discontinuity gap, per the issue's "discontinuities as silences" ask.
 */
export function buildSonificationSchedule(
  path: Path2D,
  discontinuities: readonly DiscontinuityGap[],
  viewport: Viewport,
  durationSeconds: number,
  options?: { minFrequency?: number; maxFrequency?: number; stepCount?: number },
): SonificationStep[] {
  const stepCount = options?.stepCount ?? 60;
  const minFrequency = options?.minFrequency ?? 220;
  const maxFrequency = options?.maxFrequency ?? 880;
  const yRange = viewport.yMax - viewport.yMin || 1;
  const steps: SonificationStep[] = [];
  for (let i = 0; i < stepCount; i++) {
    const frac = stepCount > 1 ? i / (stepCount - 1) : 0;
    const time = frac * durationSeconds;
    const x = viewport.xMin + frac * (viewport.xMax - viewport.xMin);
    if (path.commands.length === 0 || inAnyGap(x, discontinuities)) {
      steps.push({ time, frequency: null });
      continue;
    }
    const y = findNearestY(path, x);
    if (y === null || !Number.isFinite(y)) {
      steps.push({ time, frequency: null });
      continue;
    }
    const clampedY = Math.min(viewport.yMax, Math.max(viewport.yMin, y));
    const normalized = (clampedY - viewport.yMin) / yRange;
    steps.push({ time, frequency: minFrequency + normalized * (maxFrequency - minFrequency) });
  }
  return steps;
}

/**
 * Plays a schedule via a single oscillator whose frequency/gain are
 * scheduled ahead of time with `setValueAtTime` (silence = gain 0, not a
 * paused oscillator -- avoids audible clicks from stopping/restarting).
 * `rootTimes` (seconds, see {@link xToSweepTime}) get a brief gain spike
 * layered on top, the sweep's audible "click" for a root crossing.
 * Returns a `stop()` to cancel early (e.g. the panel unmounts mid-sweep).
 * `onEnded`, if given, fires once whether playback stops early via `stop()`
 * or finishes naturally -- callers use it to flip a "playing" UI flag back
 * off without polling or a separately-tracked timer.
 */
export function playSonification(
  schedule: SonificationStep[],
  rootTimes: readonly number[] = [],
  onEnded?: () => void,
): { stop: () => void } {
  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioContextCtor();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.connect(gain);
  gain.connect(ctx.destination);

  const startTime = ctx.currentTime + 0.05;
  gain.gain.setValueAtTime(0, startTime);
  for (const step of schedule) {
    const when = startTime + step.time;
    if (step.frequency === null) {
      gain.gain.setValueAtTime(0, when);
    } else {
      osc.frequency.setValueAtTime(step.frequency, when);
      gain.gain.setValueAtTime(0.15, when);
    }
  }
  for (const rt of rootTimes) {
    const when = startTime + rt;
    gain.gain.setValueAtTime(0.4, when);
    gain.gain.setValueAtTime(0.15, when + 0.03);
  }

  const totalDuration = schedule.length > 0 ? (schedule[schedule.length - 1] as SonificationStep).time : 0;
  osc.start(startTime);
  osc.stop(startTime + totalDuration + 0.1);
  // Fires for BOTH the natural osc.stop() above and an early manual stop()
  // below (calling .stop() again after it already fired is a no-op, not a
  // second event) -- the single path the "playing" UI flag needs.
  let ended = false;
  osc.onended = () => {
    if (ended) return;
    ended = true;
    onEnded?.();
  };

  return {
    stop: () => {
      try {
        osc.stop();
      } catch {
        // Already stopped -- calling stop() twice throws, harmless.
      }
      void ctx.close();
    },
  };
}
