import assert from "node:assert/strict";
import { test } from "node:test";
import { heatCellColor } from "./heatmap.ts";
import { amplitudeSpectrum, computeSpectrogram, drawSpectrogram, findSpectrumPeaks, sampleWaveform } from "./signal-waveform.ts";

test("sampleWaveform: samples a constant expression correctly", () => {
  const w = sampleWaveform("5", 10, 1);
  assert.ok(w.y.every((y) => y === 5));
});

test("sampleWaveform: samples a sine at t=0,1/4 period", () => {
  const w = sampleWaveform("sin(2*pi*4*t)", 16, 1); // freq 4Hz, sampleRate 16Hz -> n=16
  assert.ok(Math.abs(w.y[0]! - 0) < 1e-9); // sin(0) = 0
  assert.ok(Math.abs(w.t[0]! - 0) < 1e-9);
  assert.equal(w.t.length, 16);
});

test("sampleWaveform: sample count is rounded up to a power of two", () => {
  const w = sampleWaveform("t", 100, 1); // requests 100 samples -> rounds to 128
  assert.equal(w.y.length, 128);
});

test("sampleWaveform: sample count already a power of two is left unchanged", () => {
  const w = sampleWaveform("t", 64, 1);
  assert.equal(w.y.length, 64);
});

test("sampleWaveform: rejects a non-positive sample rate or duration", () => {
  assert.throws(() => sampleWaveform("t", 0, 1), /Sample rate must be positive/);
  assert.throws(() => sampleWaveform("t", 10, -1), /Duration must be positive/);
});

test("amplitudeSpectrum: recovers a DC offset and a known sinusoid's amplitude and frequency", () => {
  const w = sampleWaveform("2 + 3*sin(2*pi*5*t)", 64, 1); // n=64, exact-bin freq=5Hz
  const spec = amplitudeSpectrum(w);
  const dcIndex = spec.frequencies.findIndex((f) => f === 0);
  const peakIndex = spec.frequencies.findIndex((f) => Math.abs(f - 5) < 1e-9);
  assert.ok(Math.abs(spec.amplitudes[dcIndex]! - 2) < 1e-6, `DC amplitude: ${spec.amplitudes[dcIndex]}`);
  assert.ok(Math.abs(spec.amplitudes[peakIndex]! - 3) < 1e-6, `5Hz amplitude: ${spec.amplitudes[peakIndex]}`);
  // every other bin should be near-zero for a pure exact-bin sinusoid + DC.
  spec.amplitudes.forEach((amp, i) => {
    if (i === dcIndex || i === peakIndex) return;
    assert.ok(amp < 1e-6, `bin ${i} (${spec.frequencies[i]}Hz) should be ~0, got ${amp}`);
  });
});

test("amplitudeSpectrum: frequency bins run from 0 to the Nyquist frequency (sampleRate/2)", () => {
  const w = sampleWaveform("sin(2*pi*3*t)", 32, 1);
  const spec = amplitudeSpectrum(w);
  assert.equal(spec.frequencies[0], 0);
  assert.equal(spec.frequencies[spec.frequencies.length - 1], 16); // Nyquist = 32/2
  assert.equal(spec.frequencies.length, 17); // bins 0..16 inclusive
});

test("computeSpectrogram: shape matches stft's own [numFrames, nperseg] convention (hop = nperseg - noverlap)", () => {
  const w = sampleWaveform("sin(2*pi*20*t)", 256, 8); // n = 2048
  const spec = computeSpectrogram(w, 128, 64);
  // floor((2048-128)/64)+1 = 31
  assert.equal(spec.frameTimes.length, 31);
  assert.equal(spec.frequencies.length, 65); // 0..nperseg/2 inclusive
  assert.equal(spec.frequencies[0], 0);
  assert.equal(spec.frequencies[spec.frequencies.length - 1], 128); // Nyquist = sampleRate/2
});

test("computeSpectrogram: frame start times step by exactly (nperseg-noverlap)/sampleRate, hand-computed for the first three frames", () => {
  const w = sampleWaveform("sin(2*pi*20*t)", 256, 8);
  const spec = computeSpectrogram(w, 128, 64); // hop = 64 samples = 0.25s at 256Hz
  assert.equal(spec.frameTimes[0], 0);
  assert.equal(spec.frameTimes[1], 0.25);
  assert.equal(spec.frameTimes[2], 0.5);
});

test("computeSpectrogram: a pure 20Hz tone's peak frequency bin at a mid frame is exactly 20Hz", () => {
  const w = sampleWaveform("sin(2*pi*20*t)", 256, 8);
  const spec = computeSpectrogram(w, 128, 64);
  const midFrame = spec.magnitudes[Math.floor(spec.magnitudes.length / 2)]!;
  let peakIndex = 0;
  midFrame.forEach((amp, i) => {
    if (amp > midFrame[peakIndex]!) peakIndex = i;
  });
  assert.equal(spec.frequencies[peakIndex], 20);
});

test("computeSpectrogram: window-gain calibration restores a unit-amplitude tone's measured peak to ~1.0 (not ~0.5, the raw Hann-attenuated value)", () => {
  const w = sampleWaveform("sin(2*pi*20*t)", 256, 8);
  const spec = computeSpectrogram(w, 128, 64);
  const midFrame = spec.magnitudes[Math.floor(spec.magnitudes.length / 2)]!;
  const peak = Math.max(...midFrame);
  assert.ok(Math.abs(peak - 1) < 1e-6, `expected ~1, got ${peak}`);
});

test("computeSpectrogram: rejects a non-power-of-two nperseg and an out-of-range noverlap", () => {
  const w = sampleWaveform("sin(2*pi*5*t)", 64, 1);
  assert.throws(() => computeSpectrogram(w, 100, 10), /power of two/);
  assert.throws(() => computeSpectrogram(w, 32, 32), /noverlap must be in/);
  assert.throws(() => computeSpectrogram(w, 32, -1), /noverlap must be in/);
});

function makeFakeCtx() {
  const fillRectCalls: Array<{ fillStyle: string; x: number; y: number; w: number; h: number }> = [];
  let currentFillStyle = "";
  let translateX = 0;
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: (x: number) => {
      translateX = x;
    },
    set fillStyle(v: string) {
      currentFillStyle = v;
    },
    get fillStyle() {
      return currentFillStyle;
    },
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRectCalls.push({ fillStyle: currentFillStyle, x: x + translateX, y, w, h });
    },
    fillText: () => {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, getFillRectCalls: () => fillRectCalls };
}

test("drawSpectrogram: fills one rect per (frame, bin) cell, colored by the shared heatCellColor scale", () => {
  const { ctx, getFillRectCalls } = makeFakeCtx();
  const spectrogram = {
    frameTimes: [0, 1],
    frequencies: [0, 10],
    magnitudes: [
      [0, 1],
      [1, 0],
    ],
  };
  drawSpectrogram(ctx, spectrogram, 100, 100, 0);
  const calls = getFillRectCalls();
  assert.equal(calls.length, 4); // 2 frames x 2 bins
});

test("drawSpectrogram: low frequency bins draw at the bottom of the canvas, high frequency at the top (standard spectrogram orientation)", () => {
  const { ctx, getFillRectCalls } = makeFakeCtx();
  // Distinct per-bin magnitudes so each call's fillStyle identifies which
  // bin it came from -- not just "3 calls at 3 y-positions" (that alone
  // can't distinguish a correct flip from an inverted one).
  const spectrogram = {
    frameTimes: [0],
    frequencies: [0, 10, 20], // bin 0 = lowest freq, bin 2 = highest freq
    magnitudes: [[0, 0.5, 1]],
  };
  drawSpectrogram(ctx, spectrogram, 90, 90, 0);
  const calls = getFillRectCalls();
  assert.equal(calls.length, 3);
  const bottomCall = calls.reduce((max, c) => (c.y > max.y ? c : max));
  const topCall = calls.reduce((min, c) => (c.y < min.y ? c : min));
  assert.equal(bottomCall.fillStyle, heatCellColor(0, 0, 1)); // bin 0 (lowest freq) at the bottom
  assert.equal(topCall.fillStyle, heatCellColor(1, 0, 1)); // bin 2 (highest freq) at the top
});

test("drawSpectrogram: an empty spectrogram draws nothing (no crash)", () => {
  const { ctx, getFillRectCalls } = makeFakeCtx();
  drawSpectrogram(ctx, { frameTimes: [], frequencies: [], magnitudes: [] }, 100, 100, 0);
  assert.equal(getFillRectCalls().length, 0);
});

test("findSpectrumPeaks: finds the 3 local-maxima peaks in a hand-built amplitude array, matching mallory-signal's findPeaks output directly", () => {
  const spectrum = { frequencies: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], amplitudes: [0, 1, 3, 1, 0, 0, 5, 2, 0, 4, 4, 0] };
  const peaks = findSpectrumPeaks(spectrum);
  assert.deepEqual(
    peaks.map((p) => p.frequency),
    [2, 6, 9],
  );
  assert.deepEqual(
    peaks.map((p) => p.amplitude),
    [3, 5, 4],
  );
});

test("findSpectrumPeaks: minAmplitude filters out peaks below the threshold", () => {
  const spectrum = { frequencies: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], amplitudes: [0, 1, 3, 1, 0, 0, 5, 2, 0, 4, 4, 0] };
  const peaks = findSpectrumPeaks(spectrum, { minAmplitude: 4 });
  assert.deepEqual(
    peaks.map((p) => p.frequency),
    [6, 9],
  );
});

test("findSpectrumPeaks: minSpacingHz converts to a bin-count distance using the spectrum's own bin spacing (2Hz/bin here, deliberately not 1Hz so a Hz<->bin-count mixup is distinguishable)", () => {
  const spectrum = { frequencies: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], amplitudes: [0, 1, 3, 1, 0, 0, 5, 2, 0, 4, 4, 0] };
  const peaks = findSpectrumPeaks(spectrum, { minSpacingHz: 8 });
  // 8Hz / 2Hz-per-bin = 4-bin distance required. The shorter peak (index 9, freq 18Hz, height 4)
  // loses to its taller neighbor (index 6, freq 12Hz, height 5) since they're only 3 bins apart.
  assert.deepEqual(
    peaks.map((p) => p.frequency),
    [4, 12],
  );
});

test("findSpectrumPeaks: an amplitude array with no local maxima returns no peaks", () => {
  const spectrum = { frequencies: [0, 1, 2, 3], amplitudes: [0, 1, 2, 3] }; // monotonically increasing, no interior peak
  assert.deepEqual(findSpectrumPeaks(spectrum), []);
});

test("findSpectrumPeaks: zero-amplitude bins are never peaks, even with no thresholds at all (#313)", () => {
  // A flat-zero spectrum with two real tones -- raw findPeaks with default
  // (all-undefined) options used to report zero bins as peaks.
  const spectrum = {
    frequencies: [0, 1, 2, 3, 4, 5, 6],
    amplitudes: [0, 0, 1, 0, 0.5, 0, 0],
  };
  const peaks = findSpectrumPeaks(spectrum);
  assert.ok(peaks.length >= 1);
  for (const p of peaks) assert.ok(p.amplitude > 0, `zero-amplitude bin at ${p.frequency}Hz reported as a peak`);
});
