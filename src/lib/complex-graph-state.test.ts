import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_COMPLEX_GRAPH_STATE,
  decodeComplexGraphState,
  encodeComplexGraphState,
  type ComplexGraphStateV1,
  type ComplexGraphStateV2,
} from "./complex-graph-state.ts";

test("round-trips the default state (issue #345's own spiral example)", () => {
  const fragment = encodeComplexGraphState(DEFAULT_COMPLEX_GRAPH_STATE);
  assert.deepEqual(decodeComplexGraphState(fragment), DEFAULT_COMPLEX_GRAPH_STATE);
});

test("round-trips a state with multiple function rows sharing one set of axes", () => {
  const state = {
    v: 3 as const,
    axisX: "reX" as const,
    axisY: "reY" as const,
    axisZ: "imY" as const,
    sweepReX: false,
    sweepImX: false,
    rows: [
      { yExpr: "exp(i*x)", tMin: "0", tMax: "6.28", color: 0x9333ea, visible: true },
      { yExpr: "x^2", tMin: "-2", tMax: "2", color: 0x2563eb, visible: false },
    ],
  };
  const fragment = encodeComplexGraphState(state);
  assert.deepEqual(decodeComplexGraphState(fragment), state);
});

test("round-trips a state with the domain-sweep toggles on (#365)", () => {
  const state = {
    v: 3 as const,
    axisX: "reX" as const,
    axisY: "reY" as const,
    axisZ: "none" as const,
    sweepReX: false,
    sweepImX: true,
    rows: [{ yExpr: "exp(i*x)", tMin: "0", tMax: "6.28", color: 0x9333ea, visible: true }],
  };
  const fragment = encodeComplexGraphState(state);
  assert.deepEqual(decodeComplexGraphState(fragment), state);
});

test("decodeComplexGraphState upgrades a v1 (single-curve) fragment into a one-row v3 state, sweep toggles defaulted off", () => {
  const v1: ComplexGraphStateV1 = { v: 1, yExpr: "x^2", axisX: "imX", axisY: "reY", axisZ: "imY", tMin: "-2", tMax: "2" };
  const encodeV1 = encodeComplexGraphState as unknown as (s: unknown) => string;
  const decoded = decodeComplexGraphState(encodeV1(v1));
  assert.deepEqual(decoded, {
    v: 3,
    axisX: "imX",
    axisY: "reY",
    axisZ: "imY",
    sweepReX: false,
    sweepImX: false,
    rows: [{ yExpr: "x^2", tMin: "-2", tMax: "2", color: 0x9333ea, visible: true }],
  });
});

test("decodeComplexGraphState upgrades a v2 (pre-#365) fragment into v3, sweep toggles defaulted off", () => {
  const v2: ComplexGraphStateV2 = {
    v: 2,
    axisX: "reX",
    axisY: "reY",
    axisZ: "imY",
    rows: [{ yExpr: "exp(i*x)", tMin: "0", tMax: "6.28", color: 0x9333ea, visible: true }],
  };
  const encodeV2 = encodeComplexGraphState as unknown as (s: unknown) => string;
  const decoded = decodeComplexGraphState(encodeV2(v2));
  assert.deepEqual(decoded, { ...v2, v: 3, sweepReX: false, sweepImX: false });
});

test("decodeComplexGraphState returns null for garbage input rather than throwing", () => {
  assert.equal(decodeComplexGraphState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeComplexGraphState(""), null);
});

test("decodeComplexGraphState rejects a well-formed but wrong-shape payload", () => {
  const encodeGarbage = encodeComplexGraphState as unknown as (s: unknown) => string;
  assert.equal(decodeComplexGraphState(encodeGarbage({ v: 1, yExpr: "x" })), null); // missing fields
  assert.equal(decodeComplexGraphState(encodeGarbage({ ...DEFAULT_COMPLEX_GRAPH_STATE, axisX: "notAComponent" })), null);
  assert.equal(decodeComplexGraphState(encodeGarbage({ ...DEFAULT_COMPLEX_GRAPH_STATE, rows: "not-an-array" })), null);
  assert.equal(decodeComplexGraphState(encodeGarbage({ ...DEFAULT_COMPLEX_GRAPH_STATE, sweepReX: "not-a-boolean" })), null);
});

test("decodeComplexGraphState ignores a stray extra key -- extra keys don't fail validation", () => {
  const encodeExtra = encodeComplexGraphState as unknown as (s: unknown) => string;
  const withStrayKey = { ...DEFAULT_COMPLEX_GRAPH_STATE, drop: "imX" };
  assert.deepEqual(decodeComplexGraphState(encodeExtra(withStrayKey)), withStrayKey);
});

test("round-trips a state with an axis left unassigned ('none') -- an axis dropdown can be freely reset", () => {
  const state = {
    v: 3 as const,
    axisX: "none" as const,
    axisY: "reY" as const,
    axisZ: "imY" as const,
    sweepReX: false,
    sweepImX: false,
    rows: [{ yExpr: "x^2", tMin: "-2", tMax: "2", color: 0x9333ea, visible: true }],
  };
  const fragment = encodeComplexGraphState(state);
  assert.deepEqual(decodeComplexGraphState(fragment), state);
});
