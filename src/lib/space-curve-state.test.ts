import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SPACE_CURVE_STATE, decodeSpaceCurveState, encodeSpaceCurveState } from "./space-curve-state.ts";

test("round-trips the default space-curve state through encode/decode", () => {
  const fragment = encodeSpaceCurveState(DEFAULT_SPACE_CURVE_STATE);
  assert.deepEqual(decodeSpaceCurveState(fragment), DEFAULT_SPACE_CURVE_STATE);
});

test("round-trips a custom trefoil-knot state", () => {
  const state = {
    v: 2 as const,
    rows: [
      {
        exprX: "sin(t) + 2*sin(2*t)",
        exprY: "cos(t) - 2*cos(2*t)",
        exprZ: "-sin(3*t)",
        tMin: "0",
        tMax: "6.283185307179586",
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
  assert.deepEqual(decodeSpaceCurveState(encodeSpaceCurveState(state)), state);
});

test("unlimited expressions (issue #251): a legacy v1 (single-curve) fragment upgrades to a one-row v2 list", () => {
  const legacyV1 = {
    v: 1 as const,
    exprX: "sin(t) + 2*sin(2*t)",
    exprY: "cos(t) - 2*cos(2*t)",
    exprZ: "-sin(3*t)",
    tMin: "0",
    tMax: "6.283185307179586",
  };
  const encodeLegacy = encodeSpaceCurveState as unknown as (s: unknown) => string;
  const decoded = decodeSpaceCurveState(encodeLegacy(legacyV1));
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.rows.length, 1);
  assert.equal(decoded!.rows[0]?.exprX, legacyV1.exprX);
});

test("unlimited expressions (issue #251): a v2 state with several rows round-trips every row", () => {
  const state = {
    v: 2 as const,
    rows: [
      { exprX: "cos(t)", exprY: "sin(t)", exprZ: "0.15*t", tMin: "0", tMax: "12.566", color: 0x2563eb, visible: true },
      { exprX: "sin(t)", exprY: "cos(t)", exprZ: "0", tMin: "0", tMax: "6.283", color: 0xdc2626, visible: false },
    ],
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
