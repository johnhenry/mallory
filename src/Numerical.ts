/**
 * Numerical — numerical-methods toolkit: root finding (bisection, secant,
 * Newton, Brent), quadrature (composite trapezoid/Simpson, adaptive Simpson,
 * Gauss-Legendre) and ODE integration (Euler, RK4 for systems). Complements the
 * simpler `integrateN`/`differentiateN`/`solveN` in {@link RealMath}.
 */

type Fn = (x: number) => number;
/** A first-order ODE system `dy/dt = f(t, y)`. */
type ODE = (t: number, y: number[]) => number[];

// 5-point Gauss-Legendre nodes/weights on [-1, 1].
const GL5_NODES = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const GL5_WEIGHTS = [
  0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891,
];

export interface ODEStep {
  t: number;
  y: number[];
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
}
