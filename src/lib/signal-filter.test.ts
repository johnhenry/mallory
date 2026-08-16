import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFilter, computeBodePlot, computeWelchPsd, designFilter } from "./signal-filter.ts";
import type { Waveform } from "./signal-waveform.ts";

function sineWaveform(n: number, sampleRate: number, hz: number): Waveform {
  const t: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    t.push(i / sampleRate);
    y.push(Math.sin((2 * Math.PI * hz * i) / sampleRate));
  }
  return { t, y, sampleRate };
}

function rms(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
}

test("designFilter: rejects a non-positive-integer order", () => {
  assert.throws(() => designFilter(0, 10, 100, "lowpass"), /order must be a positive integer/);
  assert.throws(() => designFilter(2.5, 10, 100, "lowpass"), /order must be a positive integer/);
});

test("designFilter: rejects a cutoff outside (0, Nyquist)", () => {
  assert.throws(() => designFilter(4, 0, 100, "lowpass"), /Cutoff frequency must be strictly between/);
  assert.throws(() => designFilter(4, 50, 100, "lowpass"), /Cutoff frequency must be strictly between/); // Nyquist itself
  assert.throws(() => designFilter(4, 60, 100, "lowpass"), /Cutoff frequency must be strictly between/); // above Nyquist
});

test("designFilter: bandpass/bandstop reject a single-number cutoff (need a [low, high] pair)", () => {
  // @ts-expect-error -- deliberately calling the wrong overload to check the runtime guard.
  assert.throws(() => designFilter(4, 15, 100, "bandpass"), /needs two cutoff frequencies/);
  // @ts-expect-error
  assert.throws(() => designFilter(4, 15, 100, "bandstop"), /needs two cutoff frequencies/);
});

test("designFilter: lowpass/highpass reject a [low, high] pair (need a single number)", () => {
  // @ts-expect-error -- deliberately calling the wrong overload to check the runtime guard.
  assert.throws(() => designFilter(4, [10, 20], 100, "lowpass"), /needs a single cutoff frequency/);
});

test("designFilter: bandpass rejects a low cutoff that isn't strictly less than the high cutoff", () => {
  assert.throws(() => designFilter(4, [20, 10], 100, "bandpass"), /low cutoff frequency must be less than/);
  assert.throws(() => designFilter(4, [15, 15], 100, "bandpass"), /low cutoff frequency must be less than/);
});

test("applyFilter: a bandpass filter keeps a mid-band tone, removes both a low and a high tone from a three-tone mix", () => {
  const sr = 100;
  const n = 512;
  const t: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = i / sr;
    t.push(ti);
    y.push(Math.sin(2 * Math.PI * 2 * ti) + Math.sin(2 * Math.PI * 20 * ti) + Math.sin(2 * Math.PI * 45 * ti));
  }
  const mixed: Waveform = { t, y, sampleRate: sr };
  const sos = designFilter(4, [10, 30], sr, "bandpass");
  const filtered = applyFilter(sos, mixed);
  assert.equal(filtered.y.length, mixed.y.length);
  const outputRms = rms(filtered.y.slice(200));
  // Three independent unit-amplitude tones would mix to rms ~= sqrt(3)*0.7071 ~= 1.2247;
  // keeping only the mid tone should land back near a single tone's own 0.7071.
  assert.ok(outputRms > 0.6 && outputRms < 0.8, `expected filtered rms near the single 20Hz tone's 0.7071, got ${outputRms}`);
});

test("applyFilter: a bandstop filter (mirror-image cutoffs) removes the mid-band tone, keeps the low and high tones", () => {
  const sr = 100;
  const n = 512;
  const t: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = i / sr;
    t.push(ti);
    y.push(Math.sin(2 * Math.PI * 2 * ti) + Math.sin(2 * Math.PI * 20 * ti) + Math.sin(2 * Math.PI * 45 * ti));
  }
  const mixed: Waveform = { t, y, sampleRate: sr };
  const sos = designFilter(4, [10, 30], sr, "bandstop");
  const filtered = applyFilter(sos, mixed);
  const outputRms = rms(filtered.y.slice(200));
  // Removing the mid tone leaves the low+high pair: rms ~= sqrt(2)*0.7071 ~= 1.
  assert.ok(outputRms > 0.9 && outputRms < 1.1, `expected filtered rms near the two-tone (low+high) ~1.0, got ${outputRms}`);
});

test("computeBodePlot: order-4 lowpass at cutoffHz=15,sampleRate=100 matches hand-verified freqz magnitudes at worN=4", () => {
  // Hand-verified directly against the real installed mallory-signal package
  // before writing this test: butter(4, 0.3, {btype:"lowpass"}) then
  // freqz(sos, {worN:4}) gives |H| = [1, 0.9164092636663478, 0.06724798762935112, 0.001984083415535018]
  // at w = [0, pi/4, pi/2, 3pi/4]. cutoffHz=15 on sampleRate=100 (Nyquist=50) -> wn=0.3.
  const sos = designFilter(4, 15, 100, "lowpass");
  const bode = computeBodePlot(sos, 100, 4);
  assert.equal(bode.length, 4);
  const expectedMagnitude = [1, 0.9164092636663478, 0.06724798762935112, 0.001984083415535018];
  const expectedFreqHz = [0, 12.5, 25, 37.5]; // w/pi * nyquist(50)
  for (let i = 0; i < 4; i++) {
    const point = bode[i]!;
    assert.ok(Math.abs(point.frequencyHz - expectedFreqHz[i]!) < 1e-9, `freq #${i}: got ${point.frequencyHz}`);
    const magnitude = 10 ** (point.magnitudeDb / 20);
    assert.ok(Math.abs(magnitude - expectedMagnitude[i]!) < 1e-9, `magnitude #${i}: got ${magnitude}, expected ${expectedMagnitude[i]}`);
  }
  // DC gain is real and positive for a lowpass Butterworth -> phase 0 at w=0.
  assert.ok(Math.abs(bode[0]!.phaseDeg) < 1e-6, `expected ~0deg phase at DC, got ${bode[0]!.phaseDeg}`);
});

test("computeBodePlot: order-4 highpass has ~0 gain at DC and ~unity gain near Nyquist (opposite of lowpass)", () => {
  // Hand-verified: butter(4, 0.3, {btype:"highpass"}) -> |H| = [0, 0.400..., 0.998..., 0.99999...] at the same 4 bins.
  const sos = designFilter(4, 15, 100, "highpass");
  const bode = computeBodePlot(sos, 100, 4);
  const magnitude0 = 10 ** (bode[0]!.magnitudeDb / 20);
  const magnitude3 = 10 ** (bode[3]!.magnitudeDb / 20);
  assert.ok(magnitude0 < 1e-5, `expected ~0 gain at DC for highpass, got ${magnitude0}`);
  assert.ok(magnitude3 > 0.999, `expected ~unity gain near Nyquist for highpass, got ${magnitude3}`);
});

test("applyFilter: a lowpass filter attenuates a high-frequency tone far more than a low-frequency one in a two-tone mix", () => {
  const sr = 100;
  const n = 256;
  const t: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = i / sr;
    t.push(ti);
    y.push(Math.sin(2 * Math.PI * 2 * ti) + Math.sin(2 * Math.PI * 40 * ti));
  }
  const mixed: Waveform = { t, y, sampleRate: sr };
  const sos = designFilter(4, 15, sr, "lowpass");
  const filtered = applyFilter(sos, mixed);
  assert.equal(filtered.y.length, mixed.y.length);
  assert.equal(filtered.sampleRate, mixed.sampleRate);
  // Skip the filter's transient (first 100 samples) -- RMS of a single
  // unit-amplitude sine is 1/sqrt(2) ~= 0.7071; RMS of the unfiltered
  // two-tone mix should be close to sqrt(2)*0.7071 ~= 1 (independent tones).
  const inputRms = rms(mixed.y.slice(100));
  const outputRms = rms(filtered.y.slice(100));
  assert.ok(inputRms > 0.9, `sanity: two-tone input rms should be near 1, got ${inputRms}`);
  assert.ok(outputRms < 0.75 && outputRms > 0.65, `expected filtered rms near the single 2Hz tone's 0.7071, got ${outputRms}`);
});

test("applyFilter: a highpass filter (mirror-image cutoff) keeps the high tone and removes the low tone", () => {
  const sr = 100;
  const n = 256;
  const t: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = i / sr;
    t.push(ti);
    y.push(Math.sin(2 * Math.PI * 2 * ti) + Math.sin(2 * Math.PI * 40 * ti));
  }
  const mixed: Waveform = { t, y, sampleRate: sr };
  const sos = designFilter(4, 15, sr, "highpass");
  const filtered = applyFilter(sos, mixed);
  const outputRms = rms(filtered.y.slice(100));
  assert.ok(outputRms > 0.65 && outputRms < 0.75, `expected filtered rms near the single 40Hz tone's 0.7071, got ${outputRms}`);
});

test("computeWelchPsd: an 8Hz tone at 64Hz sample rate produces its PSD peak at exactly 8Hz, and only non-negative frequencies are returned", () => {
  // Hand-verified: welch(Tensor.from(y), {nperseg:64}) on a pure 8Hz/64Hz
  // tone gives its peak at cycles/sample=0.125 (-> 8Hz) with power ~10.6667.
  const waveform = sineWaveform(256, 64, 8);
  const psd = computeWelchPsd(waveform, 64);
  assert.equal(psd.length, 32); // nperseg/2 non-negative bins out of 64 total
  assert.ok(psd.every((p) => p.frequencyHz >= 0));
  let peak = psd[0]!;
  for (const p of psd) if (p.power > peak.power) peak = p;
  assert.ok(Math.abs(peak.frequencyHz - 8) < 1e-9, `expected peak at 8Hz, got ${peak.frequencyHz}`);
  assert.ok(Math.abs(peak.power - 10.666666484114446) < 1e-6, `expected power ~10.6667, got ${peak.power}`);
});
