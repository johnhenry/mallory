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

test("evaluateCalculatorExpr in interval mode: sqrt(2) returns rigorous bounds containing the real value", () => {
  const result = evaluateCalculatorExpr("sqrt(2)", {}, "interval", null);
  assert.equal(result.isError, false);
  assert.match(result.display, /^\[1\.41421356\d*, 1\.41421356\d*\]$/);
  assert.ok(result.value !== null && Math.abs(result.value - Math.SQRT2) < 1e-9);
});

test("evaluateCalculatorExpr in interval mode: a previously-defined variable is treated as a degenerate point interval", () => {
  // @johnhenry/math's Interval.pow outward-rounds its result by ~1 ulp per
  // side even when exact (johnhenry/math#57), so 3^2 displays a hair wider
  // than "[9, 9]" -- assert containment and midpoint proximity instead of
  // the exact display string, same approach the sqrt(2) test above uses.
  const result = evaluateCalculatorExpr("r^2", { r: 3 }, "interval", null);
  assert.equal(result.isError, false);
  assert.match(result.display, /^\[8\.999999999999\d*, 9\.000000000000\d*\]$/);
  assert.ok(result.value !== null && Math.abs(result.value - 9) < 1e-9);
});

test("evaluateCalculatorExpr in interval mode: division by zero surfaces as an error, not NaN or a crash", () => {
  const result = evaluateCalculatorExpr("1 / (x - x)", { x: 5 }, "interval", null);
  assert.equal(result.isError, true);
  assert.equal(result.value, null);
});

test("submitCalculatorLine in interval mode: assignment stores the midpoint for later reuse", () => {
  const state = submitCalculatorLine("k = sqrt(4)", EMPTY_CALCULATOR_STATE, "interval", null);
  assert.equal(state.variables.k, 2);
});

test("evaluateCalculatorExpr in complex mode: i^2 is -1 (a real result)", () => {
  const result = evaluateCalculatorExpr("i^2", {}, "complex", null);
  assert.equal(result.isError, false);
  assert.equal(result.display, "-1");
  assert.equal(result.value, -1);
});

test("evaluateCalculatorExpr in complex mode: basic complex arithmetic with the implicit-multiplication 'bi' form", () => {
  const result = evaluateCalculatorExpr("(3+4i)*(1-2i)", {}, "complex", null);
  assert.equal(result.isError, false);
  assert.equal(result.display, "11-2*i");
  assert.equal(result.value, null); // genuinely complex -- not storable as a plain number
});

test("evaluateCalculatorExpr in complex mode: division by a complex number", () => {
  const result = evaluateCalculatorExpr("1/(2+i)", {}, "complex", null);
  assert.equal(result.isError, false);
  assert.equal(result.display, "0.4-0.2*i");
});

test("evaluateCalculatorExpr in complex mode: a previously-defined real variable is usable as a complex point", () => {
  const result = evaluateCalculatorExpr("r + i", { r: 3 }, "complex", null);
  assert.equal(result.isError, false);
  assert.equal(result.display, "3+i");
});

test("evaluateCalculatorExpr in complex mode: elementary functions of a complex argument now work (previously unsupported)", () => {
  const result = evaluateCalculatorExpr("sqrt(i)", {}, "complex", null);
  assert.equal(result.isError, false);
  assert.equal(result.display, "0.7071067812+0.7071067812*i");
  assert.equal(result.value, null); // genuinely complex -- not storable as a plain number
});

test("evaluateCalculatorExpr in complex mode: exp(i*pi) is Euler's identity (-1, a real result)", () => {
  const result = evaluateCalculatorExpr("exp(i*pi)", {}, "complex", null);
  assert.equal(result.isError, false);
  assert.ok(result.value !== null && Math.abs(result.value - -1) < 1e-9);
});

test("evaluateCalculatorExpr in complex mode: a two-argument function still has no meaning here and surfaces as an error, not a throw", () => {
  const result = evaluateCalculatorExpr("atan2(1, i)", {}, "complex", null);
  assert.equal(result.isError, true);
  assert.equal(result.value, null);
});

test("submitCalculatorLine in complex mode: assigning a real-valued complex result stores it normally", () => {
  const state = submitCalculatorLine("z = i^2", EMPTY_CALCULATOR_STATE, "complex", null);
  assert.equal(state.variables.z, -1);
  assert.equal(state.history[0].isAssignment, true);
});

test("submitCalculatorLine in complex mode: assigning a genuinely complex result does not silently claim success", () => {
  const state = submitCalculatorLine("z = 2+3i", EMPTY_CALCULATOR_STATE, "complex", null);
  assert.deepEqual(state.variables, {});
  assert.equal(state.history[0].isAssignment, false);
  assert.equal(state.history[0].isError, false);
  assert.match(state.history[0].display, /not stored/);
});

test("submitCalculatorLine: 'expr -> name' stores the left-hand value into the right-hand variable", () => {
  const state = submitCalculatorLine("1 -> x", EMPTY_CALCULATOR_STATE, "float", null);
  assert.equal(state.variables.x, 1);
  assert.equal(state.history[0].isAssignment, true);
  assert.equal(state.history[0].display, "1");
});

test("submitCalculatorLine: 'name <- expr' stores the right-hand value into the left-hand variable", () => {
  const state = submitCalculatorLine("y <- 2", EMPTY_CALCULATOR_STATE, "float", null);
  assert.equal(state.variables.y, 2);
  assert.equal(state.history[0].isAssignment, true);
  assert.equal(state.history[0].display, "2");
});

test("submitCalculatorLine: directional store operators can reference previously-stored variables", () => {
  let state = submitCalculatorLine("1 -> x", EMPTY_CALCULATOR_STATE, "float", null);
  state = submitCalculatorLine("y <- 2", state, "float", null);
  state = submitCalculatorLine("x + y -> z", state, "float", null);
  assert.equal(state.variables.z, 3);
});

test("submitCalculatorLine: a failed directional store still appends an error entry but leaves variables untouched", () => {
  const state = submitCalculatorLine("1 + -> x", EMPTY_CALCULATOR_STATE, "float", null);
  assert.equal(state.history[0].isError, true);
  assert.equal(state.history[0].isAssignment, false);
  assert.deepEqual(state.variables, {});
});

test("submitCalculatorLine: '->' is not confused with '>=' or a plain comparison", () => {
  const state = submitCalculatorLine("x >= 1", EMPTY_CALCULATOR_STATE, "float", null);
  assert.deepEqual(state.variables, {});
});
