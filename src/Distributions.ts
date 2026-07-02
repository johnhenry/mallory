import { SpecialFunctions as SF } from "./SpecialFunctions.ts";

/**
 * Distributions — common probability distributions (continuous and discrete),
 * each exposing `pdf`/`pmf`, `cdf`, `mean`, `variance` and a random `sample`,
 * plus a small suite of {@link HypothesisTests}. CDFs use the exact incomplete
 * gamma/beta functions from {@link SpecialFunctions} rather than numeric
 * integration, so they are accurate in the tails.
 *
 * Every factory takes an optional trailing `rng: () => number` (default
 * `Math.random`), threaded through to every nested distribution it samples
 * from — pass a seeded generator to make `sample()` deterministic in tests.
 */

export interface ContinuousDistribution {
  pdf(x: number): number;
  cdf(x: number): number;
  mean(): number;
  variance(): number;
  sample(): number;
}

export interface DiscreteDistribution {
  pmf(k: number): number;
  cdf(k: number): number;
  mean(): number;
  variance(): number;
  sample(): number;
}

/** The inverse standard-normal CDF (Acklam's rational approximation). */
function normInv(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

export class Distributions {
  /** The inverse standard-normal CDF (quantile / probit function). */
  static normalQuantile(p: number, mean = 0, sd = 1): number {
    return mean + sd * normInv(p);
  }

  static normal(mean = 0, sd = 1, rng: () => number = Math.random): ContinuousDistribution {
    return {
      pdf: (x) => Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI)),
      cdf: (x) => 0.5 * SF.erfc(-(x - mean) / (sd * Math.SQRT2)),
      mean: () => mean,
      variance: () => sd * sd,
      sample: () => mean + sd * Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()),
    };
  }

  static exponential(rate = 1, rng: () => number = Math.random): ContinuousDistribution {
    return {
      pdf: (x) => (x < 0 ? 0 : rate * Math.exp(-rate * x)),
      cdf: (x) => (x < 0 ? 0 : 1 - Math.exp(-rate * x)),
      mean: () => 1 / rate,
      variance: () => 1 / (rate * rate),
      sample: () => -Math.log(1 - rng()) / rate,
    };
  }

  static uniform(a = 0, b = 1, rng: () => number = Math.random): ContinuousDistribution {
    return {
      pdf: (x) => (x >= a && x <= b ? 1 / (b - a) : 0),
      cdf: (x) => (x < a ? 0 : x > b ? 1 : (x - a) / (b - a)),
      mean: () => (a + b) / 2,
      variance: () => (b - a) ** 2 / 12,
      sample: () => a + rng() * (b - a),
    };
  }

  static gamma(shape: number, scale = 1, rng: () => number = Math.random): ContinuousDistribution {
    return {
      pdf: (x) => (x <= 0 ? 0 : (x ** (shape - 1) * Math.exp(-x / scale)) / (SF.gamma(shape) * scale ** shape)),
      cdf: (x) => (x <= 0 ? 0 : SF.regularizedGammaP(shape, x / scale)),
      mean: () => shape * scale,
      variance: () => shape * scale * scale,
      sample: () => Distributions.sampleGamma(shape, rng) * scale,
    };
  }

  static chiSquare(df: number, rng: () => number = Math.random): ContinuousDistribution {
    const g = Distributions.gamma(df / 2, 2, rng);
    return { ...g, mean: () => df, variance: () => 2 * df };
  }

  static studentT(df: number, rng: () => number = Math.random): ContinuousDistribution {
    const c = SF.gamma((df + 1) / 2) / (Math.sqrt(df * Math.PI) * SF.gamma(df / 2));
    return {
      pdf: (x) => c * (1 + (x * x) / df) ** (-(df + 1) / 2),
      cdf: (x) => {
        const ib = SF.regularizedIncompleteBeta(df / (df + x * x), df / 2, 0.5);
        return x >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
      },
      mean: () => (df > 1 ? 0 : Number.NaN),
      variance: () => (df > 2 ? df / (df - 2) : Number.POSITIVE_INFINITY),
      sample: () => {
        const z = Distributions.normal(0, 1, rng).sample();
        const chi = Distributions.chiSquare(df, rng).sample();
        return z / Math.sqrt(chi / df);
      },
    };
  }

  static binomial(n: number, p: number, rng: () => number = Math.random): DiscreteDistribution {
    const logChoose = (k: number) => SF.lnGamma(n + 1) - SF.lnGamma(k + 1) - SF.lnGamma(n - k + 1);
    return {
      pmf: (k) =>
        k < 0 || k > n || !Number.isInteger(k)
          ? 0
          : Math.exp(logChoose(k) + k * Math.log(p) + (n - k) * Math.log(1 - p)),
      cdf: (k) => {
        let s = 0;
        for (let i = 0; i <= Math.floor(k); i++) s += Distributions.binomial(n, p).pmf(i);
        return Math.min(1, s);
      },
      mean: () => n * p,
      variance: () => n * p * (1 - p),
      sample: () => {
        let count = 0;
        for (let i = 0; i < n; i++) if (rng() < p) count++;
        return count;
      },
    };
  }

  static poisson(lambda: number, rng: () => number = Math.random): DiscreteDistribution {
    return {
      pmf: (k) => (k < 0 || !Number.isInteger(k) ? 0 : Math.exp(k * Math.log(lambda) - lambda - SF.lnGamma(k + 1))),
      cdf: (k) => (k < 0 ? 0 : SF.regularizedGammaQ(Math.floor(k) + 1, lambda)),
      mean: () => lambda,
      variance: () => lambda,
      sample: () => {
        const L = Math.exp(-lambda);
        let k = 0;
        let prod = 1;
        do {
          k++;
          prod *= rng();
        } while (prod > L);
        return k - 1;
      },
    };
  }

  /** Marsaglia-Tsang gamma sampler (shape ≥ 0). */
  private static sampleGamma(shape: number, rng: () => number = Math.random): number {
    if (shape < 1) return Distributions.sampleGamma(shape + 1, rng) * rng() ** (1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = Distributions.normal(0, 1, rng).sample();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = rng();
      if (u < 1 - 0.0331 * x ** 4) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
}

export interface TestResult {
  statistic: number;
  df: number;
  pValue: number;
}

export class HypothesisTests {
  /** One-sample two-tailed Student t-test against a hypothesised mean `mu0`. */
  static tTestOneSample(sample: number[], mu0 = 0): TestResult {
    const n = sample.length;
    const mean = sample.reduce((a, b) => a + b, 0) / n;
    const variance = sample.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    const se = Math.sqrt(variance / n);
    const t = (mean - mu0) / se;
    const df = n - 1;
    const p = 2 * (1 - Distributions.studentT(df).cdf(Math.abs(t)));
    return { statistic: t, df, pValue: p };
  }

  /** Welch's two-sample t-test (unequal variances). */
  static tTestTwoSample(a: number[], b: number[]): TestResult {
    const na = a.length;
    const nb = b.length;
    const ma = a.reduce((s, x) => s + x, 0) / na;
    const mb = b.reduce((s, x) => s + x, 0) / nb;
    const va = a.reduce((s, x) => s + (x - ma) ** 2, 0) / (na - 1);
    const vb = b.reduce((s, x) => s + (x - mb) ** 2, 0) / (nb - 1);
    const se = Math.sqrt(va / na + vb / nb);
    const t = (ma - mb) / se;
    const df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
    const p = 2 * (1 - Distributions.studentT(df).cdf(Math.abs(t)));
    return { statistic: t, df, pValue: p };
  }

  /** Pearson chi-square goodness-of-fit test. */
  static chiSquareGoodnessOfFit(observed: number[], expected: number[]): TestResult {
    const chi2 = observed.reduce((s, o, i) => s + (o - expected[i]) ** 2 / expected[i], 0);
    const df = observed.length - 1;
    const p = 1 - Distributions.chiSquare(df).cdf(chi2);
    return { statistic: chi2, df, pValue: p };
  }

  /** Confidence interval for the mean of a sample at the given level (t-based). */
  static confidenceIntervalMean(sample: number[], level = 0.95): [number, number] {
    const n = sample.length;
    const m = sample.reduce((a, b) => a + b, 0) / n;
    const variance = sample.reduce((acc, x) => acc + (x - m) ** 2, 0) / (n - 1);
    const se = Math.sqrt(variance / n);
    const alpha = 1 - level;
    const tCrit = tQuantile(1 - alpha / 2, n - 1);
    return [m - tCrit * se, m + tCrit * se];
  }
}

// -- small internal helpers -------------------------------------------------

/** Quantile of Student-t via bisection on its CDF. */
function tQuantile(p: number, df: number): number {
  const dist = Distributions.studentT(df);
  let lo = -100;
  let hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (dist.cdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
