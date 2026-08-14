import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_CALCULATOR_STATE, evaluateCalculatorExpr, submitCalculatorLine } from "./calculator-eval.ts";

test("evaluateCalculatorExpr computes a plain float expression", () => {
  const result = evaluateCalculatorExpr("12 * (4 + 1/3)", {}, "float", null);
  assert.equal(result.isError, false);
  assert.equal(result.display, "52");
  assert.equal(result.value, 52);
});

test("evaluateCalculatorExpr in exact mode keeps a fraction a fraction", () => {
  const result = evaluateCalculatorExpr("1/3 + 1/6", {}, "exact", null);
  assert.equal(result.isError, false);
  assert.equal(result.display, "1/2");
});

test("evaluateCalculatorExpr falls back to an error on a mid-typing parse failure, not a throw", () => {
  const result = evaluateCalculatorExpr("1 +", {}, "float", null);
  assert.equal(result.isError, true);
  assert.equal(result.value, null);
});

test("evaluateCalculatorExpr reads previously-defined variables", () => {
  const result = evaluateCalculatorExpr("r^2", { r: 3 }, "float", null);
  assert.equal(result.isError, false);
  assert.equal(result.value, 9);
});

test("evaluateCalculatorExpr over Z/7Z reduces the result mod 7", () => {
  const result = evaluateCalculatorExpr("3 + 5", {}, "float", 7);
  assert.equal(result.isError, false);
  assert.equal(result.display, "1");
});

test("evaluateCalculatorExpr over a finite structure reports non-invertible division as undefined, not NaN", () => {
  const result = evaluateCalculatorExpr("1/2", {}, "float", 4);
  assert.equal(result.isError, true);
  assert.match(result.display, /undefined in Z\/4Z/);
});

test("submitCalculatorLine appends a plain-expression entry without touching variables", () => {
  const next = submitCalculatorLine("2 + 2", EMPTY_CALCULATOR_STATE, "float", null);
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].display, "4");
  assert.equal(next.history[0].isAssignment, false);
  assert.deepEqual(next.variables, {});
});

test("submitCalculatorLine on 'name = expr' stores the variable for later lines", () => {
  const afterAssign = submitCalculatorLine("r = sqrt(4)", EMPTY_CALCULATOR_STATE, "float", null);
  assert.equal(afterAssign.variables.r, 2);
  assert.equal(afterAssign.history[0].isAssignment, true);

  const afterUse = submitCalculatorLine("r * 10", afterAssign, "float", null);
  assert.equal(afterUse.history[1].display, "20");
});

test("submitCalculatorLine does not confuse '==' or '>=' with an assignment", () => {
  const eq = submitCalculatorLine("2 == 2", EMPTY_CALCULATOR_STATE, "float", null);
  assert.deepEqual(eq.variables, {});
  const ge = submitCalculatorLine("x >= 1", EMPTY_CALCULATOR_STATE, "float", null);
  assert.deepEqual(ge.variables, {});
});

test("submitCalculatorLine on a failed assignment appends an error entry but leaves variables untouched", () => {
  const next = submitCalculatorLine("bad = 1 +", EMPTY_CALCULATOR_STATE, "float", null);
  assert.equal(next.history[0].isError, true);
  assert.equal(next.history[0].isAssignment, false);
  assert.deepEqual(next.variables, {});
});

test("submitCalculatorLine ignores a blank/whitespace-only line", () => {
  const next = submitCalculatorLine("   ", EMPTY_CALCULATOR_STATE, "float", null);
  assert.equal(next, EMPTY_CALCULATOR_STATE);
});

test("evaluateCalculatorExpr in units mode: 5 m/s * 3 s -> 15 m/s*s (raw composite)", () => {
  const result = evaluateCalculatorExpr("5 m/s * 3 s", {}, "units", null);
  assert.equal(result.isError, false);
  assert.equal(result.value, 15);
});

test("evaluateCalculatorExpr in units mode: unit conversion via 'in'", () => {
  const result = evaluateCalculatorExpr("3 mi in km", {}, "units", null);
  assert.equal(result.isError, false);
  assert.ok(result.display.startsWith("4.828"));
});

test("evaluateCalculatorExpr in units mode: incompatible dimensions surface as a clear error, not a throw", () => {
  const result = evaluateCalculatorExpr("5 m + 3 s", {}, "units", null);
  assert.equal(result.isError, true);
  assert.equal(result.value, null);
});

test("submitCalculatorLine in units mode: assignment stores the magnitude for later reuse", () => {
  let state = submitCalculatorLine("d = 5 m/s * 3 s", EMPTY_CALCULATOR_STATE, "units", null);
  assert.equal(state.variables.d, 15);
  state = submitCalculatorLine("d m", state, "units", null);
  assert.equal(state.history[1].display, "15 m");
});
