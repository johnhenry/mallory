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
import { ComplexTensor, fft2, fftshift } from "mallory-fft";
import { correlate2D } from "mallory-signal";
import { Tensor } from "mallory-tensor-core";
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

/**
 * `|fftshift(fft2(indicator))|^2` -- the periodogram of `tileId`'s
 * indicator field, as a plain `number[][]` (row-major, matching `grid`'s
 * own shape) ready for a canvas heatmap. DC sits at the array's center
 * (that's what `fftshift` buys here).
 */
export function diffractionSpectrum(grid: WangGrid, tileId: string): number[][] {
  const indicator = tileIndicatorField(grid, tileId);
  const height = grid.length;
  const width = height > 0 ? (grid[0] as readonly string[]).length : 0;
  const shifted = fftshift(fft2(ComplexTensor.fromReal(indicator)));
  const spectrum: number[][] = [];
  for (let row = 0; row < height; row++) {
    const line: number[] = [];
    for (let col = 0; col < width; col++) {
      const magnitude = shifted.at(row, col).magnitude();
      line.push(magnitude * magnitude);
    }
    spectrum.push(line);
  }
  return spectrum;
}

/**
 * The "full" 2-D autocorrelation of `tileId`'s indicator field with
 * itself, via `mallory-signal`'s `correlate2D` -- shape
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
