import { convolve1D } from "@johnhenry/math-plus-signal";

export type KernelType = "moving-average" | "gaussian";

function assertOddWidth(width: number): void {
  if (!Number.isInteger(width) || width < 1 || width % 2 === 0) throw new Error("Kernel width must be a positive odd integer.");
}

/** A normalized box kernel of `width` samples (uniform weight `1/width`) -- the simple moving-average kernel. */
export function movingAverageKernel(width: number): Float64Array {
  assertOddWidth(width);
  return new Float64Array(width).fill(1 / width);
}

/**
 * A normalized discrete Gaussian kernel of `width` samples, standard
 * deviation `width/6` (so the kernel spans +-3 sigma) -- narrower, more
 * center-weighted smoothing than a box kernel of the same width, the
 * standard tradeoff between the two.
 */
export function gaussianKernel(width: number): Float64Array {
  assertOddWidth(width);
  const sigma = width / 6;
  const half = (width - 1) / 2;
  const raw = new Float64Array(width);
  let sum = 0;
  for (let i = 0; i < width; i++) {
    const x = i - half;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    raw[i] = v;
    sum += v;
  }
  for (let i = 0; i < width; i++) raw[i]! /= sum;
  return raw;
}

export function buildKernel(kernelType: KernelType, width: number): Float64Array {
  return kernelType === "moving-average" ? movingAverageKernel(width) : gaussianKernel(width);
}

export interface SmoothedSeries {
  /** Indices into the ORIGINAL data array that `values` correspond to (one-to-one, same length). */
  indices: number[];
  values: number[];
}

/**
 * Smooths `data` via `@johnhenry/math-plus-signal`'s `convolve1D` in "same" mode, then
 * TRIMS the boundary region "same" mode pads against zero (the first/last
 * `floor(kernel.length/2)` points) rather than showing it -- a same-mode
 * boundary sample there is a genuine average against zero-padding, not
 * against real neighboring data, and silently plotting it as if it were a
 * real smoothed value would misrepresent the data (see the issue's own
 * "edge handling matters for trust" note).
 */
export function smoothSeries(data: readonly number[], kernel: Float64Array): SmoothedSeries {
  if (data.length === 0) throw new Error("No data to smooth.");
  if (kernel.length > data.length) throw new Error(`Kernel width (${kernel.length}) can't exceed the data length (${data.length}).`);
  const smoothed = convolve1D(Float64Array.from(data), kernel, "same");
  const half = Math.floor(kernel.length / 2);
  const indices: number[] = [];
  const values: number[] = [];
  for (let i = half; i < smoothed.length - half; i++) {
    indices.push(i);
    values.push(smoothed[i]!);
  }
  return { indices, values };
}

/** Raw minus smoothed, aligned to `smoothed.indices` (i.e. also excludes the trimmed boundary). */
export function residualSeries(data: readonly number[], smoothed: SmoothedSeries): number[] {
  return smoothed.indices.map((idx, i) => data[idx]! - smoothed.values[i]!);
}
