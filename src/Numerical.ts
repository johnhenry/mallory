/**
 * Numerical — numerical-methods toolkit: root finding (bisection, secant,
 * Newton, Brent), quadrature (composite trapezoid/Simpson, adaptive Simpson,
 * Gauss-Legendre), ODE integration (Euler, RK4 for systems), and nonlinear
 * curve fitting (Levenberg-Marquardt). Complements the simpler
 * `integrateN`/`differentiateN`/`solveN` in {@link RealMath}.
 */

import { MatrixMath } from "./MatrixMath.ts";

type Fn = (x: number) => number;
/** A first-order ODE system `dy/dt = f(t, y)`. */
type ODE = (t: number, y: number[]) => number[];
/** A parametric model `y = model(x, params)`, e.g. `(x, [a, b]) => a * Math.exp(b * x)`. */
type Model = (x: number, params: number[]) => number;

// 5-point Gauss-Legendre nodes/weights on [-1, 1].
const GL5_NODES = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const GL5_WEIGHTS = [
  0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891,
];

export interface ODEStep {
  t: number;
  y: number[];
}

export interface LevenbergMarquardtResult {
  params: number[];
  /** sqrt of the sum of squared residuals at `params`. */
  residualNorm: number;
  iterations: number;
  converged: boolean;
}

export class Numerical {
  // -- root finding --------------------------------------------------------

  /** Find a root of `f` in `[a, b]` by bisection (requires a sign change). */
  static bisection(f: Fn, a: number, b: number, tolerance = 1e-12, maxIterations = 200): number {
    let lo = a;
    let hi = b;
    let flo = f(lo);
    if (flo * f(hi) > 0) throw new Error("bisection requires f(a) and f(b) to have opposite signs.");
    for (let i = 0; i < maxIterations; i++) {
      const mid = (lo + hi) / 2;
      const fmid = f(mid);
      if (Math.abs(fmid) < tolerance || (hi - lo) / 2 < tolerance) return mid;
      if (flo * fmid < 0) hi = mid;
      else {
        lo = mid;
        flo = fmid;
      }
    }
    return (lo + hi) / 2;
  }

  /** Find a root of `f` by the secant method from two starting guesses. */
  static secant(f: Fn, x0: number, x1: number, tolerance = 1e-12, maxIterations = 200): number {
    let a = x0;
    let b = x1;
    let fa = f(a);
    let fb = f(b);
    for (let i = 0; i < maxIterations; i++) {
      if (Math.abs(fb) < tolerance) return b;
      const denom = fb - fa;
      if (denom === 0) break;
      const c = b - (fb * (b - a)) / denom;
      a = b;
      fa = fb;
      b = c;
      fb = f(b);
    }
    return b;
  }

  /** Newton's method; if `df` is omitted, a numeric derivative is used. */
  static newton(f: Fn, x0: number, df?: Fn, tolerance = 1e-12, maxIterations = 200): number {
    let x = x0;
    const derivative = df ?? ((t: number) => (f(t + 1e-7) - f(t - 1e-7)) / 2e-7);
    for (let i = 0; i < maxIterations; i++) {
      const fx = f(x);
      if (Math.abs(fx) < tolerance) return x;
      const d = derivative(x);
      if (d === 0) break;
      x -= fx / d;
    }
    return x;
  }

  /** Brent's method: robust bracketing root finder combining bisection and interpolation. */
  static brent(f: Fn, a: number, b: number, tolerance = 1e-12, maxIterations = 200): number {
    let fa = f(a);
    let fb = f(b);
    if (fa * fb > 0) throw new Error("brent requires f(a) and f(b) to have opposite signs.");
    if (Math.abs(fa) < Math.abs(fb)) {
      [a, b] = [b, a];
      [fa, fb] = [fb, fa];
    }
    let c = a;
    let fc = fa;
    let d = b - a;
    let mflag = true;
    for (let i = 0; i < maxIterations; i++) {
      if (Math.abs(fb) < tolerance || Math.abs(b - a) < tolerance) return b;
      let s: number;
      if (fa !== fc && fb !== fc) {
        s =
          (a * fb * fc) / ((fa - fb) * (fa - fc)) +
          (b * fa * fc) / ((fb - fa) * (fb - fc)) +
          (c * fa * fb) / ((fc - fa) * (fc - fb));
      } else {
        s = b - (fb * (b - a)) / (fb - fa);
      }
      const cond =
        s < (3 * a + b) / 4 ||
        s > b ||
        (mflag && Math.abs(s - b) >= Math.abs(b - c) / 2) ||
        (!mflag && Math.abs(s - b) >= Math.abs(c - d) / 2);
      if (cond) {
        s = (a + b) / 2;
        mflag = true;
      } else {
        mflag = false;
      }
      const fs = f(s);
      d = c;
      c = b;
      fc = fb;
      if (fa * fs < 0) {
        b = s;
        fb = fs;
      } else {
        a = s;
        fa = fs;
      }
      if (Math.abs(fa) < Math.abs(fb)) {
        [a, b] = [b, a];
        [fa, fb] = [fb, fa];
      }
    }
    return b;
  }

  // -- quadrature ----------------------------------------------------------

  /** Composite trapezoidal rule with `n` subintervals. */
  static trapezoid(f: Fn, a: number, b: number, n = 1000): number {
    const h = (b - a) / n;
    let sum = (f(a) + f(b)) / 2;
    for (let i = 1; i < n; i++) sum += f(a + i * h);
    return sum * h;
  }

  /** Composite Simpson's rule with `n` (rounded up to even) subintervals. */
  static simpson(f: Fn, a: number, b: number, n = 1000): number {
    const m = n % 2 === 0 ? n : n + 1;
    const h = (b - a) / m;
    let sum = f(a) + f(b);
    for (let i = 1; i < m; i++) sum += (i % 2 === 0 ? 2 : 4) * f(a + i * h);
    return (sum * h) / 3;
  }

  /** Adaptive Simpson quadrature to a target error tolerance. */
  static adaptiveSimpson(f: Fn, a: number, b: number, tolerance = 1e-10, maxDepth = 50): number {
    const simpson = (lo: number, hi: number, flo: number, fmid: number, fhi: number) =>
      ((hi - lo) / 6) * (flo + 4 * fmid + fhi);
    const recurse = (
      lo: number,
      hi: number,
      flo: number,
      fmid: number,
      fhi: number,
      whole: number,
      tol: number,
      depth: number,
    ): number => {
      const mid = (lo + hi) / 2;
      const lmid = (lo + mid) / 2;
      const rmid = (mid + hi) / 2;
      const flmid = f(lmid);
      const frmid = f(rmid);
      const left = simpson(lo, mid, flo, flmid, fmid);
      const right = simpson(mid, hi, fmid, frmid, fhi);
      if (depth <= 0 || Math.abs(left + right - whole) <= 15 * tol) return left + right + (left + right - whole) / 15;
      return (
        recurse(lo, mid, flo, flmid, fmid, left, tol / 2, depth - 1) +
        recurse(mid, hi, fmid, frmid, fhi, right, tol / 2, depth - 1)
      );
    };
    const mid = (a + b) / 2;
    const fa = f(a);
    const fmid = f(mid);
    const fb = f(b);
    return recurse(a, b, fa, fmid, fb, simpson(a, b, fa, fmid, fb), tolerance, maxDepth);
  }

  /** 5-point Gauss-Legendre quadrature on `[a, b]`. */
  static gaussLegendre(f: Fn, a: number, b: number): number {
    const half = (b - a) / 2;
    const mid = (a + b) / 2;
    let sum = 0;
    for (let i = 0; i < GL5_NODES.length; i++) sum += GL5_WEIGHTS[i] * f(mid + half * GL5_NODES[i]);
    return sum * half;
  }

  // -- ODE integration -----------------------------------------------------

  /** Explicit Euler integration of a first-order system from `t0` to `t1`. */
  static euler(f: ODE, y0: number[], t0: number, t1: number, h = 0.01): ODEStep[] {
    const steps: ODEStep[] = [{ t: t0, y: [...y0] }];
    let t = t0;
    let y = [...y0];
    while (t < t1 - 1e-12) {
      const step = Math.min(h, t1 - t);
      const dy = f(t, y);
      y = y.map((yi, i) => yi + step * dy[i]);
      t += step;
      steps.push({ t, y: [...y] });
    }
    return steps;
  }

  /** Classical fourth-order Runge-Kutta integration of a first-order system. */
  static rk4(f: ODE, y0: number[], t0: number, t1: number, h = 0.01): ODEStep[] {
    const steps: ODEStep[] = [{ t: t0, y: [...y0] }];
    let t = t0;
    let y = [...y0];
    while (t < t1 - 1e-12) {
      const step = Math.min(h, t1 - t);
      const k1 = f(t, y);
      const k2 = f(
        t + step / 2,
        y.map((yi, i) => yi + (step / 2) * k1[i]),
      );
      const k3 = f(
        t + step / 2,
        y.map((yi, i) => yi + (step / 2) * k2[i]),
      );
      const k4 = f(
        t + step,
        y.map((yi, i) => yi + step * k3[i]),
      );
      y = y.map((yi, i) => yi + (step / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
      t += step;
      steps.push({ t, y: [...y] });
    }
    return steps;
  }

  // -- curve fitting ---------------------------------------------------------

  /**
   * Nonlinear least-squares curve fitting via Levenberg-Marquardt: finds
   * `params` minimizing `sum((model(xs[i], params) - ys[i])^2)`, starting
   * from `params0`. The Jacobian of `model` with respect to `params` is
   * estimated by central finite differences (generalizes `newton`'s
   * optional-df-else-numeric-derivative convention to a vector of
   * parameters). `lambda` is the Marquardt damping factor -- scaled against
   * each parameter's own row of `JᵀJ` (not a plain identity, the original
   * Levenberg damping) so differently-scaled parameters damp comparably --
   * grown 10x on a rejected step (safer, more like gradient descent) and
   * shrunk 10x on an accepted one (faster, more like Gauss-Newton near the
   * optimum).
   *
   * `converged` is true once *either* the sum of squared residuals itself
   * drops below `tolerance` (a near-exact fit) *or* at least one step has
   * improved it and further steps stop improving it meaningfully (no
   * damped step improves it at all, or the relative improvement has
   * dropped below 1e-12) -- deliberately not "the residual itself is near
   * zero" as the only success criterion, since real (noisy) data's true
   * best fit essentially never drives the residual anywhere near
   * `tolerance`, even when the fit has genuinely converged to the best
   * achievable parameters; requiring near-zero residual would wrongly
   * report `converged: false` for every realistic (as opposed to
   * synthetic/noiseless) dataset.
   *
   * NON-GOALS: no bounds/constraints on `params`; only ever finds one local
   * minimum near `params0`, the same "no guarantee of the global optimum"
   * caveat as `newton`. Returns `converged: false` (with the best `params`
   * found, not a throw) when no step ever improved on `params0` at all --
   * a model/data pairing that can't be fit usefully isn't a numerical error
   * the way a divergent root-find is, but is still worth flagging distinctly
   * from "converged to some local optimum, however good or mediocre."
   */
  static levenbergMarquardt(
    model: Model,
    params0: number[],
    xs: number[],
    ys: number[],
    options: { lambda0?: number; tolerance?: number; maxIterations?: number } = {},
  ): LevenbergMarquardtResult {
    const { lambda0 = 1e-2, tolerance = 1e-10, maxIterations = 200 } = options;
    const n = params0.length;
    const m = xs.length;
    let params = [...params0];
    let lambda = lambda0;

    function residuals(p: number[]): number[] {
      return xs.map((x, i) => model(x, p) - ys[i]);
    }
    function sumSq(r: number[]): number {
      return r.reduce((s, v) => s + v * v, 0);
    }
    function jacobian(p: number[]): number[][] {
      const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
      for (let j = 0; j < n; j++) {
        const step = 1e-6 * (Math.abs(p[j]) + 1e-6);
        const pPlus = [...p];
        const pMinus = [...p];
        pPlus[j] += step;
        pMinus[j] -= step;
        const rPlus = residuals(pPlus);
        const rMinus = residuals(pMinus);
        for (let i = 0; i < m; i++) J[i][j] = (rPlus[i] - rMinus[i]) / (2 * step);
      }
      return J;
    }

    let r = residuals(params);
    let currentSumSq = sumSq(r);
    let iterations = 0;
    let everImproved = false;

    for (; iterations < maxIterations; iterations++) {
      if (currentSumSq < tolerance) break; // a near-exact fit -- stop early regardless of real data's usual nonzero floor below
      const J = jacobian(params);
      const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
      const Jtr: number[] = new Array(n).fill(0);
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          let s = 0;
          for (let i = 0; i < m; i++) s += (J[i] as number[])[a] * (J[i] as number[])[b];
          (JtJ[a] as number[])[b] = s;
        }
        let s2 = 0;
        for (let i = 0; i < m; i++) s2 += (J[i] as number[])[a] * r[i];
        Jtr[a] = s2;
      }

      const prevSumSq = currentSumSq;
      let accepted = false;
      for (let tries = 0; tries < 30 && !accepted; tries++) {
        const A = JtJ.map((row, a) => row.map((v, b) => v + (a === b ? lambda * (JtJ[a] as number[])[a] : 0)));
        let delta: number[];
        try {
          delta = [
            ...MatrixMath.solve(
              A,
              Jtr.map((v) => -v),
            ),
          ];
        } catch {
          lambda *= 10;
          continue;
        }
        const candidate = params.map((p, i) => p + (delta[i] as number));
        const rCandidate = residuals(candidate);
        const candidateSumSq = sumSq(rCandidate);
        if (Number.isFinite(candidateSumSq) && candidateSumSq < currentSumSq) {
          params = candidate;
          r = rCandidate;
          currentSumSq = candidateSumSq;
          lambda = Math.max(lambda / 10, 1e-12);
          accepted = true;
          everImproved = true;
        } else {
          lambda *= 10;
        }
      }
      // Either terminating condition below is a real local minimum, not a
      // failure: no damped step improves further (`!accepted`), or the ones
      // that do are only shaving off numerically-insignificant amounts
      // (`relativeImprovement` near zero) -- real (noisy) data's best fit
      // essentially never drives `currentSumSq` itself near zero the way
      // `tolerance` alone would require, so treating only *that* as success
      // would wrongly call every noisy-data fit unconverged.
      if (!accepted) break;
      const relativeImprovement = (prevSumSq - currentSumSq) / Math.max(1, prevSumSq);
      if (relativeImprovement < 1e-12) break;
    }

    return {
      params,
      residualNorm: Math.sqrt(currentSumSq),
      iterations,
      converged: everImproved || currentSumSq < tolerance,
    };
  }
}
