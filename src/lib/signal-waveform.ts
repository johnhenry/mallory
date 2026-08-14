import { Symbolic } from "mallory-math";
import { rfft } from "mallory-fft";
import { Tensor } from "mallory-tensor-core";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

export interface Waveform {
  t: number[];
  y: number[];
  sampleRate: number;
}

/** Smallest power of two >= n (mallory-fft's `rfft` requires a power-of-two length; see its own error message). */
function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Samples `exprText` (a real-valued expression in `t`) at `sampleRate` Hz.
 * `requestedDurationSeconds` is a target, not exact: the actual sample
 * count is rounded UP to the next power of two (so `rfft` accepts it
 * without zero-padding -- padding would shift the frequency bins off the
 * signal's true periods and introduce spectral leakage for an otherwise
 * exact-bin sinusoid, which is worse for a teaching tool than a duration
 * that's slightly longer than requested).
 */
export function sampleWaveform(exprText: string, sampleRate: number, requestedDurationSeconds: number): Waveform {
  if (sampleRate <= 0) throw new Error("Sample rate must be positive.");
  if (requestedDurationSeconds <= 0) throw new Error("Duration must be positive.");
  const n = nextPowerOfTwo(Math.max(16, Math.round(sampleRate * requestedDurationSeconds)));
  const compiled = Symbolic.compile(Symbolic.parse(preprocessImplicitMultiplication(exprText)), { declaredVariables: ["t"] });
  const t: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = i / sampleRate;
    t.push(ti);
    y.push(compiled({ t: ti }));
  }
  return { t, y, sampleRate };
}

export interface AmplitudeSpectrum {
  frequencies: number[];
  amplitudes: number[];
}

/**
 * One-sided amplitude spectrum of `waveform` via `mallory-fft`'s `rfft`.
 * `rfft` returns the FULL (conjugate-symmetric) N-point spectrum, not the
 * compact N/2+1 form its name suggests -- confirmed directly against the
 * library before writing this, since a real signal's negative-frequency
 * half is redundant. Only bins `0..N/2` are kept. Converts raw (unnormalized,
 * sum-convention) FFT magnitude to a true amplitude: `magnitude/N` at DC and
 * Nyquist (which have no mirrored twin to fold in), `magnitude*2/N`
 * everywhere else (folding the mirrored negative-frequency bin's energy in) --
 * verified against a known-amplitude test sinusoid before relying on it.
 */
export function amplitudeSpectrum(waveform: Waveform): AmplitudeSpectrum {
  const n = waveform.y.length;
  const spectrum = rfft(Tensor.from(waveform.y)).toComplexArray();
  const nyquistBin = n / 2;
  const frequencies: number[] = [];
  const amplitudes: number[] = [];
  for (let k = 0; k <= nyquistBin; k++) {
    frequencies.push((k * waveform.sampleRate) / n);
    const magnitude = spectrum[k]!.magnitude();
    amplitudes.push(k === 0 || k === nyquistBin ? magnitude / n : (magnitude * 2) / n);
  }
  return { frequencies, amplitudes };
}
