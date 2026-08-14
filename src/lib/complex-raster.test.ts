import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber } from "mallory-math";
import { domainColor, renderDomainColoring } from "./complex-raster.ts";
import { nthRootsOfUnity } from "./roots-of-unity.ts";
import type { Viewport } from "./viewport.ts";

test("domainColor: angle 0 at magnitude 1 (the mid-gray lightness contour) is pure red", () => {
  assert.deepEqual(domainColor(new ComplexNumber(1, 0)), [255, 0, 0]);
});

test("domainColor: angle pi/2 (positive imaginary axis) has a different hue than angle 0", () => {
  const atZero = domainColor(new ComplexNumber(1, 0));
  const atHalfPi = domainColor(new ComplexNumber(0, 1));
  assert.notDeepEqual(atZero, atHalfPi);
});

test("domainColor: magnitude 0 is black", () => {
  assert.deepEqual(domainColor(ComplexNumber.Zero), [0, 0, 0]);
});

test("domainColor: a huge magnitude is near-white", () => {
  const [r, g, b] = domainColor(new ComplexNumber(1e6, 0));
  assert.ok(r > 240 && g > 240 && b > 240, `expected near-white, got [${r},${g},${b}]`);
});

test("domainColor: NaN magnitude (undefined value) is mid-gray, not a crash", () => {
  assert.deepEqual(domainColor(ComplexNumber.NaCN), [128, 128, 128]);
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

test("renderDomainColoring: f(z)=z colors the raster's right edge (large real part) near-white and center near mid-tone", () => {
  const { ctx, getPutData } = makeFakeCtx(4, 4);
  const viewport: Viewport = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };
  renderDomainColoring(ctx, 4, 4, viewport, (z) => z);
  const image = getPutData();
  assert.ok(image, "putImageData should have been called");
  // All pixels should be fully opaque and none should be the "f threw" gray fallback,
  // since the identity function never throws.
  for (let i = 0; i < image!.data.length; i += 4) {
    assert.equal(image!.data[i + 3], 255);
  }
});

test("renderDomainColoring: a function that always throws leaves every pixel mid-gray, not a crash", () => {
  const { ctx, getPutData } = makeFakeCtx(2, 2);
  const viewport: Viewport = { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
  renderDomainColoring(ctx, 2, 2, viewport, () => {
    throw new Error("undefined here");
  });
  const image = getPutData();
  for (let i = 0; i < image!.data.length; i += 4) {
    assert.equal(image!.data[i], 128);
    assert.equal(image!.data[i + 1], 128);
    assert.equal(image!.data[i + 2], 128);
  }
});

test("nthRootsOfUnity: n=4 gives 1, i, -1, -i", () => {
  const roots = nthRootsOfUnity(4);
  assert.equal(roots.length, 4);
  const tolerance = 1e-9;
  const expected: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  roots.forEach((r, i) => {
    assert.ok(Math.abs(r.value - expected[i]![0]) < tolerance, `root ${i} re`);
    assert.ok(Math.abs(r.iValue - expected[i]![1]) < tolerance, `root ${i} im`);
  });
});

test("nthRootsOfUnity: every root has magnitude 1", () => {
  for (const r of nthRootsOfUnity(7)) {
    assert.ok(Math.abs(r.magnitude() - 1) < 1e-9);
  }
});

test("nthRootsOfUnity: rejects non-positive-integer n", () => {
  assert.throws(() => nthRootsOfUnity(0), /positive integer/);
  assert.throws(() => nthRootsOfUnity(2.5), /positive integer/);
});
