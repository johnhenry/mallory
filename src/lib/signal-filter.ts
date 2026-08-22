/**
 * Filter design + apply + Welch PSD (issue #31's remaining pipeline
 * stages 4-5): `butter` (Butterworth SOS design) -> `freqz` (Bode
 * magnitude/phase response) -> `sosFilter` (apply to the waveform) ->
 * `welch` (before/after power spectral density comparison).
 *
 * `btype` is `"lowpass" | "highpass" | "bandpass" | "bandstop"` (the
 * `"band"` types shipped in johnhenry/math-plus#90, previously
 * blocked -- see this module's git history for the disclosed-gap era).
 * `designFilter`'s own `cutoffHz` overloads mirror `butter`'s: a single
 * Hz number for lowpass/highpass, a `[low, high]` Hz pair for the band
 * types, both converted to `butter`'s normalized `wn` convention (1 = the
 * Nyquist frequency) via the same `hz / nyquist` division either way.
 */
import { butter, freqz, sosFilter, welch, type FilterType, type Sos } from "mallory-signal";
import { Tensor } from "mallory-tensor-core";
import type { Waveform } from "./signal-waveform.ts";

export type { FilterType, Sos } from "mallory-signal";

function toWn(cutoffHz: number, nyquist: number): number {
  const wn = cutoffHz / nyquist;
  if (!(wn > 0 && wn < 1)) throw new Error(`Cutoff frequency must be strictly between 0 and the Nyquist frequency (${nyquist}Hz).`);
  return wn;
}

/**
 * Designs a digital Butterworth filter given a cutoff in Hz (converted to
 * `butter`'s normalized `wn` convention, where 1 = the Nyquist frequency).
 * `cutoffHz` is a single number for lowpass/highpass, a `[low, high]` pair
 * for bandpass/bandstop -- matching `butter`'s own overloaded `wn` shape
 * one level up (a caller with a statically-known `btype` gets the same
 * compile-time enforcement `butter` itself provides).
 */
export function designFilter(order: number, cutoffHz: number, sampleRate: number, btype: "lowpass" | "highpass"): Sos;
export function designFilter(order: number, cutoffHz: readonly [number, number], sampleRate: number, btype: "bandpass" | "bandstop"): Sos;
export function designFilter(order: number, cutoffHz: number | readonly [number, number], sampleRate: number, btype: FilterType): Sos {
  if (!Number.isInteger(order) || order < 1) throw new Error("Filter order must be a positive integer.");
  const nyquist = sampleRate / 2;
  if (btype === "bandpass" || btype === "bandstop") {
    if (typeof cutoffHz === "number") throw new Error(`${btype} needs two cutoff frequencies (low and high), got one.`);
    const [lowHz, highHz] = cutoffHz;
    if (!(lowHz < highHz)) throw new Error("The low cutoff frequency must be less than the high cutoff frequency.");
    const wn: [number, number] = [toWn(lowHz, nyquist), toWn(highHz, nyquist)];
    return butter(order, wn, { btype });
  }
  if (typeof cutoffHz !== "number") throw new Error(`${btype} needs a single cutoff frequency, got two.`);
  return butter(order, toWn(cutoffHz, nyquist), { btype });
}

/** Applies `sos` to `waveform.y` via `sosFilter`, keeping the same `t`/`sampleRate`. */
export function applyFilter(sos: Sos, waveform: Waveform): Waveform {
  const filteredY = sosFilter(sos, Tensor.from(waveform.y)).toArray() as number[];
  return { t: waveform.t, y: filteredY, sampleRate: waveform.sampleRate };
}

export interface BodePoint {
  frequencyHz: number;
  magnitudeDb: number;
  phaseDeg: number;
}

/**
 * `freqz`'s response over `w` in `[0, pi)` radians/sample, converted to Hz
 * (`w/pi * nyquist`) and to magnitude in dB (`20*log10|H|`, floored at
 * -240dB so a true zero-gain bin doesn't produce `-Infinity`) plus phase
 * in degrees (`ComplexNumber.angle()`, no unwrapping -- v1 shows the
 * wrapped [-180,180] phase as-is).
 */
export function computeBodePlot(sos: Sos, sampleRate: number, worN = 512): BodePoint[] {
  const { frequencies, response } = freqz(sos, { worN });
  const nyquist = sampleRate / 2;
  return frequencies.map((w, i) => {
    const h = response[i]!;
    const magnitude = h.magnitude();
    return {
      frequencyHz: (w / Math.PI) * nyquist,
      magnitudeDb: 20 * Math.log10(Math.max(magnitude, 1e-12)),
      phaseDeg: (h.angle() * 180) / Math.PI,
    };
  });
}

export interface PsdPoint {
  frequencyHz: number;
  power: number;
}

/**
 * One-sided view of `welch`'s two-sided, non-doubled PSD (see that
 * function's own doc comment -- `mallory-signal` deliberately returns the
 * raw two-sided form, unlike SciPy's one-sided-with-doubling default):
 * negative-frequency bins are dropped and the rest scaled from
 * cycles/sample to Hz via `waveform.sampleRate`, WITHOUT doubling, so the
 * displayed power matches exactly what `welch` itself computed for each
 * kept bin (a disclosed, not hidden, convention difference from SciPy).
 */
export function computeWelchPsd(waveform: Waveform, nperseg?: number): PsdPoint[] {
  const { frequencies, psd } = welch(Tensor.from(waveform.y), nperseg !== undefined ? { nperseg } : {});
  const psdArray = psd.toArray() as number[];
  const points: PsdPoint[] = [];
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i]!;
    if (f < 0) continue;
    points.push({ frequencyHz: f * waveform.sampleRate, power: psdArray[i]! });
  }
  return points;
}
