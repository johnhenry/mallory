import assert from "node:assert/strict";
import { test } from "node:test";
import { Numerical } from "../src/Numerical.ts";
import { NonLinearSystemError, SeriesDivergesError, SingularSystemError, Symbolic } from "../src/Symbolic.ts";

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

test("sumSeries throws (documented limitation) for a slowly-decaying but convergent series", () => {
  // Sum 1/n^2 genuinely converges to pi^2/6, but the term-magnitude stopping
  // rule isn't a valid tail-error proxy for polynomial decay, so this can't
  // confirm convergence within the term budget -- verified empirically, not
  // just theoretically. This is safe (never returns a wrong value) but
  // incomplete; see the KNOWN LIMITATION note in sumSeries's JSDoc.
  assert.throws(() => Symbolic.sumSeries("1/n^2", 1, Number.POSITIVE_INFINITY), SeriesDivergesError);
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
