import { Symbolic } from "mallory-math";
import { rfft } from "mallory-fft";
import { findPeaks, hannWindow, stft } from "mallory-signal";
import { Tensor } from "mallory-tensor-core";
import { finiteRange, heatCellColor } from "./heatmap.ts";
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

export interface SpectrumPeak {
  frequency: number;
  amplitude: number;
  prominence: number;
}

export interface FindSpectrumPeaksOptions {
  /** Minimum peak amplitude. */
  minAmplitude?: number;
  /** Minimum required spacing between peaks, in Hz (converted to a bin-count `distance` internally -- mallory-signal's own `findPeaks` works in sample/bin units, not Hz). */
  minSpacingHz?: number;
  /** Minimum required topographic prominence, in the same amplitude units as `minAmplitude`. */
  minProminence?: number;
}

/**
 * Local-maxima peaks of a spectrum via `mallory-signal`'s `findPeaks`
 * (issue #31's "findPeaks on the spectrum" extra) -- confirmed directly
 * against the real installed package before writing this: a signal with
 * two clear local maxima and one that's part of a flat plateau reports
 * exactly the plateau's first (earlier) index, matching its own
 * scipy-`find_peaks`-parity doc comment.
 *
 * `minSpacingHz` converts to `findPeaks`' own `distance` option (a sample
 * count) using the spectrum's own bin spacing (`frequencies[1] -
 * frequencies[0]`) -- a spectrum always has at least 2 bins (DC + Nyquist),
 * so this division is safe by construction.
 */
export function findSpectrumPeaks(spectrum: AmplitudeSpectrum, options: FindSpectrumPeaksOptions = {}): SpectrumPeak[] {
  const binSpacingHz = (spectrum.frequencies[1] ?? 1) - (spectrum.frequencies[0] ?? 0);
  const result = findPeaks(Tensor.from(spectrum.amplitudes), {
    height: options.minAmplitude,
    distance: options.minSpacingHz !== undefined && binSpacingHz > 0 ? Math.max(1, Math.round(options.minSpacingHz / binSpacingHz)) : undefined,
    prominence: options.minProminence,
  });
  return (
    result.indices
      .map((index, i) => ({
        frequency: spectrum.frequencies[index]!,
        amplitude: result.heights[i]!,
        prominence: result.prominences[i]!,
      }))
      // A zero-amplitude bin is never a meaningful peak regardless of what
      // the caller's thresholds say (issue #313): with all-zero options the
      // raw findPeaks happily reports flat noise-floor bins ("1.00Hz --
      // amplitude 0.000") alongside real tones.
      .filter((p) => p.amplitude > 0)
  );
}

export interface Spectrogram {
  /** Start time of each frame, in seconds. */
  frameTimes: number[];
  /** One-sided frequency bins, in Hz. */
  frequencies: number[];
  /** `[frame][bin]` amplitude -- same magnitude/N or 2*magnitude/N conversion as amplitudeSpectrum, applied per-frame. */
  magnitudes: number[][];
}

/**
 * A time-varying spectrum via `mallory-signal`'s windowed `stft`: `spec.shape`
 * is `[numFrames, nperseg]` (confirmed directly, not assumed, against the
 * library) with `nperseg - noverlap` as the hop size between frame starts
 * (also confirmed: a 2048-sample signal at nperseg=64/noverlap=32 produces
 * exactly `floor((2048-64)/32)+1` frames). Only bins `0..nperseg/2` are kept,
 * the same one-sided convention as `amplitudeSpectrum` (a real signal's
 * negative-frequency half is redundant).
 *
 * `stft` windows each frame (`window * signal`, default Hann -- confirmed by
 * reading its source, not assumed) before transforming, which attenuates the
 * raw magnitude/N conversion `amplitudeSpectrum` uses: a Hann-windowed pure
 * tone read back out at only ~half its true amplitude (confirmed directly: a
 * unit-amplitude sinusoid measured 0.4999... before this fix). The fix
 * divides by the window's own coherent gain (`mean(window)` -- exactly 0.5
 * for a Hann window, recomputed here from the real `hannWindow(nperseg)`
 * array rather than hardcoded, so it stays correct if a caller ever supplies
 * a different window in a future revision) -- confirmed to restore the
 * measured amplitude to ~1.0 for the same test tone.
 *
 * `nperseg` must be a power of two (mallory-signal's own `stft` requirement,
 * inherited from `mallory-fft`'s per-frame FFT).
 */
export function computeSpectrogram(waveform: Waveform, nperseg: number, noverlap: number): Spectrogram {
  if (nperseg <= 0 || (nperseg & (nperseg - 1)) !== 0) throw new Error(`nperseg must be a positive power of two -- got ${nperseg}.`);
  if (noverlap < 0 || noverlap >= nperseg) throw new Error(`noverlap must be in [0, nperseg) -- got ${noverlap} with nperseg=${nperseg}.`);
  const spec = stft(Tensor.from(waveform.y), { nperseg, noverlap });
  const [numFrames, frameLength] = spec.shape;
  const hopSize = nperseg - noverlap;
  const nyquistBin = frameLength / 2;
  const window = hannWindow(nperseg);
  const coherentGain = window.reduce((sum, w) => sum + w, 0) / nperseg;

  const frequencies: number[] = [];
  for (let k = 0; k <= nyquistBin; k++) frequencies.push((k * waveform.sampleRate) / frameLength);

  const frameTimes: number[] = [];
  const magnitudes: number[][] = [];
  for (let f = 0; f < numFrames; f++) {
    frameTimes.push((f * hopSize) / waveform.sampleRate);
    const row: number[] = [];
    for (let k = 0; k <= nyquistBin; k++) {
      const magnitude = spec.at(f, k).magnitude();
      const raw = k === 0 || k === nyquistBin ? magnitude / frameLength : (magnitude * 2) / frameLength;
      row.push(raw / coherentGain);
    }
    magnitudes.push(row);
  }
  return { frameTimes, frequencies, magnitudes };
}

/**
 * Draws a spectrogram heatmap: time along x (left-to-right), frequency
 * along y (low-to-high, bottom-to-top -- the standard spectrogram
 * orientation, so a rising pitch reads as a rising line). Reuses
 * heatmap.ts's `heatCellColor`/`finiteRange` color-mapping (the part of
 * `drawHeatmap` that genuinely generalizes), but not `drawHeatmap` itself --
 * that function assumes a square matrix with one discrete text label per
 * row/column index (an adjacency matrix's vertex names), which doesn't fit
 * a spectrogram's rectangular frame-count x bin-count grid with continuous
 * time/frequency axes better served by a handful of tick labels than one
 * label per cell (there can be dozens of frames and bins).
 */
export function drawSpectrogram(ctx: CanvasRenderingContext2D, spectrogram: Spectrogram, width: number, height: number, labelGutter = 34): void {
  const { frameTimes, frequencies, magnitudes } = spectrogram;
  const numFrames = frameTimes.length;
  const numBins = frequencies.length;
  if (numFrames === 0 || numBins === 0) return;
  const { min, max } = finiteRange(magnitudes);
  const gridWidth = width - labelGutter;
  const gridHeight = height - labelGutter;
  const cellW = gridWidth / numFrames;
  const cellH = gridHeight / numBins;

  ctx.save();
  ctx.translate(labelGutter, 0);
  for (let f = 0; f < numFrames; f++) {
    const column = magnitudes[f] ?? [];
    for (let k = 0; k < numBins; k++) {
      const value = column[k] ?? 0;
      const rowFromBottom = numBins - 1 - k;
      ctx.fillStyle = heatCellColor(value, min, max);
      ctx.fillRect(f * cellW, rowFromBottom * cellH, cellW, cellH);
    }
  }
  ctx.restore();

  const TICK_COUNT = 5;
  ctx.save();
  ctx.fillStyle = "#374151";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < TICK_COUNT; i++) {
    const frac = i / (TICK_COUNT - 1);
    const time = frameTimes[Math.min(numFrames - 1, Math.round(frac * (numFrames - 1)))]!;
    ctx.fillText(`${time.toFixed(2)}s`, labelGutter + frac * gridWidth, gridHeight + 2);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i < TICK_COUNT; i++) {
    const frac = i / (TICK_COUNT - 1);
    const freq = frequencies[Math.min(numBins - 1, Math.round(frac * (numBins - 1)))]!;
    ctx.fillText(`${freq.toFixed(0)}Hz`, labelGutter - 4, (1 - frac) * gridHeight);
  }
  ctx.restore();
}
