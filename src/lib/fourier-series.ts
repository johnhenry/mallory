/**
 * Classic 2π-periodic square/sawtooth waves and their Fourier partial sums
 * (issue #26's last remaining item) -- pure closed-form finite sums, no
 * `Symbolic` parsing needed for the sum itself (there's no user-entered
 * expression here, just a wave type and a harmonic count) and no
 * `mallory-signal` dependency (this isn't FFT/spectral analysis, just the
 * textbook truncated-series formulas). Increasing `n` visibly demonstrates
 * the Gibbs phenomenon: the partial sum's overshoot near a discontinuity
 * does NOT shrink as n grows, only narrows.
 */
export type FourierWaveType = "square" | "sawtooth";

/** Wraps x into (-π, π], the fundamental period both waves below are defined on. */
function wrapToFundamentalPeriod(x: number): number {
  const wrapped = ((x + Math.PI) % (2 * Math.PI)) - Math.PI;
  return wrapped <= -Math.PI ? wrapped + 2 * Math.PI : wrapped;
}

/** The true (target) square wave: +1 on (0, π), -1 on (-π, 0), 0 at the jump discontinuities (0 and π) -- the midpoint value a Fourier series converges to at a jump. */
export function squareWave(x: number): number {
  const t = wrapToFundamentalPeriod(x);
  if (t === 0 || t === Math.PI || t === -Math.PI) return 0;
  return t > 0 && t < Math.PI ? 1 : -1;
}

/** The true (target) sawtooth wave: linear from -1 to 1 across (-π, π), 0 at the jump discontinuity (±π). */
export function sawtoothWave(x: number): number {
  const t = wrapToFundamentalPeriod(x);
  if (t === Math.PI || t === -Math.PI) return 0;
  return t / Math.PI;
}

/**
 * The degree-n Fourier partial sum for `waveType` at `x`:
 * - square: (4/π) * Σ_{k=1}^{n} sin((2k-1)x) / (2k-1) -- odd harmonics only.
 * - sawtooth: (2/π) * Σ_{k=1}^{n} (-1)^(k+1) * sin(kx) / k -- every harmonic, alternating sign.
 * `n <= 0` returns 0 (the empty sum), matching a genuinely empty partial sum rather than throwing.
 */
export function fourierPartialSum(waveType: FourierWaveType, n: number, x: number): number {
  let sum = 0;
  if (waveType === "square") {
    for (let k = 1; k <= n; k++) {
      const harmonic = 2 * k - 1;
      sum += Math.sin(harmonic * x) / harmonic;
    }
    return (4 / Math.PI) * sum;
  }
  for (let k = 1; k <= n; k++) {
    const sign = k % 2 === 1 ? 1 : -1;
    sum += (sign * Math.sin(k * x)) / k;
  }
  return (2 / Math.PI) * sum;
}

/** Samples both the partial sum and the true wave across `[xMin, xMax]` at `count` evenly-spaced points, for the panel's own plotting. */
export function sampleFourierPartialSum(
  waveType: FourierWaveType,
  n: number,
  xMin: number,
  xMax: number,
  count: number,
): { partial: Array<{ x: number; y: number }>; target: Array<{ x: number; y: number }> } {
  const target = waveType === "square" ? squareWave : sawtoothWave;
  const partial: Array<{ x: number; y: number }> = [];
  const targetPoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const x = xMin + (i / (count - 1)) * (xMax - xMin);
    partial.push({ x, y: fourierPartialSum(waveType, n, x) });
    targetPoints.push({ x, y: target(x) });
  }
  return { partial, target: targetPoints };
}
