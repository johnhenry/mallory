import assert from "node:assert/strict";
import { test } from "node:test";
import { Distributions, HypothesisTests } from "../src/Distributions.ts";
import { Numerical } from "../src/Numerical.ts";
import { SpecialFunctions as SF } from "../src/SpecialFunctions.ts";

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- Numerical: roots ---

test("root finders converge to sqrt(2)", () => {
  const f = (x: number) => x * x - 2;
  assert.ok(close(Numerical.bisection(f, 0, 2), Math.SQRT2));
  assert.ok(close(Numerical.secant(f, 1, 2), Math.SQRT2));
  assert.ok(close(Numerical.newton(f, 1), Math.SQRT2));
  assert.ok(close(Numerical.brent(f, 0, 2), Math.SQRT2));
});

test("bisection/brent reject a non-bracketing interval", () => {
  assert.throws(() => Numerical.bisection((x) => x * x + 1, 0, 2));
  assert.throws(() => Numerical.brent((x) => x * x + 1, 0, 2));
});

// --- Numerical: quadrature ---

test("quadrature of known integrals", () => {
  // ∫₀^π sin = 2
  assert.ok(close(Numerical.simpson(Math.sin, 0, Math.PI), 2, 1e-9));
  assert.ok(close(Numerical.trapezoid(Math.sin, 0, Math.PI, 10000), 2, 1e-6));
  assert.ok(close(Numerical.adaptiveSimpson(Math.sin, 0, Math.PI), 2, 1e-9));
  // ∫₀¹ x⁴ = 1/5 (Gauss-Legendre 5pt is exact up to degree 9)
  assert.ok(
    close(
      Numerical.gaussLegendre((x) => x ** 4, 0, 1),
      1 / 5,
      1e-12,
    ),
  );
});

// --- Numerical: ODE ---

test("rk4 solves y' = y, y(0)=1 -> e", () => {
  const steps = Numerical.rk4((_t, y) => [y[0]], [1], 0, 1, 0.01);
  const last = steps[steps.length - 1];
  assert.ok(close(last.y[0], Math.E, 1e-6));
});

test("rk4 solves the harmonic oscillator", () => {
  // y'' = -y  ->  y1' = y2, y2' = -y1 ; y(0)=1,y'(0)=0 -> cos(t)
  const steps = Numerical.rk4((_t, y) => [y[1], -y[0]], [1, 0], 0, Math.PI, 0.001);
  const last = steps[steps.length - 1];
  assert.ok(close(last.y[0], Math.cos(Math.PI), 1e-4));
});

// --- SpecialFunctions ---

test("gamma / lnGamma / beta", () => {
  assert.ok(close(SF.gamma(5), 24)); // 4!
  assert.ok(close(SF.gamma(0.5), Math.sqrt(Math.PI)));
  assert.ok(close(SF.lnGamma(10), Math.log(362880)));
  assert.ok(close(SF.beta(2, 3), 1 / 12));
});

test("erf and incomplete functions", () => {
  assert.ok(close(SF.erf(0), 0));
  assert.ok(close(SF.erf(1), 0.8427007, 1e-6));
  assert.ok(close(SF.erfc(1), 1 - 0.8427007, 1e-6));
  assert.ok(close(SF.regularizedGammaP(1, 1), 1 - Math.exp(-1), 1e-9));
  assert.ok(close(SF.regularizedIncompleteBeta(0.5, 1, 1), 0.5, 1e-9));
});

// --- Distributions ---

test("normal distribution cdf/pdf/quantile", () => {
  const n = Distributions.normal(0, 1);
  assert.ok(close(n.cdf(0), 0.5));
  assert.ok(close(n.cdf(1.96), 0.975, 1e-4));
  assert.ok(close(n.pdf(0), 1 / Math.sqrt(2 * Math.PI)));
  assert.ok(close(Distributions.normalQuantile(0.975), 1.96, 1e-3));
});

test("exponential / uniform / poisson / binomial basics", () => {
  const e = Distributions.exponential(2);
  assert.ok(close(e.mean(), 0.5) && close(e.cdf(0), 0));
  const u = Distributions.uniform(0, 4);
  assert.ok(close(u.mean(), 2) && close(u.variance(), 16 / 12));
  const p = Distributions.poisson(3);
  assert.ok(close(p.pmf(0), Math.exp(-3)) && close(p.mean(), 3));
  const b = Distributions.binomial(10, 0.5);
  assert.ok(close(b.mean(), 5) && close(b.pmf(5), 252 / 1024));
});

test("chi-square and student-t cdfs", () => {
  // chi-square df=2 cdf at 2 = 1 - e^-1
  assert.ok(close(Distributions.chiSquare(2).cdf(2), 1 - Math.exp(-1), 1e-6));
  // student-t is symmetric: cdf(0) = 0.5
  assert.ok(close(Distributions.studentT(5).cdf(0), 0.5, 1e-9));
});

test("hypothesis tests", () => {
  // one-sample t-test: sample clearly above 0
  const r = HypothesisTests.tTestOneSample([2, 3, 4, 5, 6], 0);
  assert.ok(r.statistic > 0 && r.pValue < 0.05);
  // two identical samples -> t ~ 0, large p
  const r2 = HypothesisTests.tTestTwoSample([1, 2, 3, 4], [1, 2, 3, 4]);
  assert.ok(Math.abs(r2.statistic) < 1e-9 && r2.pValue > 0.9);
  // goodness of fit with matching data -> chi2 = 0
  const r3 = HypothesisTests.chiSquareGoodnessOfFit([10, 10, 10], [10, 10, 10]);
  assert.ok(close(r3.statistic, 0) && r3.pValue > 0.99);
  const [lo, hi] = HypothesisTests.confidenceIntervalMean([2, 4, 6, 8, 10], 0.95);
  assert.ok(lo < 6 && hi > 6, "CI contains the sample mean 6");
});

// --- Numerical: curve fitting ---

test("levenbergMarquardt fits y = a*exp(b*x) to noiseless data", () => {
  const trueA = 2.5;
  const trueB = 0.3;
  const model = (x: number, p: number[]) => (p[0] as number) * Math.exp((p[1] as number) * x);
  const xs = [0, 1, 2, 3, 4, 5];
  const ys = xs.map((x) => trueA * Math.exp(trueB * x));
  const result = Numerical.levenbergMarquardt(model, [1, 0.1], xs, ys);
  assert.ok(result.converged);
  assert.ok(close(result.params[0] as number, trueA, 1e-4));
  assert.ok(close(result.params[1] as number, trueB, 1e-4));
  assert.ok(result.residualNorm < 1e-4);
});

test("levenbergMarquardt fits a Gaussian y = a*exp(-(x-b)^2/(2c^2)) to noiseless data", () => {
  const trueA = 3;
  const trueB = 1.5;
  const trueC = 0.8;
  const model = (x: number, p: number[]) =>
    (p[0] as number) * Math.exp(-((x - (p[1] as number)) ** 2) / (2 * (p[2] as number) * (p[2] as number)));
  const xs = [-1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];
  const ys = xs.map((x) => trueA * Math.exp(-((x - trueB) ** 2) / (2 * trueC * trueC)));
  const result = Numerical.levenbergMarquardt(model, [2, 1, 1], xs, ys);
  assert.ok(result.converged);
  assert.ok(close(result.params[0] as number, trueA, 1e-3));
  assert.ok(close(result.params[1] as number, trueB, 1e-3));
  assert.ok(close(result.params[2] as number, trueC, 1e-3));
});

test("levenbergMarquardt also fits a model that's linear in its own parameters", () => {
  const model = (x: number, p: number[]) => (p[0] as number) + (p[1] as number) * x;
  const xs = [0, 1, 2, 3];
  const ys = xs.map((x) => 2 + 3 * x);
  const result = Numerical.levenbergMarquardt(model, [0, 0], xs, ys);
  assert.ok(result.converged);
  assert.ok(close(result.params[0] as number, 2, 1e-3));
  assert.ok(close(result.params[1] as number, 3, 1e-3));
});

test("levenbergMarquardt reports converged:true for realistic (noisy, non-exact-fit) data", () => {
  // This data has real scatter (not generated from the model exactly), so the
  // best-fit residual is genuinely nonzero -- converged must not require the
  // residual itself to be near zero, only that the iteration found a local
  // optimum (no further step improves it).
  const model = (x: number, p: number[]) => (p[0] as number) * Math.exp((p[1] as number) * x);
  const xs = [1, 2, 3, 4, 5];
  const ys = [2.1, 3.9, 6.2, 7.8, 10.1];
  const result = Numerical.levenbergMarquardt(model, [1, 0.1], xs, ys);
  assert.ok(result.converged);
  assert.ok(result.residualNorm > 1e-6, "a real dataset's best fit has a genuinely nonzero residual");
  assert.ok(result.residualNorm < 2, "but still a reasonably good fit, not a divergence");
});
