import { Distributions, GraphUtils, Vector, type ContinuousDistribution, type DiscreteDistribution, type Path2D } from "mallory-math";
import { Rng } from "mallory-tensor-core";

const DENSITY_COLOR = 0xdc2626; // distinct from the histogram bars' blue

export interface DartPoint {
  x: number;
  y: number;
  inside: boolean;
}

export interface PiConvergencePoint {
  n: number;
  estimate: number;
}

export interface DartPiResult {
  piEstimate: number;
  n: number;
  /** Capped at MAX_RENDERED_DARTS for canvas rendering -- the estimate itself uses every one of the n throws, not just the rendered subset. */
  points: DartPoint[];
  /** Running estimate at ~100 checkpoints across the run, for a convergence trend chart. */
  convergence: PiConvergencePoint[];
}

const MAX_RENDERED_DARTS = 3000;
const CONVERGENCE_CHECKPOINTS = 100;

/**
 * Classic dart-throwing Monte Carlo estimate of pi: throw darts uniformly at
 * a 2x2 square, the fraction landing inside the inscribed unit circle
 * approaches (circle area)/(square area) = pi/4. Uses `rng` (a tensor-core
 * `Rng`, PCG32) rather than `Math.random()` so the exact same seed always
 * reproduces the exact same estimate -- the whole point of "seeded +
 * reproducible" for this panel.
 */
export function estimateDartPi(n: number, rng: Rng): DartPiResult {
  let insideCount = 0;
  const points: DartPoint[] = [];
  const renderEvery = Math.max(1, Math.floor(n / MAX_RENDERED_DARTS));
  const convergenceEvery = Math.max(1, Math.floor(n / CONVERGENCE_CHECKPOINTS));
  const convergence: PiConvergencePoint[] = [];

  for (let i = 0; i < n; i++) {
    const x = rng.nextFloat() * 2 - 1;
    const y = rng.nextFloat() * 2 - 1;
    const inside = x * x + y * y <= 1;
    if (inside) insideCount++;
    if (i % renderEvery === 0) points.push({ x, y, inside });
    if ((i + 1) % convergenceEvery === 0) convergence.push({ n: i + 1, estimate: (insideCount / (i + 1)) * 4 });
  }

  return { piEstimate: n > 0 ? (insideCount / n) * 4 : Number.NaN, n, points, convergence };
}

export type MonteCarloDistType = "normal" | "uniform" | "exponential" | "binomial" | "poisson";

export interface DistributionParams {
  mean?: number;
  sd?: number;
  a?: number;
  b?: number;
  rate?: number;
  n?: number;
  p?: number;
  lambda?: number;
}

/** Builds a mallory-math distribution instance from this panel's param shape, seeded via `rng.nextFloat` (Distributions' own rng hook is a plain `() => number`, not the Rng class itself). */
function buildDistribution(distType: MonteCarloDistType, params: DistributionParams, rng: Rng): ContinuousDistribution | DiscreteDistribution {
  const rngFn = () => rng.nextFloat();
  switch (distType) {
    case "normal":
      return Distributions.normal(params.mean ?? 0, params.sd ?? 1, rngFn);
    case "uniform":
      return Distributions.uniform(params.a ?? 0, params.b ?? 1, rngFn);
    case "exponential":
      return Distributions.exponential(params.rate ?? 1, rngFn);
    case "binomial":
      return Distributions.binomial(params.n ?? 10, params.p ?? 0.5, rngFn);
    case "poisson":
      return Distributions.poisson(params.lambda ?? 4, rngFn);
  }
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
}

export interface DistributionSampleResult {
  bins: HistogramBin[];
  sampleMean: number;
  sampleVariance: number;
  theoreticalMean: number;
  theoreticalVariance: number;
  /** The theoretical density/mass at each bin's midpoint, as a ready-to-draw curve. */
  densityPath: Path2D;
}

/**
 * Draws `n` samples from the chosen distribution (seeded) and bins them into
 * a histogram, alongside the theoretical mean/variance (`dist.mean()`/
 * `.variance()`, exact -- not re-derived from the sample) and a density
 * curve sampled at each bin's midpoint for a live pdf/pmf overlay.
 */
export function sampleDistributionHistogram(
  distType: MonteCarloDistType,
  params: DistributionParams,
  n: number,
  rng: Rng,
  binCount = 20,
): DistributionSampleResult {
  const dist = buildDistribution(distType, params, rng);
  const isDiscrete = distType === "binomial" || distType === "poisson";
  const samples: number[] = [];
  for (let i = 0; i < n; i++) samples.push(dist.sample());

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const width = (max - min) / binCount || 1;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count: 0 }));
  for (const s of samples) {
    let idx = width > 0 ? Math.floor((s - min) / width) : 0;
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    (bins[idx] as HistogramBin).count++;
  }

  const sampleMean = samples.reduce((a, b) => a + b, 0) / n;
  const sampleVariance = samples.reduce((a, b) => a + (b - sampleMean) ** 2, 0) / n;

  const densityPoints = bins.map((bin) => {
    const mid = (bin.x0 + bin.x1) / 2;
    const x = isDiscrete ? Math.round(mid) : mid;
    const y = isDiscrete ? (dist as DiscreteDistribution).pmf(x) : (dist as ContinuousDistribution).pdf(x);
    return Vector.fromArray([mid, y]);
  });
  const densityPath = GraphUtils.vectorToCurve(Vector.fromArray(densityPoints), 2, DENSITY_COLOR);

  return {
    bins,
    sampleMean,
    sampleVariance,
    theoreticalMean: dist.mean(),
    theoreticalVariance: dist.variance(),
    densityPath,
  };
}

export { Rng };
