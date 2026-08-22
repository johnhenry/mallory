import { correlate1D } from "@johnhenry/math-plus-signal";
import type { Waveform } from "./signal-waveform.ts";

export interface CorrelationResult {
  /** One lag value per correlation sample, in seconds. Positive means `b` lags `a` (arrives later); negative means `b` leads `a`. */
  lags: number[];
  values: number[];
  /** The lag (seconds) at the correlation's maximum -- the best-fit alignment between the two signals. */
  peakLagSeconds: number;
  peakValue: number;
}

/**
 * Cross-correlation lag-finder between two signals (issue #31's "extras"
 * item, wrapping `mallory-signal`'s `correlate1D`): full-mode correlation,
 * converted to a lag axis in seconds and the best-fit alignment lag
 * extracted as the correlation's maximum.
 *
 * `correlate1D(a, b, "full")` reverses `b` and convolves it with `a`
 * (confirmed directly by reading the installed package's source), which
 * makes sample index `i` in the length-`a.length+b.length-1` result
 * correspond to lag `(b.length - 1 - i) / sampleRate` -- verified
 * empirically against constructed shifted-copy test signals before writing
 * this: a right-shifted (delayed) `b` peaks at a POSITIVE lag, a
 * left-shifted (leading) `b` peaks at a NEGATIVE lag, and identical signals
 * peak at lag 0.
 */
export function crossCorrelate(a: Waveform, b: Waveform): CorrelationResult {
  if (a.sampleRate !== b.sampleRate) throw new Error("Both signals must share the same sample rate to compare lags in seconds.");
  if (a.y.length === 0 || b.y.length === 0) throw new Error("Both signals must be non-empty.");

  const values = Array.from(correlate1D(Float64Array.from(a.y), Float64Array.from(b.y), "full"));
  const lags: number[] = [];
  for (let i = 0; i < values.length; i++) lags.push((b.y.length - 1 - i) / a.sampleRate);

  let peakIndex = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > values[peakIndex]!) peakIndex = i;
  }

  return { lags, values, peakLagSeconds: lags[peakIndex]!, peakValue: values[peakIndex]! };
}
