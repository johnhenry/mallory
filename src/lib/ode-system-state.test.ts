import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ODE_SYSTEM_STATE, decodeOdeSystemState, encodeOdeSystemState } from "./ode-system-state.ts";

test("round-trips the default ode-system state through encode/decode", () => {
  const fragment = encodeOdeSystemState(DEFAULT_ODE_SYSTEM_STATE);
  assert.deepEqual(decodeOdeSystemState(fragment), DEFAULT_ODE_SYSTEM_STATE);
});

test("round-trips a custom single-system state", () => {
  const state = {
    v: 2 as const,
    xMin: "-5",
    xMax: "5",
    yMin: "-5",
    yMax: "5",
    rows: [{ exprX: "-y", exprY: "x", t0: "0", x0: "1", y0: "0", tMin: "0", tMax: "10", color: 0x2563eb, visible: true }],
  };
  assert.deepEqual(decodeOdeSystemState(encodeOdeSystemState(state)), state);
});

test("unlimited overlaid systems: a legacy v1 (single-system) fragment upgrades to a one-row v2 list", () => {
  const legacyV1 = {
    v: 1 as const,
    exprX: "x*(1-y)",
    exprY: "y*(x-1)",
    t0: "0",
    x0: "2",
    y0: "1",
    tMin: "0",
    tMax: "15",
    xMin: "0",
    xMax: "3",
    yMin: "0",
    yMax: "3",
  };
  const encodeLegacy = encodeOdeSystemState as unknown as (s: unknown) => string;
  const decoded = decodeOdeSystemState(encodeLegacy(legacyV1));
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.rows.length, 1);
  assert.equal(decoded!.rows[0]?.exprX, legacyV1.exprX);
  assert.equal(decoded!.rows[0]?.exprY, legacyV1.exprY);
  assert.equal(decoded!.xMax, "3");
});

test("unlimited overlaid systems: a v2 state with several rows round-trips every row", () => {
  const state = {
    v: 2 as const,
    xMin: "-3",
    xMax: "3",
    yMin: "-3",
    yMax: "3",
    rows: [
      { exprX: "x*(1-y)", exprY: "y*(x-1)", t0: "0", x0: "2", y0: "1", tMin: "0", tMax: "15", color: 0x2563eb, visible: true },
      { exprX: "-y", exprY: "x", t0: "0", x0: "1", y0: "0", tMin: "0", tMax: "10", color: 0xdc2626, visible: false },
    ],
  };
  assert.deepEqual(decodeOdeSystemState(encodeOdeSystemState(state)), state);
});

test("decodeOdeSystemState returns null for garbage or wrong-shape input rather than throwing", () => {
  assert.equal(decodeOdeSystemState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeOdeSystemState(""), null);
  const badFragment = encodeOdeSystemState as unknown as (s: unknown) => string;
  assert.equal(decodeOdeSystemState(badFragment({ v: 1, exprX: "x" })), null);
  assert.equal(decodeOdeSystemState(badFragment({ v: 2, xMin: "0", xMax: "1", yMin: "0", yMax: "1" })), null);
});
