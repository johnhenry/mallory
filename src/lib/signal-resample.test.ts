import assert from "node:assert/strict";
import { test } from "node:test";
import { resampleWaveform } from "./signal-resample.ts";
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

test("resampleWaveform: up=1,down=1 is an exact identity -- same values, same sample rate", () => {
  const original: Waveform = { t: [0, 1, 2, 3], y: [0, 1, 2, 3], sampleRate: 1 };
  const result = resampleWaveform(original, 1, 1);
  assert.deepEqual(result.y, [0, 1, 2, 3]);
  assert.equal(result.sampleRate, 1);
});

test("resampleWaveform: up=2,down=1 doubles the sample rate and produces exactly 2n samples, hand-computed against a 1Hz sine at 16Hz", () => {
  const waveform = sineWaveform(16, 16, 1);
  const result = resampleWaveform(waveform, 2, 1);
  assert.equal(result.sampleRate, 32);
  assert.equal(result.y.length, 32);
  // Hand-verified against the real installed mallory-signal package before writing this test.
  const expected = [0, 0.161, 0.383, 0.574, 0.708, 0.824, 0.925, 0.989];
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(result.y[i]! - expected[i]!) < 5e-3, `index ${i}: got ${result.y[i]}, expected ~${expected[i]}`);
  }
});

test("resampleWaveform: up=1,down=2 halves the sample rate and produces exactly ceil(n/2) samples", () => {
  const waveform = sineWaveform(16, 16, 1);
  const result = resampleWaveform(waveform, 1, 2);
  assert.equal(result.sampleRate, 8);
  assert.equal(result.y.length, 8);
});

test("resampleWaveform: t is regenerated from the new sample rate, not reused from the original", () => {
  const waveform = sineWaveform(16, 16, 1);
  const result = resampleWaveform(waveform, 2, 1);
  assert.equal(result.t[0], 0);
  assert.ok(Math.abs(result.t[1]! - 1 / 32) < 1e-12);
  assert.ok(Math.abs(result.t[result.t.length - 1]! - (result.y.length - 1) / 32) < 1e-12);
});

test("resampleWaveform: rejects a non-positive-integer up or down", () => {
  const waveform = sineWaveform(4, 4, 1);
  assert.throws(() => resampleWaveform(waveform, 0, 1), /up must be a positive integer/);
  assert.throws(() => resampleWaveform(waveform, 1.5, 1), /up must be a positive integer/);
  assert.throws(() => resampleWaveform(waveform, 1, 0), /down must be a positive integer/);
});

test("resampleWaveform: rejects an empty waveform", () => {
  assert.throws(() => resampleWaveform({ t: [], y: [], sampleRate: 8 }, 1, 1), /non-empty/);
});
