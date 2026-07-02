import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber } from "../src/ComplexNumber.ts";
import { Type } from "../src/Type.ts";
import { Vector } from "../src/Vector.ts";

test("classifies numbers and complex numbers", () => {
  assert.equal(Type.getType(5), Type.NUMBER);
  assert.equal(Type.getType(new ComplexNumber(1, 2)), Type.NUMBER);
  assert.equal(Type.getType("3+2*i"), Type.NUMBER, "numeric strings are numbers");
});

test("classifies vectors vs matrices", () => {
  assert.equal(Type.getType(Vector.fromArray([1, 2, 3])), Type.VECTOR);
  const m = Vector.fromArray([Vector.fromArray([1, 2]), Vector.fromArray([3, 4])]);
  assert.equal(Type.getType(m), Type.MATRIX);
});

test("classifies booleans, errors, non-numeric strings, functions", () => {
  assert.equal(Type.getType(true), Type.BOOLEAN);
  assert.equal(Type.getType(new Error("x")), Type.ERROR);
  assert.equal(Type.getType("hello"), Type.ERROR);
  assert.equal(
    Type.getType(() => 1),
    Type.FUNCTION,
  );
});
