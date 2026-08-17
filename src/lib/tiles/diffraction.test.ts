import assert from "node:assert/strict";
import { test } from "node:test";
import { autocorrelationSurface, diffractionSpectrum, tileIdsPresent, tileIndicatorField } from "./diffraction.ts";
import type { WangGrid } from "./tile-model.ts";

// A B
// B A
const GRID: WangGrid = [
  ["A", "B"],
  ["B", "A"],
];

test("tileIndicatorField: hand-computed 1 where the tile id matches, 0 elsewhere", () => {
  const indicator = tileIndicatorField(GRID, "A");
  assert.deepEqual(
    [
      [indicator.at(0, 0), indicator.at(0, 1)],
      [indicator.at(1, 0), indicator.at(1, 1)],
    ],
    [
      [1, 0],
      [0, 1],
    ],
  );
});

test("tileIndicatorField: an id absent from the grid produces an all-zero field", () => {
  const indicator = tileIndicatorField(GRID, "C");
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) assert.equal(indicator.at(row, col), 0);
});

test("tileIdsPresent: every distinct id, sorted", () => {
  assert.deepEqual(tileIdsPresent(GRID), ["A", "B"]);
});

test("tileIdsPresent: a single-tile grid reports one id", () => {
  const single: WangGrid = [["Z"]];
  assert.deepEqual(tileIdsPresent(single), ["Z"]);
});

test("diffractionSpectrum: the DC bin (post-fftshift center, index [1,1] for a 2x2 field) equals (sum of the indicator field)^2", () => {
  // "A" appears at (0,0) and (1,1) -- indicator sum = 2 -- DC bin = 2^2 = 4.
  const spectrumA = diffractionSpectrum(GRID, "A");
  assert.ok(Math.abs((spectrumA[1] as number[])[1]! - 4) < 1e-9, `got ${(spectrumA[1] as number[])[1]}`);

  // "B" also appears twice -- same DC value, different (non-DC) bins.
  const spectrumB = diffractionSpectrum(GRID, "B");
  assert.ok(Math.abs((spectrumB[1] as number[])[1]! - 4) < 1e-9, `got ${(spectrumB[1] as number[])[1]}`);
});

test("diffractionSpectrum: an id absent from the grid has DC = 0 (empty indicator field)", () => {
  const spectrum = diffractionSpectrum(GRID, "C");
  assert.ok(Math.abs((spectrum[1] as number[])[1]!) < 1e-9);
});

test("autocorrelationSurface: shape is [2*height-1, 2*width-1]", () => {
  const surface = autocorrelationSurface(GRID, "A");
  assert.equal(surface.length, 3);
  assert.equal(surface[0]!.length, 3);
});

test("autocorrelationSurface: the zero-lag (center) value equals the count of matching cells, hand-computed", () => {
  // "A" occupies 2 of the 4 cells -- zero-lag autocorrelation of a 0/1
  // field with itself is exactly the count of 1s (sum of x_i * x_i).
  const surface = autocorrelationSurface(GRID, "A");
  assert.ok(Math.abs(surface[1]![1]! - 2) < 1e-9, `got ${surface[1]![1]}`);
});

test("autocorrelationSurface: an id absent from the grid has zero-lag value 0", () => {
  const surface = autocorrelationSurface(GRID, "C");
  assert.ok(Math.abs(surface[1]![1]!) < 1e-9);
});
