import assert from "node:assert/strict";
import { test } from "node:test";
import { Symbolic } from "@johnhenry/math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

test("inserts * between a number and a variable", () => {
  assert.equal(preprocessImplicitMultiplication("2x"), "2*x");
});

test("inserts * between a variable and a known function call, but not before its (", () => {
  assert.equal(preprocessImplicitMultiplication("2x sin(x)"), "2*x*sin(x)");
});

test("splits an unrecognized multi-letter run into single-char variables", () => {
  assert.equal(preprocessImplicitMultiplication("xy"), "x*y");
});

test("inserts * between a number and a parenthesized group", () => {
  assert.equal(preprocessImplicitMultiplication("2(x+1)"), "2*(x+1)");
});

test("inserts * between two adjacent parenthesized groups", () => {
  assert.equal(preprocessImplicitMultiplication("(x+1)(x-1)"), "(x+1)*(x-1)");
});

test("inserts * between adjacent function calls", () => {
  assert.equal(preprocessImplicitMultiplication("2sin(x)cos(x)"), "2*sin(x)*cos(x)");
});

test("leaves already-explicit multiplication unchanged", () => {
  assert.equal(preprocessImplicitMultiplication("2*x"), "2*x");
});

test("does not insert * around a leading unary minus", () => {
  assert.equal(preprocessImplicitMultiplication("-x^2"), "-x^2");
});

test("does not split known constants pi and e", () => {
  assert.equal(preprocessImplicitMultiplication("2pi"), "2*pi");
});

test("exponent binds to the immediately preceding base, not the whole implicit product", () => {
  assert.equal(preprocessImplicitMultiplication("3xy^2"), "3*x*y^2");
});

test("ignores whitespace between tokens", () => {
  assert.equal(preprocessImplicitMultiplication("2 x sin( x )"), "2*x*sin(x)");
});

test("throws on a run that starts with a known function name but keeps going", () => {
  assert.throws(() => preprocessImplicitMultiplication("sind(x)"), /Ambiguous name "sind"/);
});

test("throws on a run that starts with a known constant but keeps going", () => {
  assert.throws(() => preprocessImplicitMultiplication("pix"), /Ambiguous name "pix"/);
});

test("does not throw when a known name is immediately followed by an operator or paren", () => {
  assert.equal(preprocessImplicitMultiplication("sin(x)+pi"), "sin(x)+pi");
});

test("comparison operators are left unchanged (no implicit * inserted around them)", () => {
  assert.equal(preprocessImplicitMultiplication("x<5"), "x<5");
  assert.equal(preprocessImplicitMultiplication("x<=5"), "x<=5");
  assert.equal(preprocessImplicitMultiplication("x>5"), "x>5");
  assert.equal(preprocessImplicitMultiplication("x>=5"), "x>=5");
  assert.equal(preprocessImplicitMultiplication("x==5"), "x==5");
  assert.equal(preprocessImplicitMultiplication("x!=5"), "x!=5");
});

test("inserts * around implicit multiplication next to a comparison operator", () => {
  assert.equal(preprocessImplicitMultiplication("2x<5"), "2*x<5");
  assert.equal(preprocessImplicitMultiplication("2x>=3y"), "2*x>=3*y");
});

test("piecewise parses without tripping the ambiguous-name check, since it's now a known callable name", () => {
  assert.equal(preprocessImplicitMultiplication("piecewise(x<0,-x,x)"), "piecewise(x<0,-x,x)");
});

test("regression: a genuinely ambiguous run still throws even with piecewise added to KNOWN_NAMES", () => {
  assert.throws(() => preprocessImplicitMultiplication("piecewisex"), /Ambiguous name/);
});

test("preprocessed output actually parses and evaluates via Symbolic", () => {
  const preprocessed = preprocessImplicitMultiplication("2x sin(x)");
  const expr = Symbolic.parse(preprocessed);
  assert.equal(Symbolic.evaluate(expr, { x: 0 }), 0);
  const halfPi = Math.PI / 2;
  assert.ok(Math.abs(Symbolic.evaluate(expr, { x: halfPi }) - 2 * halfPi * Math.sin(halfPi)) < 1e-9);
});
