import assert from "node:assert/strict";
import { test } from "node:test";
import { crossCorrelate } from "./signal-correlation.ts";
import type { Waveform } from "./signal-waveform.ts";

function waveform(y: number[], sampleRate: number): Waveform {
  return { t: y.map((_, i) => i / sampleRate), y, sampleRate };
}

test("crossCorrelate: a right-shifted (delayed) b peaks at a POSITIVE lag, hand-computed", () => {
  const a = waveform([0, 0, 1, 2, 3, 0, 0, 0], 1);
  const b = waveform([0, 0, 0, 0, 1, 2, 3, 0], 1); // b's [1,2,3] arrives 2 samples later than a's
  const result = crossCorrelate(a, b);
  assert.equal(result.peakLagSeconds, 2);
  assert.equal(result.peakValue, 14); // 1*1 + 2*2 + 3*3 = 14, the exact dot product at perfect alignment
  assert.equal(result.lags.length, a.y.length + b.y.length - 1);
});

test("crossCorrelate: a left-shifted (leading) b peaks at a NEGATIVE lag -- the mirror of the delayed case above", () => {
  const a = waveform([0, 0, 0, 0, 1, 2, 3, 0], 1);
  const b = waveform([0, 0, 1, 2, 3, 0, 0, 0], 1); // b's [1,2,3] arrives 2 samples EARLIER than a's
  const result = crossCorrelate(a, b);
  assert.equal(result.peakLagSeconds, -2);
  assert.equal(result.peakValue, 14);
});

test("crossCorrelate: identical signals peak at exactly lag 0", () => {
  const a = waveform([0, 1, 2, 3, 2, 1, 0, 0], 1);
  const result = crossCorrelate(a, a);
  assert.equal(result.peakLagSeconds, 0);
  assert.equal(result.peakValue, 19); // 1+4+9+4+1 = 19, the signal's own energy
});

test("crossCorrelate: lag is scaled by sampleRate, not just sample count", () => {
  const a = waveform([0, 0, 1, 2, 3, 0, 0, 0], 4);
  const b = waveform([0, 0, 0, 0, 1, 2, 3, 0], 4);
  const result = crossCorrelate(a, b);
  assert.equal(result.peakLagSeconds, 0.5); // 2 samples / 4 Hz = 0.5s
});

test("crossCorrelate: rejects signals sampled at different rates (lags in seconds would be meaningless)", () => {
  const a = waveform([0, 1, 0], 4);
  const b = waveform([0, 1, 0], 8);
  assert.throws(() => crossCorrelate(a, b), /same sample rate/);
});

test("crossCorrelate: rejects an empty signal", () => {
  const a = waveform([], 4);
  const b = waveform([0, 1, 0], 4);
  assert.throws(() => crossCorrelate(a, b), /non-empty/);
});
