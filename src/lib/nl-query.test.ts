import assert from "node:assert/strict";
import { test } from "node:test";
import { Symbolic } from "mallory-math";
import { resolveNaturalLanguageQuery } from "./nl-query.ts";

test("resolves 'derivative of' with implicit multiplication", () => {
  const source = resolveNaturalLanguageQuery("derivative of x^2 sin(x)");
  assert.ok(source);
  assert.equal(Symbolic.evaluate(source, { x: 1 }), Symbolic.evaluate(Symbolic.differentiate("x^2*sin(x)"), { x: 1 }));
});

test("resolves 'd/dx of'", () => {
  const source = resolveNaturalLanguageQuery("d/dx of x^3");
  assert.equal(source, "3*x^2");
});

test("resolves 'the derivative of'", () => {
  const source = resolveNaturalLanguageQuery("the derivative of x^2");
  assert.equal(source, "2*x");
});

test("resolves 'integral of' and 'antiderivative of'", () => {
  assert.equal(resolveNaturalLanguageQuery("integral of cos(x)"), "sin(x)");
  assert.equal(resolveNaturalLanguageQuery("antiderivative of cos(x)"), "sin(x)");
});

test("resolves 'simplify'", () => {
  assert.equal(resolveNaturalLanguageQuery("simplify x + 0"), "x");
});

test("returns null for a plain expression that matches no phrasing", () => {
  assert.equal(resolveNaturalLanguageQuery("x^2 + 1"), null);
});

test("returns null when the matched inner text fails to resolve", () => {
  // sin(x^2) has no elementary antiderivative -- Symbolic.integrate throws.
  assert.equal(resolveNaturalLanguageQuery("integral of sin(x^2)"), null);
});

test("resolves bounded 'integral of X from A to B' to a numeric value", () => {
  const source = resolveNaturalLanguageQuery("integral of x^2 from 0 to 1");
  assert.ok(source);
  assert.ok(Math.abs(Number(source) - 1 / 3) < 1e-9);
});

test("resolves bounded 'definite integral of X from A to B'", () => {
  const source = resolveNaturalLanguageQuery("definite integral of cos(x) from 0 to 1");
  assert.ok(source);
  assert.ok(Math.abs(Number(source) - Math.sin(1)) < 1e-9);
});

test("bare (unbounded) 'integral of' phrasing still matches after adding the bounded pattern first", () => {
  assert.equal(resolveNaturalLanguageQuery("integral of cos(x)"), "sin(x)");
});

test("resolves 'factor'", () => {
  const source = resolveNaturalLanguageQuery("factor x^2-1");
  assert.ok(source);
  assert.equal(Symbolic.evaluate(source, { x: 3 }), 8); // (x-1)(x+1) at x=3 -> 2*4
});

test("resolves 'expand'", () => {
  assert.equal(resolveNaturalLanguageQuery("expand (x+1)^2"), "x^2 + 2*x + 1");
});

test("resolves 'solve X for v' with exactly one real root", () => {
  const source = resolveNaturalLanguageQuery("solve x-3 for x");
  assert.ok(source);
  assert.equal(Symbolic.evaluate(source), 3);
});

test("resolves 'solve X' accepting an 'lhs = rhs' equation via implicit-zero conversion", () => {
  const source = resolveNaturalLanguageQuery("solve 2*x = 6 for x");
  assert.ok(source);
  assert.equal(Symbolic.evaluate(source), 3);
});

test("'solve' returns null (falls through) for a multi-root polynomial rather than silently dropping roots", () => {
  assert.equal(resolveNaturalLanguageQuery("solve x^2-4 for x"), null);
});

test("resolves 'limit of X as x approaches A'", () => {
  const source = resolveNaturalLanguageQuery("limit of sin(x)/x as x approaches 0");
  assert.ok(source);
  assert.ok(Math.abs(Number(source) - 1) < 1e-6);
});

test("resolves 'limit of X as x -> infinity'", () => {
  const source = resolveNaturalLanguageQuery("limit of (x^2+1)/(2*x^2-3) as x -> infinity");
  assert.ok(source);
  assert.ok(Math.abs(Number(source) - 0.5) < 1e-6);
});

test("axisVariable: 'derivative of' differentiates with respect to the given axis variable, not a hardcoded x", () => {
  assert.equal(resolveNaturalLanguageQuery("derivative of z^2", "z"), "2*z");
});

test("axisVariable defaults to 'x' when omitted, matching the prior (pre-axisVariable) behavior", () => {
  assert.equal(resolveNaturalLanguageQuery("derivative of x^2"), "2*x");
});

test("axisVariable: differentiating w.r.t. the WRONG variable treats the real variable as a constant (0) -- the exact bug axisVariable threading fixes", () => {
  assert.equal(resolveNaturalLanguageQuery("derivative of z^2"), "0"); // default "x": z^2 has no x
});

test("axisVariable: 'solve X' still defaults its 'for' variable to the axis variable when unnamed", () => {
  const source = resolveNaturalLanguageQuery("solve 2*z = 6", "z");
  assert.ok(source);
  assert.equal(Symbolic.evaluate(source), 3);
});

test("axisVariable: 'limit of X as w approaches 0' ignores axisVariable since the limit variable is named inline", () => {
  const source = resolveNaturalLanguageQuery("limit of sin(w)/w as w approaches 0", "z");
  assert.ok(source);
  assert.ok(Math.abs(Number(source) - 1) < 1e-6);
});

test("resolves 'taylor series of X at C to degree N'", () => {
  assert.equal(resolveNaturalLanguageQuery("taylor series of sin(x) at 0 to degree 7"), "x - x^3/6 + x^5/120 - x^7/5040");
});

test("resolves 'taylor series of X' with default center/degree", () => {
  const source = resolveNaturalLanguageQuery("taylor series of exp(x)");
  assert.ok(source);
  // Whatever the default degree is, it should be a genuine polynomial approximation: agrees with exp(x) near 0.
  assert.ok(Math.abs(Symbolic.evaluate(source, { x: 0.1 }) - Math.exp(0.1)) < 1e-3);
});

test("resolves 'taylor series of X' honoring the axis variable", () => {
  assert.equal(resolveNaturalLanguageQuery("taylor series of sin(z) at 0 to degree 7", "z"), "z - z^3/6 + z^5/120 - z^7/5040");
});
