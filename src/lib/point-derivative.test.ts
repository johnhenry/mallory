import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDerivativeAtPoint } from "./point-derivative.ts";

test("evaluateDerivativeAtPoint: d/dx[x^2] at x=3 is 6", () => {
  assert.ok(Math.abs(evaluateDerivativeAtPoint("x^2", 3) - 6) < 1e-9);
});

test("evaluateDerivativeAtPoint: d/dx[sin(x)] at x=0 is cos(0)=1", () => {
  assert.ok(Math.abs(evaluateDerivativeAtPoint("sin(x)", 0) - 1) < 1e-9);
});

test("evaluateDerivativeAtPoint: d/dx[sin(x)] at x=pi/2 is cos(pi/2)=0", () => {
  assert.ok(Math.abs(evaluateDerivativeAtPoint("sin(x)", Math.PI / 2)) < 1e-9);
});

test("evaluateDerivativeAtPoint: respects extra parameters, d/dx[a*x^2] at x=2,a=5 is 2*a*x=20", () => {
  assert.ok(Math.abs(evaluateDerivativeAtPoint("a*x^2", 2, { a: 5 }) - 20) < 1e-9);
});

test("evaluateDerivativeAtPoint: works with functions evaluateOverStructure could never handle (sqrt, exp)", () => {
  // d/dx[sqrt(x)] = 1/(2*sqrt(x)); at x=4 that's 1/4.
  assert.ok(Math.abs(evaluateDerivativeAtPoint("sqrt(x)", 4) - 0.25) < 1e-9);
  // d/dx[exp(x)] = exp(x); at x=0 that's 1.
  assert.ok(Math.abs(evaluateDerivativeAtPoint("exp(x)", 0) - 1) < 1e-9);
});
