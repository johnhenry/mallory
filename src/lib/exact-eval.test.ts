import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateExactAt } from "./exact-eval.ts";

test("evaluateExactAt: exact integer/fraction results, hand-computed", () => {
  assert.equal(evaluateExactAt("x^2+1", 2, {}), "5");
  assert.equal(evaluateExactAt("x/3", 1, {}), "1/3");
});

test("evaluateExactAt: substitutes params alongside the axis variable", () => {
  assert.equal(evaluateExactAt("a*x", 2, { a: 3 }), "6");
});

test("evaluateExactAt: a func node (sin) isn't exactly representable -- returns null, not a lossy decimal", () => {
  assert.equal(evaluateExactAt("sin(x)", 0, {}), null);
});

test("evaluateExactAt: a parse error returns null rather than throwing", () => {
  assert.equal(evaluateExactAt("(((", 1, {}), null);
});

test("evaluateExactAt: respects a non-default axis variable", () => {
  assert.equal(evaluateExactAt("t^2", 3, {}, "t"), "9");
});
