import { Tensor } from "mallory-tensor-core";
import { normalize, resize } from "mallory-image";
import { ComplexTensor, fft2, fftshift, ifft2, ifftshift } from "mallory-fft";

export type PatternType = "checkerboard" | "stripes" | "circle" | "gradient";

/**
 * Generates a `size x size` grayscale (0-255) test pattern -- the "or pick a
 * built-in pattern" alternative to file upload (issue #32's item 1; file
 * upload itself is deferred, see this module's own doc comment for why).
 */
export function generatePattern(type: PatternType, size: number): number[][] {
  if (size <= 0) throw new Error(`size must be positive -- got ${size}.`);
  const center = (size - 1) / 2;
  const grid: number[][] = [];
  for (let y = 0; y < size; y++) {
    const row: number[] = [];
    for (let x = 0; x < size; x++) {
      let value: number;
      switch (type) {
        case "checkerboard":
          value = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 255 : 0;
          break;
        case "stripes":
          value = Math.sin((2 * Math.PI * x) / 8) >= 0 ? 255 : 0;
          break;
        case "circle":
          value = Math.hypot(x - center, y - center) <= size / 4 ? 255 : 0;
          break;
        case "gradient":
          value = size > 1 ? (x / (size - 1)) * 255 : 0;
          break;
      }
      row.push(value);
    }
    grid.push(row);
  }
  return grid;
}

export type MaskType = "lowpass" | "highpass" | "bandpass" | "none";

/**
 * Builds a `size x size` binary mask (1 = keep, 0 = zero out) centered on the
 * (fftshift'd) spectrum's own DC position -- a disc for `lowpass`, its
 * complement (a ring extending to the corners) for `highpass`, an annulus
 * for `bandpass`, or all-ones for `none` (a round-trip sanity check: masking
 * with `none` and inverting should exactly reconstruct the input).
 */
export function buildMask(size: number, type: MaskType, radius: number, radius2?: number): number[][] {
  if (size <= 0) throw new Error(`size must be positive -- got ${size}.`);
  if (radius < 0) throw new Error(`radius must be non-negative -- got ${radius}.`);
  const outerRadius = radius2 ?? radius + 4;
  const center = (size - 1) / 2;
  const mask: number[][] = [];
  for (let y = 0; y < size; y++) {
    const row: number[] = [];
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - center, y - center);
      let keep: boolean;
      switch (type) {
        case "lowpass":
          keep = dist <= radius;
          break;
        case "highpass":
          keep = dist >= radius;
          break;
        case "bandpass":
          keep = dist >= radius && dist <= outerRadius;
          break;
        case "none":
          keep = true;
          break;
      }
      row.push(keep ? 1 : 0);
    }
    mask.push(row);
  }
  return mask;
}

function grid2DToTensor(grid: readonly (readonly number[])[], dtype?: "f32" | "f64"): Tensor {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const flat: number[] = [];
  for (const row of grid) for (const v of row) flat.push(v);
  return Tensor.from(flat, dtype ? { dtype } : undefined).reshape([height, width]);
}

export interface FrequencyResult {
  /** The resized/grayscale input, in its original 0-255 intensity range, `size x size`. */
  original: number[][];
  /** log1p-scaled magnitude of the fftshift'd spectrum -- log scaling because the DC/near-DC bins otherwise dwarf everything else on a linear scale. */
  magnitudeSpectrum: number[][];
  /** The masked spectrum inverted back to the image domain, de-normalized to the same 0-255-ish range as `original`. */
  filtered: number[][];
}

/**
 * The full pipeline (issue #32, items 1-4): resize to `size x size` (a
 * power of two -- `fft2` requires it) via `mallory-image`'s `resize`,
 * per-image z-score `normalize` (mean/std computed from the resized pixels
 * themselves, then passed to `normalize`'s `(x-mean)/std` -- there's no
 * "auto" mode, the caller always supplies mean/std), `fft2` + `fftshift` for
 * the centered magnitude spectrum, a parametric mask, then `ifftshift` +
 * `ifft2` back to the image domain.
 *
 * `pixels` is already single-channel grayscale (0-255) -- this module
 * doesn't do RGB-to-grayscale conversion itself since the only producers
 * wired up in this v1 (`generatePattern`'s built-in patterns) are already
 * grayscale; that conversion is real but small, deferred alongside file
 * upload (see the module doc comment).
 */
export function analyzeImageFrequency(
  pixels: readonly (readonly number[])[],
  size: number,
  maskType: MaskType,
  radius: number,
  radius2?: number,
): FrequencyResult {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  if (height === 0 || width === 0) throw new Error("Image must be non-empty.");
  if (size <= 0 || (size & (size - 1)) !== 0) throw new Error(`size must be a positive power of two -- got ${size}.`);

  const raw = grid2DToTensor(pixels).reshape([height, width, 1]);
  const resized = resize(raw, { height: size, width: size });

  const flatPixels: number[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) flatPixels.push(resized.at(y, x, 0) as number);
  const mean = flatPixels.reduce((a, b) => a + b, 0) / flatPixels.length;
  const variance = flatPixels.reduce((a, b) => a + (b - mean) ** 2, 0) / flatPixels.length;
  const std = Math.sqrt(variance) || 1;
  const normed = normalize(resized, { mean: [mean], std: [std] }).squeeze(2);

  const spectrum = fft2(ComplexTensor.fromReal(normed));
  const shifted = fftshift(spectrum);

  const magnitudeSpectrum: number[][] = [];
  for (let y = 0; y < size; y++) {
    const row: number[] = [];
    for (let x = 0; x < size; x++) row.push(Math.log1p(shifted.at(y, x).magnitude()));
    magnitudeSpectrum.push(row);
  }

  const mask = buildMask(size, maskType, radius, radius2);
  const maskTensor = grid2DToTensor(mask, "f64"); // f64 to match fft2/fftshift's own output dtype -- Tensor has no implicit promotion (confirmed directly: mismatched dtypes throw on mul()).
  const maskedReal = shifted.real.mul(maskTensor);
  const maskedImag = shifted.imag.mul(maskTensor);
  const filteredComplex = ifft2(ifftshift(ComplexTensor.fromParts(maskedReal, maskedImag)));

  const filtered: number[][] = [];
  const original: number[][] = [];
  for (let y = 0; y < size; y++) {
    const filteredRow: number[] = [];
    const originalRow: number[] = [];
    for (let x = 0; x < size; x++) {
      filteredRow.push(filteredComplex.at(y, x).value * std + mean);
      originalRow.push(resized.at(y, x, 0) as number);
    }
    filtered.push(filteredRow);
    original.push(originalRow);
  }

  return { original, magnitudeSpectrum, filtered };
}

/**
 * Renders a 2D numeric grid as a grayscale raster, min/max-normalized to
 * the full 0-255 range and nearest-neighbor-scaled to `canvasWidth x
 * canvasHeight` -- the same `ImageData`-per-pixel approach as
 * `complex-raster.ts`'s `renderDomainColoring`, since a per-pixel value
 * (not a vector shape) doesn't fit the `render-path.ts` Path2D drawers.
 */
export function drawGrayscaleGrid(ctx: CanvasRenderingContext2D, grid: readonly (readonly number[])[], canvasWidth: number, canvasHeight: number): void {
  const gridSize = grid.length;
  if (gridSize === 0) return;
  let min = Infinity;
  let max = -Infinity;
  for (const row of grid) {
    for (const v of row) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const range = max - min || 1;
  const image = ctx.createImageData(canvasWidth, canvasHeight);
  for (let py = 0; py < canvasHeight; py++) {
    const gy = Math.min(gridSize - 1, Math.floor((py / canvasHeight) * gridSize));
    const row = grid[gy] ?? [];
    for (let px = 0; px < canvasWidth; px++) {
      const gx = Math.min(row.length - 1, Math.floor((px / canvasWidth) * row.length));
      const intensity = Math.max(0, Math.min(255, Math.round(((row[gx]! - min) / range) * 255)));
      const idx = (py * canvasWidth + px) * 4;
      image.data[idx] = intensity;
      image.data[idx + 1] = intensity;
      image.data[idx + 2] = intensity;
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
