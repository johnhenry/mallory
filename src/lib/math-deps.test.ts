import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber } from "@johnhenry/math";

// Pins the @johnhenry/math@0.15.0 ComplexNumber API surface this app depends on
// (issue #19) -- not a test of app code, a dependency-version smoke test.
// (Version cross-checked against packages/math/package.json in the math monorepo.)
test("@johnhenry/math ComplexNumber exposes the completed hyperbolic family", () => {
  const z = new ComplexNumber(1, 2);
  assert.ok(typeof z.hyperbolicTangent === "function");
  assert.ok(typeof z.arcHyperbolicSine === "function");
  assert.ok(typeof z.arcHyperbolicCosine === "function");
  assert.ok(typeof z.arcHyperbolicTangent === "function");

  const t = new ComplexNumber(0.7).hyperbolicTangent();
  assert.ok(Math.abs(t.value - Math.tanh(0.7)) < 1e-9 && Math.abs(t.iValue) < 1e-9);
});

test("@johnhenry/math ComplexNumber's valueOf() throws on implicit coercion of a non-real value", () => {
  const z = new ComplexNumber(1, 2);
  assert.throws(() => +z, TypeError);
  assert.equal(+new ComplexNumber(5, 0), 5);
});
