import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_COMPLEX_GRAPH_STATE, decodeComplexGraphState, encodeComplexGraphState } from "./complex-graph-state.ts";

test("round-trips the default state (issue #345's own spiral example)", () => {
  const fragment = encodeComplexGraphState(DEFAULT_COMPLEX_GRAPH_STATE);
  assert.deepEqual(decodeComplexGraphState(fragment), DEFAULT_COMPLEX_GRAPH_STATE);
});

test("round-trips a state implicitly dropping Re(x) instead", () => {
  const state = { v: 1 as const, yExpr: "x^2", axisX: "imX" as const, axisY: "reY" as const, axisZ: "imY" as const, tMin: "-2", tMax: "2" };
  const fragment = encodeComplexGraphState(state);
  assert.deepEqual(decodeComplexGraphState(fragment), state);
});

test("decodeComplexGraphState returns null for garbage input rather than throwing", () => {
  assert.equal(decodeComplexGraphState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeComplexGraphState(""), null);
});

test("decodeComplexGraphState rejects a well-formed but wrong-shape payload", () => {
  const encodeGarbage = encodeComplexGraphState as unknown as (s: unknown) => string;
  assert.equal(decodeComplexGraphState(encodeGarbage({ v: 1, yExpr: "x" })), null); // missing fields
  assert.equal(decodeComplexGraphState(encodeGarbage({ ...DEFAULT_COMPLEX_GRAPH_STATE, axisX: "notAComponent" })), null);
  assert.equal(decodeComplexGraphState(encodeGarbage({ ...DEFAULT_COMPLEX_GRAPH_STATE, v: 2 })), null);
});

test("decodeComplexGraphState ignores a stray 'drop' key from a pre-launch schema iteration -- extra keys don't fail validation", () => {
  const encodeLegacyShape = encodeComplexGraphState as unknown as (s: unknown) => string;
  const withStrayDrop = { ...DEFAULT_COMPLEX_GRAPH_STATE, drop: "imX" };
  assert.deepEqual(decodeComplexGraphState(encodeLegacyShape(withStrayDrop)), withStrayDrop);
});
