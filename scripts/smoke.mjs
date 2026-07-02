// Smoke test for the *built* package: imports the emitted ESM entry point and
// exercises a handful of APIs. Proves that `npm run build` produces a working,
// importable artifact (something the unit tests, which run against src/, cannot).
import assert from "node:assert/strict";
import { ComplexNumber, StringEvaluator, Structure, Vector } from "../dist/index.js";

// Complex arithmetic: e^(iπ) ≈ -1
const euler = ComplexNumber.E.power(new ComplexNumber(0, Math.PI));
assert.ok(Math.abs(euler.value - -1) < 1e-5 && Math.abs(euler.iValue) < 1e-5, "euler identity");

// Real linear algebra
assert.equal(
  Structure.realField().determinant(Vector.fromArray([Vector.fromArray([1, 2]), Vector.fromArray([3, 4])])),
  -2,
);

// Expression evaluation
const env = StringEvaluator.mathEnvironment();
assert.ok(Math.abs(StringEvaluator.evaluate("sin(pi/2) + 2^3", env).value - 9) < 1e-6, "expression eval");

// Generic structure over a finite field
const gf7 = Structure.integersModulo(7);
assert.equal(gf7.reciprocal(3), 5);

console.log("✓ dist smoke test passed — built package imports and computes correctly");
