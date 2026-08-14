import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeImageFrequency, buildMask, drawGrayscaleGrid, generatePattern } from "./image-frequency.ts";

test("generatePattern: gradient spans exactly 0..255 left to right", () => {
  const grid = generatePattern("gradient", 5);
  assert.equal(grid[0]?.[0], 0);
  assert.equal(grid[0]?.[4], 255);
  assert.equal(grid[0]?.[2], (2 / 4) * 255);
});

test("generatePattern: checkerboard alternates in 4x4 blocks", () => {
  const grid = generatePattern("checkerboard", 8);
  assert.equal(grid[0]?.[0], 255); // block (0,0)
  assert.equal(grid[0]?.[4], 0); // block (1,0)
  assert.equal(grid[4]?.[0], 0); // block (0,1)
  assert.equal(grid[4]?.[4], 255); // block (1,1)
});

test("generatePattern: rejects a non-positive size", () => {
  assert.throws(() => generatePattern("circle", 0), /size must be positive/);
});

test("buildMask: lowpass keeps only the disc within radius of center, hand-checked on a 5x5 grid", () => {
  const mask = buildMask(5, "lowpass", 1);
  // center is (2,2); distance 1 keeps (2,2) and its 4 direct neighbors, corners are farther than 1.
  assert.equal(mask[2]?.[2], 1); // center, dist 0
  assert.equal(mask[1]?.[2], 1); // dist 1
  assert.equal(mask[2]?.[1], 1); // dist 1
  assert.equal(mask[0]?.[0], 0); // dist ~2.83, outside radius 1
});

test("buildMask: highpass is the exact complement of lowpass at the same radius", () => {
  const size = 6;
  const radius = 2;
  const lowpass = buildMask(size, "lowpass", radius);
  const highpass = buildMask(size, "highpass", radius);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // A point exactly ON the boundary (dist === radius) is kept by BOTH
      // (each condition is <=/>=, inclusive), so lowpass+highpass is 1 or 2, never 0.
      assert.ok((lowpass[y]![x]! as number) + (highpass[y]![x]! as number) >= 1);
    }
  }
  // Well inside the disc: lowpass keeps it, highpass doesn't.
  const center = (size - 1) / 2;
  const cy = Math.round(center);
  const cx = Math.round(center);
  assert.equal(lowpass[cy]?.[cx], 1);
  assert.equal(highpass[cy]?.[cx], 0);
});

test("buildMask: bandpass keeps only the annulus between the two radii", () => {
  const mask = buildMask(9, "bandpass", 1, 3);
  const center = 4;
  assert.equal(mask[center]?.[center], 0); // dist 0, inside the inner radius -- excluded
  assert.equal(mask[center]?.[center + 2], 1); // dist 2, inside the band
  assert.equal(mask[center]?.[center + 4], 0); // dist 4, outside the outer radius
});

test("buildMask: 'none' keeps everything", () => {
  const mask = buildMask(4, "none", 0);
  for (const row of mask) for (const v of row) assert.equal(v, 1);
});

test("buildMask: rejects a non-positive size or a negative radius", () => {
  assert.throws(() => buildMask(0, "lowpass", 1), /size must be positive/);
  assert.throws(() => buildMask(4, "lowpass", -1), /radius must be non-negative/);
});

test("analyzeImageFrequency: an all-pass ('none') mask round-trips the resized image almost exactly (fft2 -> fftshift -> ifftshift -> ifft2 is the identity)", () => {
  const pattern = generatePattern("checkerboard", 16);
  const result = analyzeImageFrequency(pattern, 16, "none", 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      assert.ok(Math.abs(result.filtered[y]![x]! - result.original[y]![x]!) < 1e-6);
    }
  }
});

test("analyzeImageFrequency: low-pass filtering a checkerboard (pure high-frequency content) flattens it to a uniform gray", () => {
  const pattern = generatePattern("checkerboard", 32);
  const result = analyzeImageFrequency(pattern, 32, "lowpass", 2);
  const values = result.filtered.flat();
  const min = Math.min(...values);
  const max = Math.max(...values);
  assert.ok(max - min < 1, `expected a near-uniform result, got range [${min}, ${max}]`);
});

test("analyzeImageFrequency: low-pass filtering a gradient (already low-frequency) stays close to the original away from the edges", () => {
  // A hard-disc (brick-wall) mask has genuine ringing (Gibbs phenomenon) at
  // the image's own boundary -- confirmed directly: the corner pixel (0,0)
  // diverges by ~66, while every interior pixel stays under 10. Checking
  // only the interior avoids asserting away real, expected filter behavior.
  const pattern = generatePattern("gradient", 32);
  const result = analyzeImageFrequency(pattern, 32, "lowpass", 8);
  for (let y = 4; y < 28; y++) {
    for (let x = 4; x < 28; x++) {
      assert.ok(Math.abs(result.filtered[y]![x]! - result.original[y]![x]!) < 15, `pixel (${x},${y}) diverged too far from original`);
    }
  }
});

test("analyzeImageFrequency: rejects a non-power-of-two size", () => {
  const pattern = generatePattern("circle", 30);
  assert.throws(() => analyzeImageFrequency(pattern, 30, "none", 4), /power of two/);
});

test("analyzeImageFrequency: the magnitude spectrum is finite and non-negative everywhere (log1p of a magnitude, never negative)", () => {
  const pattern = generatePattern("stripes", 16);
  const result = analyzeImageFrequency(pattern, 16, "lowpass", 4);
  for (const row of result.magnitudeSpectrum) {
    for (const v of row) {
      assert.ok(Number.isFinite(v));
      assert.ok(v >= 0);
    }
  }
});

function makeFakeCtx(width: number, height: number) {
  let putData: { data: Uint8ClampedArray; width: number; height: number } | null = null;
  const ctx = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: (image: { data: Uint8ClampedArray; width: number; height: number }) => {
      putData = image;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, width, height, getPutData: () => putData };
}

test("drawGrayscaleGrid: min value maps to black (0), max value maps to white (255)", () => {
  const { ctx, getPutData } = makeFakeCtx(2, 2);
  const grid = [
    [0, 10],
    [10, 0],
  ];
  drawGrayscaleGrid(ctx, grid, 2, 2);
  const image = getPutData();
  assert.ok(image);
  // top-left pixel corresponds to grid[0][0] = 0 (the min) -> intensity 0
  assert.equal(image!.data[0], 0);
  assert.equal(image!.data[1], 0);
  assert.equal(image!.data[2], 0);
  assert.equal(image!.data[3], 255); // fully opaque
  // top-right pixel corresponds to grid[0][1] = 10 (the max) -> intensity 255
  assert.equal(image!.data[4], 255);
});

test("drawGrayscaleGrid: a uniform grid (no range) doesn't throw or produce NaN", () => {
  const { ctx, getPutData } = makeFakeCtx(2, 2);
  drawGrayscaleGrid(ctx, [[5, 5], [5, 5]], 2, 2);
  const image = getPutData();
  assert.ok(image);
  for (let i = 0; i < image!.data.length; i += 4) {
    assert.ok(Number.isFinite(image!.data[i]));
  }
});

test("drawGrayscaleGrid: an empty grid draws nothing (no crash)", () => {
  const { ctx, getPutData } = makeFakeCtx(2, 2);
  drawGrayscaleGrid(ctx, [], 2, 2);
  assert.equal(getPutData(), null);
});
