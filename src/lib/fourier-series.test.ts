import assert from "node:assert/strict";
import { test } from "node:test";
import { fourierPartialSum, sampleFourierPartialSum, sawtoothWave, squareWave } from "./fourier-series.ts";

test("squareWave: +1 strictly inside (0, pi), -1 strictly inside (-pi, 0), 0 exactly at the jump discontinuities", () => {
  assert.equal(squareWave(Math.PI / 2), 1);
  assert.equal(squareWave(-Math.PI / 2), -1);
  assert.equal(squareWave(0), 0);
  assert.equal(squareWave(Math.PI), 0);
  assert.equal(squareWave(-Math.PI), 0);
});

test("squareWave: periodic with period 2*pi", () => {
  assert.equal(squareWave(Math.PI / 2), squareWave(Math.PI / 2 + 2 * Math.PI));
  assert.equal(squareWave(-Math.PI / 2), squareWave(-Math.PI / 2 - 2 * Math.PI));
});

test("sawtoothWave: linear ramp x/pi across (-pi, pi), 0 at the jump discontinuity", () => {
  assert.equal(sawtoothWave(Math.PI / 2), 0.5);
  assert.ok(Math.abs(sawtoothWave(Math.PI / 3) - 1 / 3) < 1e-12);
  assert.equal(sawtoothWave(Math.PI), 0);
  assert.equal(sawtoothWave(-Math.PI), 0);
});

test("fourierPartialSum: n<=0 is the empty sum, 0 everywhere", () => {
  assert.equal(fourierPartialSum("square", 0, Math.PI / 2), 0);
  assert.equal(fourierPartialSum("sawtooth", -3, 1.234), 0);
});

test("fourierPartialSum: square wave hand-computed values -- (4/pi) sin(x) for n=1, plus the third-harmonic term for n=2", () => {
  const s1 = fourierPartialSum("square", 1, Math.PI / 2);
  assert.ok(Math.abs(s1 - 4 / Math.PI) < 1e-12);
  // s_2(pi/2) = (4/pi)[sin(pi/2)/1 + sin(3*pi/2)/3] = (4/pi)(1 - 1/3) = 8/(3*pi)
  const s2 = fourierPartialSum("square", 2, Math.PI / 2);
  assert.ok(Math.abs(s2 - 8 / (3 * Math.PI)) < 1e-12);
});

test("fourierPartialSum: sawtooth wave hand-computed values at two different points and harmonic counts", () => {
  // s_1(pi/2) = (2/pi) sin(pi/2) = 2/pi
  const s1AtHalfPi = fourierPartialSum("sawtooth", 1, Math.PI / 2);
  assert.ok(Math.abs(s1AtHalfPi - 2 / Math.PI) < 1e-12);
  // s_1(pi/3) = (2/pi) sin(pi/3) = (2/pi)(sqrt(3)/2) = sqrt(3)/pi
  const s1AtThirdPi = fourierPartialSum("sawtooth", 1, Math.PI / 3);
  assert.ok(Math.abs(s1AtThirdPi - Math.sqrt(3) / Math.PI) < 1e-12);
  // s_2(pi/3) = (2/pi)[sin(pi/3)/1 - sin(2*pi/3)/2] = (2/pi)(sqrt(3)/2 - sqrt(3)/4) = sqrt(3)/(2*pi)
  const s2AtThirdPi = fourierPartialSum("sawtooth", 2, Math.PI / 3);
  assert.ok(Math.abs(s2AtThirdPi - Math.sqrt(3) / (2 * Math.PI)) < 1e-12);
});

test("fourierPartialSum: a high-n square-wave partial sum is much closer to the target wave mid-interval than a low-n one (visible convergence away from the jump)", () => {
  const x = Math.PI / 2; // far from both discontinuities (0 and pi)
  const target = squareWave(x);
  const errorLowN = Math.abs(fourierPartialSum("square", 1, x) - target);
  const errorHighN = Math.abs(fourierPartialSum("square", 50, x) - target);
  assert.ok(errorHighN < errorLowN);
  assert.ok(errorHighN < 0.05);
});

test("sampleFourierPartialSum: returns count points each for partial and target, spanning exactly [xMin, xMax]", () => {
  const { partial, target } = sampleFourierPartialSum("square", 3, -1, 1, 5);
  assert.equal(partial.length, 5);
  assert.equal(target.length, 5);
  assert.equal(partial[0]?.x, -1);
  assert.equal(partial[4]?.x, 1);
  assert.equal(target[0]?.x, -1);
  assert.equal(target[4]?.x, 1);
  // Cross-check against the standalone functions at the same x.
  assert.equal(partial[2]?.y, fourierPartialSum("square", 3, partial[2]!.x));
  assert.equal(target[2]?.y, squareWave(target[2]!.x));
});
