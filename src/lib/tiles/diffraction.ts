/**
 * Diffraction spectrum + autocorrelation surface for a solved tiling
 * (issue #92 M3, the part that "works today" on the square lattice per the
 * issue's own framing -- doesn't need the hex/tri lattice generalization).
 *
 * Per issue #92's own math: for a tile-indicator field (1 where a chosen
 * tile id sits, 0 elsewhere), `|FFT|^2` of a finite patch is a
 * periodogram -- a finite-volume approximation of the diffraction measure
 * (the Fourier transform of the autocorrelation, in the sense of
 * mathematical diffraction theory -- Baake-Grimm). Sharp Bragg-like peaks
 * in the spectrum signal the pure-point component. The autocorrelation
 * surface (via `correlate2D`) is the primal object -- in diffraction
 * theory the diffraction measure *is* its Fourier transform, so the
 * spectrum and the autocorrelation surface are two pictures of one
 * underlying measure.
 */
import { ComplexTensor, fft2, fftshift } from "@johnhenry/math-plus-fft";
import { correlate2D } from "@johnhenry/math-plus-signal";
import { Tensor } from "@johnhenry/math-plus-tensor-core";
import type { WangGrid } from "./tile-model.ts";

/** `1` at every cell of `grid` whose tile id equals `tileId`, `0` elsewhere. */
export function tileIndicatorField(grid: WangGrid, tileId: string): Tensor {
  const height = grid.length;
  const width = height > 0 ? (grid[0] as readonly string[]).length : 0;
  const data: number[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      data.push(grid[row]![col] === tileId ? 1 : 0);
    }
  }
  return Tensor.from(data, { dtype: "f64" }).reshape([height, width]);
}

/** Smallest power of two >= n (n >= 0; nextPow2(0) is 1, same convention as an empty/1-cell field). */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * `|fftshift(fft2(indicator))|^2` -- the periodogram of `tileId`'s
 * indicator field, as a plain `number[][]` ready for a canvas heatmap. DC
 * sits at the array's center (that's what `fftshift` buys here).
 *
 * `fft2` requires a power-of-two length on BOTH axes (@johnhenry/math-plus-fft's own doc
 * comment: "no 2-D padded variant yet"), but a Wang tile grid's width/height
 * are arbitrary user-chosen values (this panel's own default is a
 * non-power-of-two 4x3) -- calling it on the raw indicator field throws a
 * `RangeError` for any non-power-of-two dimension, which crashed the panel
 * on first load. This zero-pads up to the next power of two per axis before
 * transforming, the same "pad before FFT" technique `@johnhenry/math-plus-signal`'s own
 * `correlate2D` already relies on for the identical reason (see its source
 * comment). Unlike `correlate2D` -- which crops its real-space OUTPUT back
 * down to a meaningful shape after the inverse transform -- there's no
 * analogous crop here: the periodogram stays in frequency space the whole
 * time, so the padded-resolution spectrum (returned at its own, possibly
 * larger-than-`grid`, shape) IS the meaningful result -- standard
 * zero-padding-for-resolution FFT practice, not a windowed subset of one.
 */
export function diffractionSpectrum(grid: WangGrid, tileId: string): number[][] {
  const indicator = tileIndicatorField(grid, tileId);
  const [height, width] = indicator.shape as [number, number];
  const paddedHeight = nextPow2(height);
  const paddedWidth = nextPow2(width);
  const padded =
    paddedHeight === height && paddedWidth === width
      ? indicator
      : indicator.pad([
          [0, paddedHeight - height],
          [0, paddedWidth - width],
        ]);
  const shifted = fftshift(fft2(ComplexTensor.fromReal(padded)));
  const spectrum: number[][] = [];
  for (let row = 0; row < paddedHeight; row++) {
    const line: number[] = [];
    for (let col = 0; col < paddedWidth; col++) {
      const magnitude = shifted.at(row, col).magnitude();
      line.push(magnitude * magnitude);
    }
    spectrum.push(line);
  }
  return spectrum;
}

/**
 * The "full" 2-D autocorrelation of `tileId`'s indicator field with
 * itself, via `@johnhenry/math-plus-signal`'s `correlate2D` -- shape
 * `[2*height-1, 2*width-1]`, zero-lag (the field matched against an
 * unshifted copy of itself) at the center. The primal counterpart to
 * {@link diffractionSpectrum} -- same underlying measure, real-space vs.
 * frequency-space.
 */
export function autocorrelationSurface(grid: WangGrid, tileId: string): number[][] {
  const indicator = tileIndicatorField(grid, tileId);
  const correlated = correlate2D(indicator, indicator);
  const [outHeight, outWidth] = correlated.shape as [number, number];
  const surface: number[][] = [];
  for (let row = 0; row < outHeight; row++) {
    const line: number[] = [];
    for (let col = 0; col < outWidth; col++) {
      line.push(correlated.at(row, col) as number);
    }
    surface.push(line);
  }
  return surface;
}

/** Every distinct tile id present in a solved `grid`, sorted -- the candidate list for a "which tile's diffraction pattern" selector. */
export function tileIdsPresent(grid: WangGrid): string[] {
  const ids = new Set<string>();
  for (const row of grid) {
    for (const id of row) {
      ids.add(id);
    }
  }
  return [...ids].sort();
}
