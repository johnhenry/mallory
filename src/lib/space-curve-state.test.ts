import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SPACE_CURVE_STATE, decodeSpaceCurveState, encodeSpaceCurveState } from "./space-curve-state.ts";

test("round-trips the default space-curve state through encode/decode", () => {
  const fragment = encodeSpaceCurveState(DEFAULT_SPACE_CURVE_STATE);
  assert.deepEqual(decodeSpaceCurveState(fragment), DEFAULT_SPACE_CURVE_STATE);
});

test("round-trips a custom trefoil-knot state", () => {
  const state = {
    v: 1 as const,
    exprX: "sin(t) + 2*sin(2*t)",
    exprY: "cos(t) - 2*cos(2*t)",
    exprZ: "-sin(3*t)",
    tMin: "0",
    tMax: "6.283185307179586",
  };
  assert.deepEqual(decodeSpaceCurveState(encodeSpaceCurveState(state)), state);
});

test("decodeSpaceCurveState returns null for garbage or wrong-shape input rather than throwing", () => {
  assert.equal(decodeSpaceCurveState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeSpaceCurveState(""), null);
  const badFragment = encodeSpaceCurveState as unknown as (s: unknown) => string;
  assert.equal(decodeSpaceCurveState(badFragment({ v: 1, exprX: "cos(t)" })), null);
  assert.equal(decodeSpaceCurveState(badFragment({ v: 2, exprX: "a", exprY: "b", exprZ: "c", tMin: "0", tMax: "1" })), null);
});
