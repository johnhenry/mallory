import assert from "node:assert/strict";
import { test } from "node:test";
import { Numerical } from "../src/Numerical.ts";
import { Rational } from "../src/Rational.ts";
import { Structure } from "../src/Structure.ts";
import {
  DegenerateOdeError,
  IntegrationSingularityError,
  NoClosedFormError,
  NonLinearSystemError,
  NotSeparableError,
  SeriesDivergesError,
  SingularSystemError,
  Symbolic,
  SystemDidNotConvergeError,
  UndeclaredVariableError,
} from "../src/Symbolic.ts";

const evalAt = (expr: string, x: number) => Symbolic.evaluate(expr, { x });

test("parse and evaluate", () => {
  assert.equal(Symbolic.evaluate("2 + 3*4"), 14);
  assert.equal(Symbolic.evaluate("2^3^2"), 512, "right associative power");
  assert.ok(Math.abs(Symbolic.evaluate("sin(pi/2)") - 1) < 1e-12);
  assert.equal(Symbolic.evaluate("x^2 + 1", { x: 3 }), 10);
});

test("differentiate polynomials and products", () => {
  // d/dx x^3 = 3x^2
  assert.equal(Symbolic.toString(Symbolic.differentiate("x^3")), "3*x^2");
  // d/dx (x^2 + 2x + 1) = 2x + 2
  const d = Symbolic.differentiate("x^2 + 2*x + 1");
  assert.equal(Symbolic.evaluate(d, { x: 3 }), 8);
});

test("differentiate chain rule", () => {
  // d/dx sin(x^2) = 2x cos(x^2); at x=1 -> 2 cos 1
  const d = Symbolic.differentiate("sin(x^2)");
  assert.ok(Math.abs(Symbolic.evaluate(d, { x: 1 }) - 2 * Math.cos(1)) < 1e-9);
  // d/dx exp(2x) = 2 exp(2x); at 0 -> 2
  const d2 = Symbolic.differentiate("exp(2*x)");
  assert.ok(Math.abs(Symbolic.evaluate(d2, { x: 0 }) - 2) < 1e-9);
  // d/dx ln(x) = 1/x
  const d3 = Symbolic.differentiate("ln(x)");
  assert.ok(Math.abs(Symbolic.evaluate(d3, { x: 4 }) - 0.25) < 1e-9);
});

test("simplify applies identities", () => {
  assert.equal(Symbolic.toString(Symbolic.simplify("x + 0")), "x");
  assert.equal(Symbolic.toString(Symbolic.simplify("1*x + x*0")), "x");
  assert.equal(Symbolic.toString(Symbolic.simplify("x^1")), "x");
  assert.equal(Symbolic.toString(Symbolic.simplify("x^0")), "1");
});

test("integrate elementary forms (fundamental theorem check)", () => {
  // ∫ x^2 dx = x^3/3 ; derivative recovers x^2
  const F = Symbolic.integrate("x^2");
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate(F), { x: 2 }) - 4) < 1e-9);
  // ∫ cos(x) dx = sin(x)
  const G = Symbolic.integrate("cos(x)");
  assert.ok(Math.abs(Symbolic.evaluate(G, { x: Math.PI / 2 }) - 1) < 1e-9);
  // ∫ sin(2x) dx = -cos(2x)/2 ; linear-substitution
  const H = Symbolic.integrate("sin(2*x)");
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate(H), { x: 0.3 }) - Math.sin(0.6)) < 1e-9);
  // ∫ 1/x dx = ln x
  assert.equal(Symbolic.toString(Symbolic.integrate("1/x")), "ln(x)");
});

test("integrate rejects non-elementary forms", () => {
  assert.throws(() => Symbolic.integrate("sin(x^2)"));
});

test("integrate via u-substitution: 2x*sin(x^2) -> -cos(x^2)", () => {
  const F = Symbolic.integrate("2*x*sin(x^2)");
  for (const x of [0.3, 1.1, -0.7]) {
    const d = Symbolic.evaluate(Symbolic.differentiate(F), { x });
    assert.ok(Math.abs(d - 2 * x * Math.sin(x * x)) < 1e-6);
  }
});

test("integrate via u-substitution: 3x^2*exp(x^3) -> exp(x^3)", () => {
  const F = Symbolic.integrate("3*x^2*exp(x^3)");
  for (const x of [0.2, 0.9, -0.5]) {
    const d = Symbolic.evaluate(Symbolic.differentiate(F), { x });
    assert.ok(Math.abs(d - 3 * x * x * Math.exp(x ** 3)) < 1e-6);
  }
});

test("u-substitution does not over-claim when no valid substitution exists", () => {
  // sin(x^2) alone (without the accompanying 2x factor) has no g(x) whose
  // derivative appears as a factor -- must still throw, not return a wrong answer.
  assert.throws(() => Symbolic.integrate("sin(x^2)"));
});

test("integrate covers ln/sqrt/tan/cot/sec/csc/sinh/cosh/tanh/asin/acos/atan of a linear argument", () => {
  const cases: [string, (x: number) => number][] = [
    ["ln(x)", Math.log],
    ["sqrt(x)", Math.sqrt],
    ["tan(x)", Math.tan],
    ["cot(x)", (x) => 1 / Math.tan(x)],
    ["sec(x)", (x) => 1 / Math.cos(x)],
    ["csc(x)", (x) => 1 / Math.sin(x)],
    ["sinh(x)", Math.sinh],
    ["cosh(x)", Math.cosh],
    ["tanh(x)", Math.tanh],
  ];
  for (const [src, f] of cases) {
    const F = Symbolic.integrate(src);
    for (const x of [0.3, 0.7, 1.4]) {
      const d = Symbolic.evaluate(Symbolic.differentiate(F), { x });
      assert.ok(Math.abs(d - f(x)) < 1e-6, `${src} at x=${x}: got ${d}, expected ${f(x)}`);
    }
  }
  const inverseTrig: [string, (x: number) => number][] = [
    ["asin(x)", Math.asin],
    ["acos(x)", Math.acos],
  ];
  for (const [src, f] of inverseTrig) {
    const F = Symbolic.integrate(src);
    for (const x of [-0.6, 0.2, 0.8]) {
      const d = Symbolic.evaluate(Symbolic.differentiate(F), { x });
      assert.ok(Math.abs(d - f(x)) < 1e-6, `${src} at x=${x}: got ${d}, expected ${f(x)}`);
    }
  }
  const Fatan = Symbolic.integrate("atan(x)");
  for (const x of [-2, 0.5, 3]) {
    const d = Symbolic.evaluate(Symbolic.differentiate(Fatan), { x });
    assert.ok(Math.abs(d - Math.atan(x)) < 1e-6);
  }
});

test("integrate 1/(x^2-1) via partial fractions (two distinct real roots)", () => {
  const F = Symbolic.integrate("1/(x^2-1)");
  for (const x of [2, 3, -2, -3, 5]) {
    const d = Symbolic.evaluate(Symbolic.differentiate(F), { x });
    assert.ok(Math.abs(d - 1 / (x * x - 1)) < 1e-6);
  }
  // matches the textbook closed form (1/2)ln|x-1| - (1/2)ln|x+1| in value too
  const definite = Symbolic.integrateDefinite("1/(x^2-1)", 3, 4);
  const expected = 0.5 * Math.log(3) - 0.5 * Math.log(5) - (0.5 * Math.log(2) - 0.5 * Math.log(4));
  assert.ok(Math.abs(definite - expected) < 1e-6);
});

test("integrate x/(x^2+1) via u-substitution on the whole denominator", () => {
  const F = Symbolic.integrate("x/(x^2+1)");
  for (const x of [0.5, 1.5, -2, 3]) {
    const d = Symbolic.evaluate(Symbolic.differentiate(F), { x });
    assert.ok(Math.abs(d - x / (x * x + 1)) < 1e-6);
  }
});

test("integrate c/x for a non-unit constant c", () => {
  assert.equal(Symbolic.toString(Symbolic.integrate("3/x")), "3*ln(x)");
});

test("integrateDefinite matches the closed-form antiderivative for elementary integrands", () => {
  // ∫[0,2] x^2 dx = 8/3
  assert.ok(Math.abs(Symbolic.integrateDefinite("x^2", 0, 2) - 8 / 3) < 1e-9);
});

test("integrateDefinite resolves a u-substitution integrand exactly rather than falling back numerically", () => {
  // ∫[0,1] 2x*sin(x^2) dx = 1 - cos(1)
  assert.ok(Math.abs(Symbolic.integrateDefinite("2*x*sin(x^2)", 0, 1) - (1 - Math.cos(1))) < 1e-9);
});

test("integrateDefinite falls back to numeric quadrature for non-elementary integrands", () => {
  // sin(x^2) alone is genuinely non-elementary; cross-check against Numerical directly
  const expected = Numerical.adaptiveSimpson((x) => Math.sin(x * x), 0, 1);
  assert.ok(Math.abs(Symbolic.integrateDefinite("sin(x^2)", 0, 1) - expected) < 1e-9);
});

test("integrateDefinite honors env for free constants, on both the symbolic and numeric-fallback paths", () => {
  assert.ok(Math.abs(Symbolic.integrateDefinite("k*x", 0, 2, "x", { k: 3 }) - 6) < 1e-9);
  const expected = Numerical.adaptiveSimpson((x) => Math.sin(2 * x * x), 0, 1);
  assert.ok(Math.abs(Symbolic.integrateDefinite("sin(k*x^2)", 0, 1, "x", { k: 2 }) - expected) < 1e-9);
});

test("integrateDefinite negates when lower > upper", () => {
  assert.ok(Math.abs(Symbolic.integrateDefinite("x^2", 2, 0) - -(8 / 3)) < 1e-9);
  const forward = Symbolic.integrateDefinite("sin(x^2)", 0, 1);
  const backward = Symbolic.integrateDefinite("sin(x^2)", 1, 0);
  assert.ok(Math.abs(backward + forward) < 1e-9);
});

test("integrateDefinite throws IntegrationSingularityError for a pole strictly inside the bounds", () => {
  assert.throws(() => Symbolic.integrateDefinite("1/x", -1, 1), IntegrationSingularityError);
  assert.throws(() => Symbolic.integrateDefinite("1/x^2", -1, 1), IntegrationSingularityError);
  assert.throws(() => Symbolic.integrateDefinite("1/(x-0.5)", 0, 1), IntegrationSingularityError);
});

test("integrateDefinite does not false-positive on a legitimate steep-but-bounded peak", () => {
  const expected = Numerical.adaptiveSimpson((x) => Math.exp(-100 * x * x), -2, 2);
  assert.ok(Math.abs(Symbolic.integrateDefinite("exp(-100*x^2)", -2, 2) - expected) < 1e-6);
});

test("integrateDefinite does not flag a singularity outside the integration bounds", () => {
  assert.ok(Math.abs(Symbolic.integrateDefinite("1/x", 1, 2) - Math.log(2)) < 1e-9);
});

test("solveSystem solves a 2x2 linear system", () => {
  const result = Symbolic.solveSystem(["2*x + y - 5", "x - y - 1"], ["x", "y"]);
  assert.ok(Math.abs(result.x - 2) < 1e-9);
  assert.ok(Math.abs(result.y - 1) < 1e-9);
});

test("solveSystem solves a 3x3 linear system", () => {
  const result = Symbolic.solveSystem(["x + y + z - 6", "2*x - y + z - 3", "x + 2*y - z - 2"], ["x", "y", "z"]);
  assert.ok(Math.abs(result.x - 1) < 1e-6);
  assert.ok(Math.abs(result.y - 2) < 1e-6);
  assert.ok(Math.abs(result.z - 3) < 1e-6);
});

test("solveSystem verifies every equation actually zeroes at the solution", () => {
  const eqs = ["3*x - 2*y - 4", "x + y - 7"];
  const result = Symbolic.solveSystem(eqs, ["x", "y"]);
  for (const eq of eqs) {
    assert.ok(Math.abs(Symbolic.evaluate(eq, result)) < 1e-6);
  }
});

test("solveSystem throws NonLinearSystemError for nonlinear equations", () => {
  assert.throws(() => Symbolic.solveSystem(["x*y - 1", "x + y - 2"], ["x", "y"]), NonLinearSystemError);
});

test("solveSystem throws SingularSystemError for a dependent/singular system", () => {
  assert.throws(() => Symbolic.solveSystem(["x + y - 1", "2*x + 2*y - 2"], ["x", "y"]), SingularSystemError);
});

test("solveSystem rejects a non-square system", () => {
  assert.throws(() => Symbolic.solveSystem(["x + y - 1"], ["x", "y", "z"]));
});

test("sumSeries computes a finite partial sum", () => {
  // sum_{k=1}^{5} k^2 = 1+4+9+16+25 = 55
  assert.equal(Symbolic.sumSeries("n^2", 1, 5), 55);
});

test("sumSeries returns 0 for an empty range (from > to)", () => {
  assert.equal(Symbolic.sumSeries("n^2", 5, 1), 0);
});

test("sumSeries recognizes geometric series and matches a large finite partial sum", () => {
  // sum_{n=0}^infty 3*(0.5)^n = 3 / (1 - 0.5) = 6
  const closedForm = Symbolic.sumSeries("3*0.5^n", 0, Number.POSITIVE_INFINITY);
  assert.ok(Math.abs(closedForm - 6) < 1e-9);
  const partial = Symbolic.sumSeries("3*0.5^n", 0, 60);
  assert.ok(Math.abs(closedForm - partial) < 1e-12);
});

test("sumSeries geometric recognition handles shifted/scaled exponents", () => {
  // sum_{n=1}^infty (0.5)^(2n+1) = sum of a geometric series with ratio 0.25, first term 0.5^3=0.125
  // = 0.125 / (1 - 0.25) = 1/6
  const result = Symbolic.sumSeries("0.5^(2*n+1)", 1, Number.POSITIVE_INFINITY);
  assert.ok(Math.abs(result - 1 / 6) < 1e-9);
});

test("sumSeries falls back to numeric summation for a fast-converging non-geometric series", () => {
  // sum_{n=1}^infty n*(0.5)^n = 0.5/(1-0.5)^2 = 2 -- coeff "n" depends on the
  // variable so the geometric-closed-form matcher correctly declines this,
  // but it still converges fast (dominated by 0.5^n) so the numeric fallback
  // handles it accurately.
  const result = Symbolic.sumSeries("n*0.5^n", 1, Number.POSITIVE_INFINITY);
  assert.ok(Math.abs(result - 2) < 1e-6);
});

test("sumSeries throws SeriesDivergesError for a genuinely divergent series", () => {
  assert.throws(() => Symbolic.sumSeries("1/n", 1, Number.POSITIVE_INFINITY), SeriesDivergesError);
});

test("sumSeries confirms a slowly-decaying (polynomial-tail) convergent series via the integral-test tail estimate", () => {
  // Sum 1/n^2 genuinely converges to pi^2/6. The term-magnitude stopping
  // rule alone can't confirm this within the term budget (individual terms
  // shrink far slower than the tolerance requires) -- this is exactly what
  // estimateConvergentTail's doubling-interval integral test recovers.
  const result = Symbolic.sumSeries("1/n^2", 1, Number.POSITIVE_INFINITY);
  assert.ok(Math.abs(result - Math.PI ** 2 / 6) < 1e-8);
});

test("sum/product parse and evaluate a finite range", () => {
  // sum_{i=1}^{10} i^2 = 385
  assert.equal(Symbolic.evaluate("sum(i, 1, 10, i^2)"), 385);
  // product_{i=1}^{5} i = 5! = 120
  assert.equal(Symbolic.evaluate("product(i, 1, 5, i)"), 120);
});

test("sum as an Expr node delegates to sumSeries's geometric-closed-form/numeric-fallback logic for an infinite bound", () => {
  // sum_{k=0}^infty 0.5^k = 2, recognized via the same geometric closed form
  // Symbolic.sumSeries itself uses -- confirms the AST node is a thin
  // delegating wrapper, not a reimplementation. "to" is 1/0 (Infinity), not
  // a large finite number -- a large-but-finite bound would instead take
  // the finite-loop path and iterate that many times.
  const result = Symbolic.evaluate("sum(k, 0, 1/0, 0.5^k)");
  assert.ok(Math.abs(result - 2) < 1e-6, "infinite bound should match the geometric closed form");
});

test("product throws a clear error for an infinite bound (out of v1 scope)", () => {
  assert.throws(() => Symbolic.evaluate("product(i, 1, 1/0, i)"), /finite/);
});

test("differentiate sum is mechanical by linearity (differentiates the body, keeps bounds)", () => {
  // d/dx sum(i,1,3,i*x^2) = sum(i,1,3, 2*i*x) = 2x*(1+2+3) = 12x
  const d = Symbolic.differentiate("sum(i, 1, 3, i*x^2)", "x");
  assert.equal(Symbolic.evaluate(d, { x: 2 }), 24);
  assert.equal(Symbolic.evaluate(d, { x: 3 }), 36);
});

test("differentiate product via the logarithmic-derivative identity", () => {
  // product(i,1,3,i*x) = x * 2x * 3x = 6x^3, derivative = 18x^2. The
  // log-derivative construction won't simplify to that symbolic form, so
  // check numeric agreement at probe points instead.
  const d = Symbolic.differentiate("product(i, 1, 3, i*x)", "x");
  for (const x of [1, 2, 3, -1.5]) {
    assert.ok(Math.abs(Symbolic.evaluate(d, { x }) - 18 * x ** 2) < 1e-9);
  }
});

test("differentiate product is 0 when the body doesn't depend on the differentiation variable", () => {
  // product(i,1,4,i) = 4! = 24, constant in x -- each (dbody/dx)/body term
  // is 0/body = 0 as long as body is nonzero, so the sum -- and thus the
  // whole derivative -- is 0, with no NaN/division-by-zero artifact.
  const d = Symbolic.differentiate("product(i, 1, 4, i)", "x");
  assert.equal(Symbolic.evaluate(d, { x: 7 }), 0);
});

test("sum/product capture-avoidance: substituting the bound variable name is a no-op, substituting a free variable inside body works", () => {
  const expr = Symbolic.parse("sum(i, 1, 10, i*x)");
  // x -> 5: substitutes the free "x", must not touch the bound "i"
  const substX = Symbolic.evaluate(expr, { x: 5 });
  assert.equal(substX, ((10 * 11) / 2) * 5);
  // Structural check: differentiate w.r.t. x must still see the bound "i"
  // in the result's rendering (proving "i" was never substituted away by
  // an incorrect capture).
  const d = Symbolic.differentiate(expr, "x");
  assert.equal(Symbolic.toString(d), "sum(i, 1, 10, i)");
});

test("sum/product toLatex renders \\sum/\\prod with the bound variable, bounds, and body", () => {
  assert.equal(Symbolic.toLatex("sum(i, 1, 10, i^2)"), "\\sum_{i=1}^{10} i^{2}");
  assert.equal(Symbolic.toLatex("product(i, 1, 5, i)"), "\\prod_{i=1}^{5} i");
});

test("equal compares sum/product nodes structurally (variable, from, to, body)", () => {
  const a = Symbolic.simplify("sum(i, 1, 10, i^2)");
  const b = Symbolic.simplify("sum(i, 1, 10, i^2)");
  const differentBound = Symbolic.simplify("sum(i, 1, 11, i^2)");
  const differentVar = Symbolic.simplify("sum(j, 1, 10, j^2)");
  // simplify() runs equal() internally to detect its fixed point -- if two
  // syntactically-identical sum expressions didn't compare equal, simplify
  // would spin past its 30-iteration cap rather than converge; reaching a
  // stable, unchanged result here is itself the equal()-works assertion.
  assert.equal(Symbolic.toString(a), Symbolic.toString(b));
  assert.notEqual(Symbolic.toString(a), Symbolic.toString(differentBound));
  // A sum with a differently-named bound variable is structurally distinct
  // text (alpha-equivalence isn't attempted), but evaluates identically.
  assert.notEqual(Symbolic.toString(a), Symbolic.toString(differentVar));
  assert.equal(Symbolic.evaluate(a), Symbolic.evaluate(differentVar));
});

test("cmp evaluates to 1/0 boolean-as-number for all six operators", () => {
  assert.equal(evalAt("x<3", 1), 1);
  assert.equal(evalAt("x<3", 5), 0);
  assert.equal(evalAt("x<=3", 3), 1);
  assert.equal(evalAt("x<=3", 4), 0);
  assert.equal(evalAt("x>3", 5), 1);
  assert.equal(evalAt("x>3", 1), 0);
  assert.equal(evalAt("x>=3", 3), 1);
  assert.equal(evalAt("x>=3", 2), 0);
  assert.equal(evalAt("x==3", 3), 1);
  assert.equal(evalAt("x==3", 4), 0);
  assert.equal(evalAt("x!=3", 4), 1);
  assert.equal(evalAt("x!=3", 3), 0);
});

test("piecewise selects the first truthy branch, else otherwise", () => {
  const expr = "piecewise(x<0, -1, x==0, 0, 1)";
  assert.equal(evalAt(expr, -5), -1);
  assert.equal(evalAt(expr, 0), 0);
  assert.equal(evalAt(expr, 7), 1);
});

test("comparisons bind loosest in the parser", () => {
  // (x+1) < (2*x), not some other grouping
  assert.equal(evalAt("x + 1 < 2*x", 0), 0);
  assert.equal(evalAt("x + 1 < 2*x", 2), 1);
  // a parenthesized comparison can be used as an operand (boolean-as-number)
  assert.equal(evalAt("(x<3)*5", 1), 5);
  assert.equal(evalAt("(x<3)*5", 5), 0);
});

test("piecewise requires an odd argument count >= 3", () => {
  assert.throws(() => Symbolic.parse("piecewise(x<0, -1)"));
  assert.throws(() => Symbolic.parse("piecewise(x<0, -1, x>0, 1, 0, 5)"));
});

test("differentiate treats cmp as locally constant and piecewise branch-wise", () => {
  const d = Symbolic.differentiate("piecewise(x<0, x^2, x^3)");
  assert.equal(Symbolic.evaluate(d, { x: -2 }), -4); // 2x at x=-2
  assert.equal(Symbolic.evaluate(d, { x: 3 }), 27); // 3x^2 at x=3
});

test("simplify constant-folds cmp literals and recurses into piecewise branches", () => {
  assert.equal(Symbolic.toString(Symbolic.simplify("3<5")), "1");
  assert.equal(Symbolic.toString(Symbolic.simplify("3>5")), "0");
  // recurses into arithmetic inside each branch without crashing
  const simplified = Symbolic.simplify("piecewise(1<2, x+0, x*1)");
  assert.equal(Symbolic.evaluate(simplified, { x: 7 }), 7);
});

test("toLatex/fromLatex round-trip all six cmp operators", () => {
  const cases: Array<[string, string]> = [
    ["x<3", "<"],
    ["x<=3", "\\leq"],
    ["x>3", ">"],
    ["x>=3", "\\geq"],
    ["x==3", "="],
    ["x!=3", "\\neq"],
  ];
  for (const [expr, latexSymbol] of cases) {
    const latex = Symbolic.toLatex(expr);
    assert.ok(latex.includes(latexSymbol), `expected "${latex}" to include "${latexSymbol}"`);
    const roundTripped = Symbolic.fromLatex(latex);
    for (const x of [1, 3, 5]) {
      assert.equal(Symbolic.evaluate(roundTripped, { x }), Symbolic.evaluate(expr, { x }));
    }
  }
});

test("fromLatex accepts \\le/\\ge/\\ne short spellings as well as \\leq/\\geq/\\neq", () => {
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("x \\le 3"), { x: 3 }), 1);
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("x \\ge 3"), { x: 3 }), 1);
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("x \\ne 3"), { x: 3 }), 0);
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("x \\ne 3"), { x: 4 }), 1);
});

test("fromLatex round-trips bare LaTeX '=' as eq", () => {
  const parsed = Symbolic.fromLatex("x = 3");
  assert.equal(Symbolic.evaluate(parsed, { x: 3 }), 1);
  assert.equal(Symbolic.evaluate(parsed, { x: 4 }), 0);
});

test("toLatex/fromLatex round-trips piecewise via \\begin{cases}", () => {
  const expr = Symbolic.parse("piecewise(x<0, x^2, x^3)");
  const latex = Symbolic.toLatex(expr);
  assert.ok(latex.includes("\\begin{cases}"));
  assert.ok(latex.includes("\\text{otherwise}"));
  const roundTripped = Symbolic.fromLatex(latex);
  for (const x of [-2, 0, 3]) {
    assert.equal(Symbolic.evaluate(roundTripped, { x }), Symbolic.evaluate(expr, { x }));
  }
});

test("substitute/expand/collectLikeTerms recurse into cmp and piecewise", () => {
  const substituted = Symbolic.substitute("piecewise(x<0, x, -x)", "x", "y+1");
  assert.equal(Symbolic.evaluate(substituted, { y: -3 }), -2); // x=y+1=-2, x<0, so result=x=-2
  assert.equal(Symbolic.evaluate(substituted, { y: 3 }), -4); // x=y+1=4, x>=0, so result=-x=-4

  const expanded = Symbolic.expand("piecewise(x<0, (x+1)^2, x)");
  assert.equal(Symbolic.evaluate(expanded, { x: -2 }), 1); // (-2+1)^2 = 1

  const collected = Symbolic.simplify("piecewise(x<0, x+x, x)");
  assert.equal(Symbolic.evaluate(collected, { x: -3 }), -6); // x+x collected to 2x = -6
});

test("integrate treats cmp/piecewise not containing the integration variable as constant, and throws otherwise", () => {
  // no "x" anywhere in the piecewise -- treated as a constant multiplier
  const F = Symbolic.integrate("piecewise(k<0, 1, 2)", "x");
  assert.ok(Math.abs(Symbolic.evaluate(F, { x: 3, k: 5 }) - 6) < 1e-9); // 2*3
  assert.throws(() => Symbolic.integrate("x<3"));
});

test("taylor expansion of exp about 0", () => {
  // exp(x) ≈ 1 + x + x^2/2 + x^3/6 + x^4/24
  const t = Symbolic.taylor("exp(x)", "x", 0, 4);
  assert.ok(Math.abs(Symbolic.evaluate(t, { x: 1 }) - (1 + 1 + 0.5 + 1 / 6 + 1 / 24)) < 1e-12);
  void evalAt;
});

test("compile matches evaluate across expression shapes", () => {
  const cases: Array<[string, Record<string, number>]> = [
    ["2 + 3*4", {}],
    ["2^3^2", {}],
    ["sin(pi/2)", {}],
    ["x^2 + 1", { x: 3 }],
    ["sin(x^2) + 2*x - 1", { x: 1.7 }],
    ["-x / (y + 1)", { x: 4, y: 2 }],
    ["sqrt(x) + ln(x) + tan(x)", { x: 2.5 }],
  ];
  for (const [expr, env] of cases) {
    const compiled = Symbolic.compile(expr)(env);
    const evaluated = Symbolic.evaluate(expr, env);
    assert.ok(
      Math.abs(compiled - evaluated) < 1e-12 || (Number.isNaN(compiled) && Number.isNaN(evaluated)),
      `compile/evaluate mismatch for "${expr}": ${compiled} vs ${evaluated}`,
    );
  }
});

test("compile walks the AST once and can be reused across many envs", () => {
  const compiled = Symbolic.compile("x^2");
  assert.equal(compiled({ x: 3 }), 9);
  assert.equal(compiled({ x: 4 }), 16);
  assert.equal(compiled({ x: -2 }), 4);
});

test("differentiateSteps result matches differentiate", () => {
  const { result } = Symbolic.differentiateSteps("x^2 + 2*x + 1");
  assert.equal(Symbolic.toString(result), Symbolic.toString(Symbolic.differentiate("x^2 + 2*x + 1")));
});

test("differentiateSteps records one step per subexpression, innermost first", () => {
  const { steps } = Symbolic.differentiateSteps("x^2 + 3*x");
  const rules = steps.map((s) => s.rule);
  // x^2 and 3*x differentiate before the top-level sum combines them.
  assert.ok(rules.includes("Power Rule"));
  assert.ok(rules.includes("Product Rule"));
  assert.equal(rules[rules.length - 1], "Sum Rule");
});

test("differentiateSteps names the chain rule with the outer function", () => {
  const { steps } = Symbolic.differentiateSteps("sin(x^2)");
  const outer = steps[steps.length - 1];
  assert.equal(outer.rule, "Chain Rule (sin)");
  assert.equal(Symbolic.toString(outer.input), "sin(x^2)");
});

test("differentiateSteps on a bare constant/variable records a single leaf step", () => {
  const constSteps = Symbolic.differentiateSteps("5").steps;
  assert.equal(constSteps.length, 1);
  assert.equal(constSteps[0].rule, "Constant Rule");

  const varSteps = Symbolic.differentiateSteps("x").steps;
  assert.equal(varSteps.length, 1);
  assert.equal(varSteps[0].rule, "Variable Rule");
});

test("differentiate inverse trig and hyperbolic functions", () => {
  const cases: Array<[string, (x: number) => number]> = [
    ["asin(x)", (x) => 1 / Math.sqrt(1 - x * x)],
    ["acos(x)", (x) => -1 / Math.sqrt(1 - x * x)],
    ["atan(x)", (x) => 1 / (1 + x * x)],
    ["sinh(x)", (x) => Math.cosh(x)],
    ["cosh(x)", (x) => Math.sinh(x)],
    ["tanh(x)", (x) => 1 / Math.cosh(x) ** 2],
  ];
  for (const [expr, expected] of cases) {
    const d = Symbolic.differentiate(expr);
    assert.ok(Math.abs(Symbolic.evaluate(d, { x: 0.4 }) - expected(0.4)) < 1e-9, expr);
  }
});

test("evaluate and compile agree on the new elementary functions", () => {
  for (const expr of ["asin(x)", "acos(x)", "atan(x)", "sinh(x)", "cosh(x)", "tanh(x)"]) {
    const evaluated = Symbolic.evaluate(expr, { x: 0.3 });
    const compiled = Symbolic.compile(expr)({ x: 0.3 });
    assert.ok(Math.abs(evaluated - compiled) < 1e-12, expr);
  }
});

test("parses arcsin/arccos/arctan/arcsinh/arccosh/arctanh as aliases", () => {
  for (const [alias, canonical] of [
    ["arcsin", "asin"],
    ["arccos", "acos"],
    ["arctan", "atan"],
    ["arcsinh", "asinh"],
    ["arccosh", "acosh"],
    ["arctanh", "atanh"],
  ] as const) {
    assert.equal(
      Symbolic.toString(Symbolic.parse(`${alias}(x)`)),
      Symbolic.toString(Symbolic.parse(`${canonical}(x)`)),
    );
  }
});

test("evaluates reciprocal-trig and reciprocal/inverse-hyperbolic functions", () => {
  const cases: Array<[string, (x: number) => number]> = [
    ["cot(x)", (x) => 1 / Math.tan(x)],
    ["sec(x)", (x) => 1 / Math.cos(x)],
    ["csc(x)", (x) => 1 / Math.sin(x)],
    ["asinh(x)", (x) => Math.asinh(x)],
    ["acosh(x)", (x) => Math.acosh(x)],
    ["atanh(x)", (x) => Math.atanh(x)],
    ["coth(x)", (x) => 1 / Math.tanh(x)],
    ["sech(x)", (x) => 1 / Math.cosh(x)],
    ["csch(x)", (x) => 1 / Math.sinh(x)],
  ];
  for (const [expr, fn] of cases) {
    const x = expr === "acosh(x)" ? 2 : 0.7;
    assert.ok(Math.abs(evalAt(expr, x) - fn(x)) < 1e-9, expr);
    assert.ok(Math.abs(Symbolic.compile(expr)({ x }) - fn(x)) < 1e-9, `compile ${expr}`);
  }
});

test("differentiate reciprocal-trig and reciprocal/inverse-hyperbolic functions", () => {
  const cases: Array<[string, (x: number) => number]> = [
    ["cot(x)", (x) => -1 / Math.sin(x) ** 2],
    ["sec(x)", (x) => (1 / Math.cos(x)) * Math.tan(x)],
    ["csc(x)", (x) => -(1 / Math.sin(x)) * (1 / Math.tan(x))],
    ["asinh(x)", (x) => 1 / Math.sqrt(x * x + 1)],
    ["acosh(x)", (x) => 1 / Math.sqrt(x * x - 1)],
    ["atanh(x)", (x) => 1 / (1 - x * x)],
    ["coth(x)", (x) => -1 / Math.sinh(x) ** 2],
    ["sech(x)", (x) => -(1 / Math.cosh(x)) * Math.tanh(x)],
    ["csch(x)", (x) => -(1 / Math.sinh(x)) * (1 / Math.tanh(x))],
  ];
  for (const [expr, expected] of cases) {
    const x = expr === "acosh(x)" ? 2 : 0.4;
    const d = Symbolic.differentiate(expr);
    assert.ok(Math.abs(Symbolic.evaluate(d, { x }) - expected(x)) < 1e-9, expr);
  }
});

test("evaluates and differentiates inverse-reciprocal-trig/hyperbolic functions", () => {
  const cases: Array<[string, (x: number) => number, (x: number) => number]> = [
    ["acot(x)", (x) => Math.PI / 2 - Math.atan(x), (x) => -1 / (1 + x * x)],
    ["asec(x)", (x) => Math.acos(1 / x), (x) => 1 / (Math.abs(x) * Math.sqrt(x * x - 1))],
    ["acsc(x)", (x) => Math.asin(1 / x), (x) => -1 / (Math.abs(x) * Math.sqrt(x * x - 1))],
    ["acoth(x)", (x) => Math.atanh(1 / x), (x) => 1 / (1 - x * x)],
    ["asech(x)", (x) => Math.acosh(1 / x), (x) => -1 / (x * Math.sqrt(1 - x * x))],
    ["acsch(x)", (x) => Math.asinh(1 / x), (x) => -1 / (Math.abs(x) * Math.sqrt(1 + x * x))],
  ];
  for (const [expr, fn, dfn] of cases) {
    const x = expr === "asech(x)" ? 0.5 : 2;
    assert.ok(Math.abs(evalAt(expr, x) - fn(x)) < 1e-9, expr);
    assert.ok(Math.abs(Symbolic.compile(expr)({ x }) - fn(x)) < 1e-9, `compile ${expr}`);
    const d = Symbolic.differentiate(expr);
    assert.ok(Math.abs(Symbolic.evaluate(d, { x }) - dfn(x)) < 1e-9, `d/dx ${expr}`);
  }
});

test("evaluates and differentiates abs/log10/log2/cbrt/floor/ceil/round/sign", () => {
  assert.equal(evalAt("abs(x)", -3), 3);
  assert.equal(Symbolic.evaluate(Symbolic.differentiate("abs(x)"), { x: -3 }), -1);
  assert.equal(Symbolic.evaluate(Symbolic.differentiate("abs(x)"), { x: 3 }), 1);

  assert.ok(Math.abs(evalAt("log10(x)", 1000) - 3) < 1e-9);
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate("log10(x)"), { x: 2 }) - 1 / (2 * Math.LN10)) < 1e-9);

  assert.ok(Math.abs(evalAt("log2(x)", 8) - 3) < 1e-9);
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate("log2(x)"), { x: 2 }) - 1 / (2 * Math.LN2)) < 1e-9);

  assert.equal(evalAt("cbrt(x)", -8), -2);
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate("cbrt(x)"), { x: 8 }) - 1 / (3 * 8 ** (2 / 3))) < 1e-6);

  for (const [name, fn] of [
    ["floor", Math.floor],
    ["ceil", Math.ceil],
    ["round", Math.round],
    ["sign", Math.sign],
  ] as const) {
    assert.equal(evalAt(`${name}(x)`, 2.6), fn(2.6));
    assert.equal(Symbolic.evaluate(Symbolic.differentiate(`${name}(x)`), { x: 2.6 }), 0);
  }
});

test("evaluates and differentiates trunc/expm1/log1p/sigmoid/erf/relu", () => {
  assert.equal(evalAt("trunc(x)", -2.7), Math.trunc(-2.7));
  assert.equal(Symbolic.evaluate(Symbolic.differentiate("trunc(x)"), { x: 2.6 }), 0);

  assert.ok(Math.abs(evalAt("expm1(x)", 1) - Math.expm1(1)) < 1e-12);
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate("expm1(x)"), { x: 0.4 }) - Math.exp(0.4)) < 1e-9);

  assert.ok(Math.abs(evalAt("log1p(x)", 1) - Math.log1p(1)) < 1e-12);
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate("log1p(x)"), { x: 0.4 }) - 1 / 1.4) < 1e-9);

  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  assert.ok(Math.abs(evalAt("sigmoid(x)", 0) - 0.5) < 1e-12);
  assert.ok(
    Math.abs(Symbolic.evaluate(Symbolic.differentiate("sigmoid(x)"), { x: 0.4 }) - sigmoid(0.4) * (1 - sigmoid(0.4))) <
      1e-9,
  );
  assert.equal(
    JSON.stringify(Symbolic.parse("logistic(x)")),
    JSON.stringify(Symbolic.parse("sigmoid(x)")),
    "logistic is an alias for sigmoid",
  );

  assert.ok(Math.abs(evalAt("erf(x)", 1) - 0.8427007929497149) < 1e-6);
  assert.ok(
    Math.abs(
      Symbolic.evaluate(Symbolic.differentiate("erf(x)"), { x: 0.4 }) - (2 / Math.sqrt(Math.PI)) * Math.exp(-0.16),
    ) < 1e-9,
  );

  assert.equal(evalAt("relu(x)", -3), 0);
  assert.equal(evalAt("relu(x)", 3), 3);
  assert.equal(Symbolic.evaluate(Symbolic.differentiate("relu(x)"), { x: 3.2 }), 1);
  assert.equal(Symbolic.evaluate(Symbolic.differentiate("relu(x)"), { x: -3.2 }), 0);
});

test("toLatex/fromLatex round-trip abs/floor/ceil/log10/log2/cbrt and the new operatorname functions", () => {
  const barFloorCeilLog = [
    ["abs(x)", "\\left|x\\right|"],
    ["floor(x)", "\\left\\lfloor x\\right\\rfloor"],
    ["ceil(x)", "\\left\\lceil x\\right\\rceil"],
    ["log10(x)", "\\log_{10}\\left(x\\right)"],
    ["log2(x)", "\\log_{2}\\left(x\\right)"],
    ["cbrt(x)", "\\sqrt[3]{x}"],
  ];
  for (const [expr, expectedLatex] of barFloorCeilLog) {
    const latex = Symbolic.toLatex(expr);
    assert.equal(latex, expectedLatex, expr);
    assert.equal(JSON.stringify(Symbolic.fromLatex(latex)), JSON.stringify(Symbolic.parse(expr)), `round-trip ${expr}`);
  }

  for (const name of [
    "acot",
    "asec",
    "acsc",
    "acoth",
    "asech",
    "acsch",
    "round",
    "sign",
    "trunc",
    "expm1",
    "log1p",
    "sigmoid",
    "erf",
    "relu",
  ]) {
    const expr = `${name}(x)`;
    const latex = Symbolic.toLatex(expr);
    assert.ok(latex.startsWith("\\operatorname{"), `${expr} -> ${latex}`);
    assert.equal(JSON.stringify(Symbolic.fromLatex(latex)), JSON.stringify(Symbolic.parse(expr)), `round-trip ${expr}`);
  }
});

test("evaluates atan2/hypot/min/max/gcd/lcm, including N-ary folding for hypot/min/max/gcd/lcm", () => {
  assert.ok(Math.abs(Symbolic.evaluate("atan2(1,1)") - Math.atan2(1, 1)) < 1e-12);
  assert.ok(Math.abs(Symbolic.evaluate("atan2(-1,1)") - Math.atan2(-1, 1)) < 1e-12);
  assert.equal(Symbolic.evaluate("hypot(3,4)"), 5);
  assert.equal(Symbolic.evaluate("hypot(3,4,12)"), 13);
  assert.equal(Symbolic.evaluate("min(3,7)"), 3);
  assert.equal(Symbolic.evaluate("min(3,7,-2,5)"), -2);
  assert.equal(Symbolic.evaluate("max(3,7)"), 7);
  assert.equal(Symbolic.evaluate("max(3,7,-2,5)"), 7);
  assert.equal(Symbolic.evaluate("gcd(12,18)"), 6);
  assert.equal(Symbolic.evaluate("gcd(12,18,30)"), 6);
  assert.equal(Symbolic.evaluate("lcm(4,6)"), 12);
  assert.equal(Symbolic.evaluate("lcm(4,6,10)"), 60);

  assert.equal(
    JSON.stringify(Symbolic.parse("min(a,b,c,d)")),
    JSON.stringify(Symbolic.parse("min(min(min(a,b),c),d)")),
    "N-ary min folds pairwise, left to right",
  );
});

test("log(base, x) and clamp(x, lo, hi) desugar at parse time", () => {
  assert.equal(Symbolic.evaluate("log(2,8)"), 3);
  assert.equal(Symbolic.evaluate("log(10,100)"), 2);
  assert.equal(Symbolic.evaluate("clamp(5,0,10)"), 5);
  assert.equal(Symbolic.evaluate("clamp(-5,0,10)"), 0);
  assert.equal(Symbolic.evaluate("clamp(15,0,10)"), 10);
  assert.throws(() => Symbolic.parse("log(x)"), "log requires exactly 2 arguments");
  assert.throws(() => Symbolic.parse("clamp(x,0)"), "clamp requires exactly 3 arguments");
});

test("atan2 requires exactly 2 arguments; hypot/min/max/gcd/lcm require at least 2", () => {
  assert.throws(() => Symbolic.parse("atan2(x)"));
  assert.throws(() => Symbolic.parse("atan2(x,y,z)"));
  for (const name of ["hypot", "min", "max", "gcd", "lcm"]) {
    assert.throws(() => Symbolic.parse(`${name}(x)`), `${name} requires >= 2 arguments`);
  }
});

test("differentiates atan2/hypot/min/max via the multivariate chain rule; gcd/lcm are 0", () => {
  const numDeriv = (f: (x: number) => number, x0: number, h = 1e-6) => (f(x0 + h) - f(x0 - h)) / (2 * h);

  for (const [expr, at] of [
    ["atan2(x,3)", 2],
    ["atan2(3,x)", 2],
    ["hypot(x,4)", 3],
    ["min(x,5)", 2],
    ["min(x,5)", 8],
    ["max(x,5)", 2],
    ["max(x,5)", 8],
  ] as const) {
    const symbolic = Symbolic.evaluate(Symbolic.differentiate(expr), { x: at });
    const numeric = numDeriv((x) => Symbolic.evaluate(expr, { x }), at);
    assert.ok(Math.abs(symbolic - numeric) < 1e-4, `d/dx ${expr} at x=${at}: ${symbolic} vs ${numeric}`);
  }

  assert.equal(Symbolic.evaluate(Symbolic.differentiate("gcd(x,6)"), { x: 10 }), 0);
  assert.equal(Symbolic.evaluate(Symbolic.differentiate("lcm(x,6)"), { x: 10 }), 0);
});

test("simplify constant-folds call2 nodes; substitute/expand recurse into them", () => {
  assert.equal(
    Symbolic.toString(Symbolic.simplify("min(3,7) + max(2,9) + gcd(12,18) + lcm(4,6) + hypot(3,4)")),
    `${3 + 9 + 6 + 12 + 5}`,
  );
  assert.equal(Symbolic.toString(Symbolic.substitute("hypot(x,y)", "x", "3")), "hypot(3, y)");
  assert.equal(
    Symbolic.toString(Symbolic.expand("hypot((x+1),y)")),
    Symbolic.toString(Symbolic.parse("hypot(x + 1, y)")),
  );
});

test("toLatex/fromLatex round-trip atan2/hypot/min/max/gcd/lcm", () => {
  const expectedLatex: [string, string][] = [
    ["atan2(x,y)", "\\operatorname{atan2}\\left(x, y\\right)"],
    ["hypot(x,y)", "\\operatorname{hypot}\\left(x, y\\right)"],
    ["min(x,y)", "\\min\\left(x, y\\right)"],
    ["max(x,y)", "\\max\\left(x, y\\right)"],
    ["gcd(x,y)", "\\gcd\\left(x, y\\right)"],
    ["lcm(x,y)", "\\operatorname{lcm}\\left(x, y\\right)"],
  ];
  for (const [expr, latex] of expectedLatex) {
    assert.equal(Symbolic.toLatex(expr), latex, expr);
    assert.equal(JSON.stringify(Symbolic.fromLatex(latex)), JSON.stringify(Symbolic.parse(expr)), `round-trip ${expr}`);
  }
});

test("integrate by parts", () => {
  // ∫ x sin(x) dx = sin(x) - x cos(x)
  const F = Symbolic.integrate("x*sin(x)");
  const check1 = (x: number) => Math.sin(x) - x * Math.cos(x);
  assert.ok(
    Math.abs(Symbolic.evaluate(F, { x: 1.2 }) - Symbolic.evaluate(F, { x: 0 }) - (check1(1.2) - check1(0))) < 1e-9,
  );
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate(F), { x: 0.7 }) - 0.7 * Math.sin(0.7)) < 1e-9);

  // ∫ x^2 exp(x) dx ; derivative recovers x^2 exp(x)
  const G = Symbolic.integrate("x^2*exp(x)");
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate(G), { x: 1.1 }) - 1.1 ** 2 * Math.exp(1.1)) < 1e-8);
});

test("integrate arctan/arcsin forms", () => {
  // ∫ 1/(1+x^2) dx = atan(x)
  const F = Symbolic.integrate("1/(1+x^2)");
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate(F), { x: 0.5 }) - 1 / (1 + 0.25)) < 1e-9);

  // ∫ 1/sqrt(1-x^2) dx = asin(x)
  const G = Symbolic.integrate("1/sqrt(1-x^2)");
  assert.ok(Math.abs(Symbolic.evaluate(Symbolic.differentiate(G), { x: 0.3 }) - 1 / Math.sqrt(1 - 0.09)) < 1e-9);
});

test("substitute replaces a variable with an expression", () => {
  const result = Symbolic.substitute("x^2 + 1", "x", "y+1");
  assert.equal(Symbolic.evaluate(result, { y: 2 }), Symbolic.evaluate("x^2 + 1", { x: 3 }));
});

test("expand distributes products over sums", () => {
  assert.equal(Symbolic.toString(Symbolic.expand("(x+1)^2")), "x^2 + 2*x + 1");
  assert.equal(Symbolic.toString(Symbolic.expand("(x-1)*(x+1)")), "x^2 - 1");
});

test("simplify collects like terms", () => {
  assert.equal(Symbolic.toString(Symbolic.simplify("x + x")), "2*x");
  assert.equal(Symbolic.toString(Symbolic.simplify("x*x")), "x^2");
  assert.equal(Symbolic.toString(Symbolic.simplify("a*b + b*a")), "2*(a*b)");
  assert.equal(Symbolic.toString(Symbolic.simplify("2*x - x")), "x");
  assert.equal(Symbolic.toString(Symbolic.simplify("x + 2*x + 3")), "3*x + 3");
});

test("solve finds real roots of linear, quadratic, and higher-degree polynomials", () => {
  const rootsOf = (expr: string) =>
    Symbolic.solve(expr)
      .map((e) => Symbolic.evaluate(e))
      .sort((a, b) => a - b);
  assert.deepEqual(rootsOf("x - 3"), [3]);
  assert.deepEqual(rootsOf("x^2 - 5*x + 6"), [2, 3]);
  assert.deepEqual(rootsOf("x^3 - 6*x^2 + 11*x - 6"), [1, 2, 3]);
  // no real roots
  assert.deepEqual(Symbolic.solve("x^2 + 1"), []);
});

test("solve verifies every root actually zeroes the polynomial", () => {
  for (const expr of ["x^2 - 2*x - 3", "2*x^2 - 3*x - 2", "x^3 - 6*x^2 + 11*x - 6"]) {
    for (const root of Symbolic.solve(expr)) {
      const value = Symbolic.evaluate(expr, { x: Symbolic.evaluate(root) });
      assert.ok(Math.abs(value) < 1e-6, `${expr} at root ${Symbolic.toString(root)}`);
    }
  }
});

test("solve rejects non-polynomial expressions", () => {
  assert.throws(() => Symbolic.solve("sin(x)"));
});

test("factor extracts linear factors and common terms", () => {
  const productAt = (expr: string, x: number) => Symbolic.evaluate(expr, { x });
  for (const expr of ["x^2 - 1", "x^2 - 5*x + 6", "2*x^2 + 4*x", "x^3 - 6*x^2 + 11*x - 6"]) {
    const factored = Symbolic.factor(expr);
    for (const x of [0.3, 1.7, -2.2]) {
      assert.ok(Math.abs(productAt(Symbolic.toString(factored), x) - productAt(expr, x)) < 1e-8, expr);
    }
  }
});

test("factor returns the simplified expression unchanged when not a polynomial", () => {
  assert.equal(Symbolic.toString(Symbolic.factor("sin(x)")), "sin(x)");
});

test("limit evaluates removable discontinuities via L'Hopital's rule", () => {
  assert.ok(Math.abs(Symbolic.limit("sin(x)/x", "x", 0) - 1) < 1e-6);
  assert.ok(Math.abs(Symbolic.limit("(x^2-1)/(x-1)", "x", 1) - 2) < 1e-6);
});

test("limit respects one-sided direction", () => {
  assert.ok(Symbolic.limit("1/x", "x", 0, "right") > 0);
  assert.ok(Symbolic.limit("1/x", "x", 0, "left") < 0);
});

test("limit at infinity resolves rational-function limits requiring multiple L'Hopital rounds without blowing up", () => {
  // Regression test: limitAt used to grow the expression tree without bound
  // across successive L'Hopital differentiations (no simplify() between
  // rounds), causing an OOM crash on any limit-at-infinity needing more than
  // ~2 rounds. Fixed by simplifying df/dg before each recursive step.
  assert.ok(Math.abs(Symbolic.limit("(x^2+1)/(2*x^2-3)", "x", Number.POSITIVE_INFINITY) - 0.5) < 1e-6);
  assert.ok(Math.abs(Symbolic.limit("1/x", "x", Number.POSITIVE_INFINITY)) < 1e-6);
  assert.ok(Math.abs(Symbolic.limit("exp(-x)", "x", Number.POSITIVE_INFINITY)) < 1e-6);
});

test("toLatex renders fractions, radicals, and named functions", () => {
  assert.equal(Symbolic.toLatex("x^2/2"), "\\frac{x^{2}}{2}");
  assert.equal(Symbolic.toLatex("sqrt(x+1)"), "\\sqrt{x + 1}");
  assert.equal(Symbolic.toLatex("sin(x)/cos(x)"), "\\frac{\\sin\\left(x\\right)}{\\cos\\left(x\\right)}");
});

test("fromLatex round-trips everything toLatex produces", () => {
  for (const src of [
    "x^2/2",
    "sqrt(x+1)",
    "sin(x)/cos(x)",
    "a*b + c",
    "x^2 - 5*x + 6",
    "sinh(x) + cosh(x)",
    "cot(x) + sec(x) + csc(x)",
    "sech(x) + csch(x) + coth(x)",
    "asinh(x) + acosh(x) + atanh(x)",
  ]) {
    const roundTripped = Symbolic.toString(Symbolic.fromLatex(Symbolic.toLatex(src)));
    assert.equal(roundTripped, Symbolic.toString(Symbolic.parse(src)));
  }
});

test("toLatex/fromLatex use \\operatorname for functions with no standard LaTeX command", () => {
  assert.equal(Symbolic.toLatex("sech(x)"), "\\operatorname{sech}\\left(x\\right)");
  assert.equal(Symbolic.toLatex("csch(x)"), "\\operatorname{csch}\\left(x\\right)");
  assert.equal(Symbolic.toLatex("asinh(x)"), "\\operatorname{arcsinh}\\left(x\\right)");
  assert.equal(Symbolic.toLatex("acosh(x)"), "\\operatorname{arccosh}\\left(x\\right)");
  assert.equal(Symbolic.toLatex("atanh(x)"), "\\operatorname{arctanh}\\left(x\\right)");
  assert.equal(Symbolic.toString(Symbolic.fromLatex("\\operatorname{sech}(x)")), "sech(x)");
  assert.throws(() => Symbolic.fromLatex("\\operatorname{bogus}(x)"));
});

test("fromLatex parses fractions, radicals, and named function commands", () => {
  assert.equal(Symbolic.toString(Symbolic.fromLatex("\\frac{a}{b}")), "a/b");
  assert.equal(Symbolic.toString(Symbolic.fromLatex("\\sqrt{x+1}")), "sqrt(x + 1)");
  assert.equal(Symbolic.toString(Symbolic.fromLatex("\\sin\\left(x\\right)")), "sin(x)");
  assert.equal(Symbolic.toString(Symbolic.fromLatex("\\arcsin(x)")), "asin(x)");
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("\\sqrt[3]{x}"), { x: 8 }), 2);
});

test("fromLatex handles \\cdot/\\times, \\pi, braced exponents, and subscripts", () => {
  assert.equal(Symbolic.toString(Symbolic.fromLatex("2 \\cdot x + 3 \\times y")), "2*x + 3*y");
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("\\pi \\cdot x"), { x: 1 }), Math.PI);
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("\\frac{x^{2}}{2}"), { x: 4 }), 8);
  assert.equal(Symbolic.toString(Symbolic.fromLatex("x^{2} + y_{1}")), "x^2 + y_1");
});

test("fromLatex throws on constructs with no Expr equivalent", () => {
  assert.throws(() => Symbolic.fromLatex("\\int_0^1 x\\,dx"));
  assert.throws(() => Symbolic.fromLatex("\\sum_{i=1}^n i"));
});

test("fromLatex parses bar notation, floor/ceil, and log with subscript base", () => {
  assert.equal(Symbolic.toString(Symbolic.fromLatex("\\left|x\\right|")), "abs(x)");
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("\\left|x\\right|"), { x: -3 }), 3);
  assert.equal(Symbolic.toString(Symbolic.fromLatex("\\left\\lfloor x\\right\\rfloor")), "floor(x)");
  assert.equal(Symbolic.toString(Symbolic.fromLatex("\\left\\lceil x\\right\\rceil")), "ceil(x)");
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("\\log_{2}(x)"), { x: 8 }), 3);
  assert.equal(Symbolic.evaluate(Symbolic.fromLatex("\\log(x)"), { x: 100 }), 2);
});

test("evaluateExact evaluates a plain fraction exactly", () => {
  assert.equal(Symbolic.evaluateExact("1/3").toString(), "1/3");
});

test("evaluateExact evaluates an expression with a bound exact variable", () => {
  assert.equal(Symbolic.evaluateExact("x+1/2", { x: new Rational(1n, 2n) }).toString(), "1");
});

test("evaluateExact evaluates integer powers exactly", () => {
  assert.equal(Symbolic.evaluateExact("(1/2)^3").toString(), "1/8");
});

test("evaluateExact evaluates negation exactly", () => {
  assert.equal(Symbolic.evaluateExact("-1/4").toString(), "-1/4");
});

test("evaluateExact throws on an irrational function node or non-integer exponent", () => {
  assert.throws(() => Symbolic.evaluateExact("sin(1)"));
  assert.throws(() => Symbolic.evaluateExact("2^(1/2)"));
  assert.throws(() => Symbolic.evaluateExact("x+1"));
});

test("evaluateExact evaluates cmp exactly to 1/0 and piecewise selects the first nonzero branch", () => {
  assert.equal(Symbolic.evaluateExact("1/3<1/2").toString(), "1");
  assert.equal(Symbolic.evaluateExact("1/2<1/3").toString(), "0");
  assert.equal(Symbolic.evaluateExact("piecewise(1/2<1/3, 1/2, 2/3)").toString(), "2/3");
  assert.throws(() => Symbolic.evaluateExact("piecewise(1<2, sin(1), 1/2)"));
});

test("evaluateOverStructure evaluates arithmetic over Z/7Z", () => {
  const gf7 = Structure.integersModulo(7);
  assert.equal(Symbolic.evaluateOverStructure("3+5", gf7), 1); // 8 mod 7
  assert.equal(Symbolic.evaluateOverStructure("x^2+1", gf7, { x: 5 }), 5); // 26 mod 7
  assert.equal(Symbolic.evaluateOverStructure("-3", gf7), 4); // -3 mod 7
  assert.equal(Symbolic.evaluateOverStructure("1/3", gf7), 5); // 3*5=15=1 mod 7
});

test("evaluateOverStructure throws on func/call2/non-integer-exponent pow/unbound var", () => {
  const gf7 = Structure.integersModulo(7);
  assert.throws(() => Symbolic.evaluateOverStructure("sin(1)", gf7));
  assert.throws(() => Symbolic.evaluateOverStructure("x^(1/2)", gf7, { x: 2 }));
  assert.throws(() => Symbolic.evaluateOverStructure("x+1", gf7));
});

test("evaluateOverStructure: eq/ne use the structure's own equality, ordering comparisons throw", () => {
  const gf7 = Structure.integersModulo(7);
  assert.equal(Symbolic.evaluateOverStructure("3==10", gf7), 1); // 3 mod 7 == 10 mod 7
  assert.equal(Symbolic.evaluateOverStructure("3!=10", gf7), 0);
  assert.throws(() => Symbolic.evaluateOverStructure("3<4", gf7));
});

test("evaluateOverStructure: piecewise branch selection uses structure.zero-equality", () => {
  const gf7 = Structure.integersModulo(7);
  assert.equal(Symbolic.evaluateOverStructure("piecewise(3==10, 5, 2)", gf7), 5);
  assert.equal(Symbolic.evaluateOverStructure("piecewise(3==4, 5, 2)", gf7), 2);
});

test("freeVariables collects every distinct variable name, sorted, deduplicated", () => {
  assert.deepEqual(Symbolic.freeVariables("a*x + b"), ["a", "b", "x"]);
  assert.deepEqual(Symbolic.freeVariables("x^2 + x"), ["x"]);
  assert.deepEqual(Symbolic.freeVariables("piecewise(x<0, -x, y)"), ["x", "y"]);
  assert.deepEqual(Symbolic.freeVariables("5"), []);
  assert.deepEqual(Symbolic.freeVariables("atan2(x, y)"), ["x", "y"]); // call2, exercises the default left/right branch
});

test("assertVariables throws UndeclaredVariableError listing offending names, passes when fully declared", () => {
  assert.throws(
    () => Symbolic.assertVariables("a*sin(x)", ["x"]),
    (err: unknown) => err instanceof UndeclaredVariableError && err.names.length === 1 && err.names[0] === "a",
  );
  assert.doesNotThrow(() => Symbolic.assertVariables("a*sin(x)", ["a", "x"]));
  assert.doesNotThrow(() => Symbolic.assertVariables("a*sin(x)", ["a", "x", "z"]), "extra declared names are fine");
});

test("evaluate/compile with declaredVariables: strict mode throws on an undeclared reference instead of silently producing NaN", () => {
  assert.throws(() => Symbolic.evaluate("a*x", { x: 2 }, { declaredVariables: ["x"] }), UndeclaredVariableError);
  assert.throws(() => Symbolic.compile("a*x", { declaredVariables: ["x"] }), UndeclaredVariableError);
  // Default (no options) behavior is unchanged: missing env entries silently resolve to NaN.
  assert.ok(Number.isNaN(Symbolic.evaluate("a*x", { x: 2 })));
  assert.equal(Symbolic.evaluate("a*x", { x: 2, a: 3 }, { declaredVariables: ["a", "x"] }), 6);
});

test("solveSystemNumeric solves a genuinely nonlinear system (circle x^2+y^2=25 meets line x-y=1)", () => {
  const result = Symbolic.solveSystemNumeric(["x^2+y^2-25", "x-y-1"], ["x", "y"], [4, 3]);
  // Exact intersection points: x-y=1 -> x=y+1; (y+1)^2+y^2=25 -> 2y^2+2y-24=0 -> y=3 or y=-4.
  // Starting near (4,3) should converge to (4,3).
  assert.ok(Math.abs(result.x - 4) < 1e-6);
  assert.ok(Math.abs(result.y - 3) < 1e-6);
  // Verify by substitution, not just proximity to the expected point.
  assert.ok(Math.abs(result.x ** 2 + result.y ** 2 - 25) < 1e-6);
  assert.ok(Math.abs(result.x - result.y - 1) < 1e-6);
});

test("solveSystemNumeric also solves a plain linear system (Newton reduces to one step)", () => {
  const result = Symbolic.solveSystemNumeric(["2*x + y - 5", "x - y - 1"], ["x", "y"]);
  assert.ok(Math.abs(result.x - 2) < 1e-9);
  assert.ok(Math.abs(result.y - 1) < 1e-9);
});

test("solveSystemNumeric solves a 3-variable nonlinear system", () => {
  // x=1, y=2, z=3 is the unique nearby root (nonsingular Jacobian there, verified
  // separately) of this triangular-chained system: x -> y via eq1, y -> z via
  // eq2, x&z tied together independently via eq3.
  const result = Symbolic.solveSystemNumeric(["x^2+y-3", "y^2-z-1", "x+z-4"], ["x", "y", "z"], [1.1, 1.9, 3.0]);
  assert.ok(Math.abs(result.x - 1) < 1e-6);
  assert.ok(Math.abs(result.y - 2) < 1e-6);
  assert.ok(Math.abs(result.z - 3) < 1e-6);
  // Verify by substitution, not just proximity to the expected point.
  assert.ok(Math.abs(result.x ** 2 + result.y - 3) < 1e-6);
  assert.ok(Math.abs(result.y ** 2 - result.z - 1) < 1e-6);
  assert.ok(Math.abs(result.x + result.z - 4) < 1e-6);
});

test("solveSystemNumeric throws SystemDidNotConvergeError for a system with no real solution", () => {
  assert.throws(() => Symbolic.solveSystemNumeric(["x^2+1"], ["x"]), SystemDidNotConvergeError);
});

test("solveSystemNumeric's damped step converges on the classic Newton-divergence case (atan(x)=0 from a distant guess)", () => {
  // Plain undamped Newton on atan(x) diverges/oscillates without bound from
  // any |x0| > ~1.39 (a textbook chaotic-Newton example) -- the backtracking
  // line search is what keeps this convergent instead.
  const result = Symbolic.solveSystemNumeric(["atan(x)"], ["x"], [2]);
  assert.ok(Math.abs(result.x) < 1e-6);
});

test("solveSystemNumeric rejects a non-square system", () => {
  assert.throws(() => Symbolic.solveSystemNumeric(["x + y - 1"], ["x", "y"]));
});

test("verifySolution accepts a genuine root and rejects a wrong candidate", () => {
  assert.ok(Symbolic.verifySolution("x^2-4", "x", 2));
  assert.ok(Symbolic.verifySolution("x^2-4", "x", -2));
  assert.ok(!Symbolic.verifySolution("x^2-4", "x", 3));
});

test("verifySolution honors env for free constants alongside the solved variable", () => {
  assert.ok(Symbolic.verifySolution("k*x-6", "x", 2, { k: 3 }));
  assert.ok(!Symbolic.verifySolution("k*x-6", "x", 2, { k: 4 }));
});

test("verifySystemSolution requires every equation to zero out, not just one", () => {
  const goodSolution = { x: 2, y: 1 };
  assert.ok(Symbolic.verifySystemSolution(["2*x + y - 5", "x - y - 1"], goodSolution));
  assert.ok(!Symbolic.verifySystemSolution(["2*x + y - 5", "x - y - 1"], { x: 2, y: 2 }));
});

test("simplifyAssuming reduces sqrt(x^2) to x when x is assumed positive/nonnegative", () => {
  assert.equal(Symbolic.toString(Symbolic.simplifyAssuming("sqrt(x^2)", { x: "positive" })), "x");
  assert.equal(Symbolic.toString(Symbolic.simplifyAssuming("sqrt(x^2)", { x: "nonnegative" })), "x");
});

test("simplifyAssuming reduces sqrt(x^2) to -x when x is assumed negative/nonpositive", () => {
  assert.equal(Symbolic.toString(Symbolic.simplifyAssuming("sqrt(x^2)", { x: "negative" })), "-x");
  assert.equal(Symbolic.toString(Symbolic.simplifyAssuming("sqrt(x^2)", { x: "nonpositive" })), "-x");
});

test("simplifyAssuming leaves sqrt(x^2) unchanged with no assumption (matches plain simplify)", () => {
  assert.equal(
    Symbolic.toString(Symbolic.simplifyAssuming("sqrt(x^2)", {})),
    Symbolic.toString(Symbolic.simplify("sqrt(x^2)")),
  );
});

test("simplifyAssuming reduces abs(x) to x or -x per the sign assumption", () => {
  assert.equal(Symbolic.toString(Symbolic.simplifyAssuming("abs(x)", { x: "positive" })), "x");
  assert.equal(Symbolic.toString(Symbolic.simplifyAssuming("abs(x)", { x: "negative" })), "-x");
});

test("simplifyAssuming applies its rewrite inside a larger expression, then re-simplifies", () => {
  // sqrt(x^2) + 3*x -> x + 3*x -> 4*x, once x is assumed positive.
  assert.equal(Symbolic.evaluate(Symbolic.simplifyAssuming("sqrt(x^2) + 3*x", { x: "positive" }), { x: 2 }), 8);
});

test("simplifyAssuming does not affect unrelated variables", () => {
  assert.equal(
    Symbolic.toString(Symbolic.simplifyAssuming("sqrt(y^2)", { x: "positive" })),
    Symbolic.toString(Symbolic.simplify("sqrt(y^2)")),
  );
});

test("solveOdeClosedForm solves a separable ODE (dy/dx = x*y, y(0)=1 -> y = e^(x^2/2))", () => {
  const r = Symbolic.solveOdeClosedForm("x*y", 0, 1);
  assert.equal(r.explicit, true);
  assert.ok(r.y);
  for (const x of [0, 0.5, 1, 2]) {
    assert.ok(
      Math.abs(Symbolic.evaluate(r.y as Parameters<typeof Symbolic.evaluate>[0], { x }) - Math.exp((x * x) / 2)) < 1e-9,
    );
  }
});

test("solveOdeClosedForm solves a trivial separable ODE (dy/dx = x, h(y)=1 degenerate case)", () => {
  const r = Symbolic.solveOdeClosedForm("x", 0, 5);
  assert.equal(r.explicit, true);
  assert.ok(r.y);
  assert.equal(Symbolic.evaluate(r.y as Parameters<typeof Symbolic.evaluate>[0], { x: 2 }), 7);
});

test("solveOdeClosedForm solves a linear first-order ODE via integrating factor (dy/dx + y = x, y(0)=1)", () => {
  // dy/dx = x - y; exact solution y = x - 1 + 2*e^-x
  const r = Symbolic.solveOdeClosedForm("x - y", 0, 1);
  assert.equal(r.explicit, true);
  assert.ok(r.y);
  for (const x of [0, 0.5, 1, 2]) {
    const expected = x - 1 + 2 * Math.exp(-x);
    assert.ok(Math.abs(Symbolic.evaluate(r.y as Parameters<typeof Symbolic.evaluate>[0], { x }) - expected) < 1e-9);
  }
});

test("solveOdeClosedForm throws NotSeparableError for a Riccati-type equation (dy/dx = x + y^2)", () => {
  assert.throws(() => Symbolic.solveOdeClosedForm("x + y^2", 0, 1), NotSeparableError);
});

test("solveOdeClosedForm throws NoClosedFormError when separable structure matches but exp(x^2) isn't in integRules's coverage", () => {
  assert.throws(() => Symbolic.solveOdeClosedForm("exp(x^2)*y", 0, 1), NoClosedFormError);
});

test("solveOdeClosedForm throws NoClosedFormError when linear structure matches but p(x)=exp(x^2) isn't in integRules's coverage", () => {
  assert.throws(() => Symbolic.solveOdeClosedForm("1 - exp(x^2)*y", 0, 1), NoClosedFormError);
});

test("solveOdeClosedForm solves a homogeneous ODE via y=v*x substitution (dy/dx = (x+y)/x, y(1)=3 -> y = x*(ln(x)+3))", () => {
  // Cross-checked independently against a from-scratch RK4 numeric
  // integration of the original ODE (not just re-derived by hand), since
  // the log-derivative/back-substitution bookkeeping here is easy to get
  // subtly wrong in a way a single hand derivation wouldn't catch.
  const r = Symbolic.solveOdeClosedForm("(x+y)/x", 1, 3);
  assert.equal(r.explicit, true);
  assert.ok(r.y);
  for (const x of [1, 2, 3, 5]) {
    const expected = x * (Math.log(x) + 3);
    assert.ok(Math.abs(Symbolic.evaluate(r.y as Parameters<typeof Symbolic.evaluate>[0], { x }) - expected) < 1e-6);
  }
});

test("solveOdeClosedForm does not false-positive the homogeneous check on a non-homogeneous equation", () => {
  // (x+y^2)/x substituted with y=v*x gives (x+v^2x^2)/x = 1+v^2*x, which
  // still depends on x -- the homogeneous probe-point check must catch
  // this and return null rather than false-positively matching.
  assert.throws(() => Symbolic.solveOdeClosedForm("(x+y^2)/x", 1, 1), NotSeparableError);
});

test("solveOdeClosedForm solves a Bernoulli ODE via w=y^(1-n) substitution (dy/dx = x*y^2 - y, y(0)=1)", () => {
  // Cross-checked against a from-scratch RK4 numeric integration of the
  // original ODE, not a hand-derived closed form -- the symbolic result
  // this produces is an ugly but correct un-simplified expression (a
  // pre-existing Symbolic.simplify limitation around nested fraction
  // constants, unrelated to the Bernoulli logic itself), so a numeric
  // cross-check is the right verification tool here, not a symbolic-form
  // comparison.
  const r = Symbolic.solveOdeClosedForm("x*y^2 - y", 0, 1);
  assert.equal(r.explicit, true);
  assert.ok(r.y);
  function rk4(f: (x: number, y: number) => number, x0: number, y0: number, xEnd: number, steps: number): number {
    let x = x0;
    let y = y0;
    const h = (xEnd - x0) / steps;
    for (let i = 0; i < steps; i++) {
      const k1 = f(x, y);
      const k2 = f(x + h / 2, y + (h / 2) * k1);
      const k3 = f(x + h / 2, y + (h / 2) * k2);
      const k4 = f(x + h, y + h * k3);
      y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      x += h;
    }
    return y;
  }
  const f = (x: number, y: number) => x * y * y - y;
  for (const x of [0, 0.3, 0.7, 1.2]) {
    const closed = Symbolic.evaluate(r.y as Parameters<typeof Symbolic.evaluate>[0], { x });
    const numeric = rk4(f, 0, 1, x, 5000);
    assert.ok(Math.abs(closed - numeric) < 1e-2);
  }
});

test("solveOdeClosedForm does not false-positive the Bernoulli check on a Riccati-type equation", () => {
  assert.throws(() => Symbolic.solveOdeClosedForm("x + y^2", 0, 1), NotSeparableError);
});

// -- solveOde2ndOrderConstCoeff -----------------------------------------

/** Checks a*y''+b*y'+c*y=0 numerically (finite-difference y'') and y(x0)=y0, y'(x0)=yPrime0. */
function checkSecondOrderOde(
  y: ReturnType<typeof Symbolic.parse>,
  a: number,
  b: number,
  c: number,
  x0: number,
  y0: number,
  yPrime0: number,
) {
  const yAt = (x: number) => Symbolic.evaluate(y, { x });
  const h = 1e-4;
  for (const x of [x0, x0 + 0.5, x0 + 1, x0 + 2]) {
    const yVal = yAt(x);
    const yPrime = (yAt(x + h) - yAt(x - h)) / (2 * h);
    const yDoublePrime = (yAt(x + h) - 2 * yAt(x) + yAt(x - h)) / (h * h);
    assert.ok(Math.abs(a * yDoublePrime + b * yPrime + c * yVal) < 1e-2, `ODE not satisfied at x=${x}`);
  }
  assert.ok(Math.abs(yAt(x0) - y0) < 1e-6, "y(x0) mismatch");
  const yPrimeAtX0 = (yAt(x0 + h) - yAt(x0 - h)) / (2 * h);
  assert.ok(Math.abs(yPrimeAtX0 - yPrime0) < 1e-3, "y'(x0) mismatch");
}

test("solveOde2ndOrderConstCoeff solves the real-distinct-roots case (y''-3y'+2y=0, y(0)=1, y'(0)=0)", () => {
  const y = Symbolic.solveOde2ndOrderConstCoeff(1, -3, 2, 0, 1, 0);
  checkSecondOrderOde(y, 1, -3, 2, 0, 1, 0);
});

test("solveOde2ndOrderConstCoeff solves the repeated-root case (y''-2y'+y=0, y(0)=1, y'(0)=0)", () => {
  const y = Symbolic.solveOde2ndOrderConstCoeff(1, -2, 1, 0, 1, 0);
  checkSecondOrderOde(y, 1, -2, 1, 0, 1, 0);
});

test("solveOde2ndOrderConstCoeff solves the complex-roots case (y''+y=0, y(0)=1, y'(0)=0 -> y=cos(x))", () => {
  const y = Symbolic.solveOde2ndOrderConstCoeff(1, 0, 1, 0, 1, 0);
  checkSecondOrderOde(y, 1, 0, 1, 0, 1, 0);
  for (const x of [0, 0.5, 1, 2]) {
    assert.ok(Math.abs(Symbolic.evaluate(y, { x }) - Math.cos(x)) < 1e-6);
  }
});

test("solveOde2ndOrderConstCoeff throws DegenerateOdeError when a === 0", () => {
  assert.throws(() => Symbolic.solveOde2ndOrderConstCoeff(0, 1, 1, 0, 1, 0), DegenerateOdeError);
});
