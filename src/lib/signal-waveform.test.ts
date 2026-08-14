import assert from "node:assert/strict";
import { test } from "node:test";
import { amplitudeSpectrum, sampleWaveform } from "./signal-waveform.ts";

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
