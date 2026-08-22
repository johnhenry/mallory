import assert from "node:assert/strict";
import { test } from "node:test";
import { Symbolic } from "@johnhenry/math";
import { equationToImplicitZero } from "./equation-to-zero.ts";

test("splits a simple equation on its bare equals sign", () => {
  const result = equationToImplicitZero("2*x + 3*y = 12");
  assert.equal(Symbolic.evaluate(result, { x: 0, y: 4 }), 0); // 2*0+3*4=12
});

test("leaves already-implicit-zero text unchanged", () => {
  assert.equal(equationToImplicitZero("2*x + 3*y - 12"), "2*x + 3*y - 12");
});

test("does not split on ==, !=, <=, >=", () => {
  assert.equal(equationToImplicitZero("x==3"), "x==3");
  assert.equal(equationToImplicitZero("x!=3"), "x!=3");
  assert.equal(equationToImplicitZero("x<=3"), "x<=3");
  assert.equal(equationToImplicitZero("x>=3"), "x>=3");
});

test("the converted form parses and solves correctly via solveSystem", () => {
  const result = Symbolic.solveSystem(
    [equationToImplicitZero("2*x + y = 5"), equationToImplicitZero("x - y = 1")],
    ["x", "y"],
  );
  assert.ok(Math.abs(result.x - 2) < 1e-9);
  assert.ok(Math.abs(result.y - 1) < 1e-9);
});
