import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LINKED3D_STATE, decodeLinked3DState, encodeLinked3DState, isLinked3DStateV1, isLinked3DStateV2 } from "./linked3d-state.ts";

test("round-trips the default linked-3D state through encode/decode", () => {
  const fragment = encodeLinked3DState(DEFAULT_LINKED3D_STATE);
  assert.deepEqual(decodeLinked3DState(fragment), DEFAULT_LINKED3D_STATE);
});

test("round-trips a custom single-surface state", () => {
  const state = {
    v: 2 as const,
    pane2d: { source: "cos(x)", params: { a: 2 }, structureModulus: 3 },
    pane3d: { rows: [{ source: "x*y", params: { b: 1 }, color: 0xdc2626, visible: true }] },
    crossSectionY: 1.5,
  };
  assert.deepEqual(decodeLinked3DState(encodeLinked3DState(state)), state);
});

test("unlimited overlaid surfaces: a v2 state with several rows round-trips every row", () => {
  const state = {
    v: 2 as const,
    pane2d: { source: "sin(x)", params: {}, structureModulus: null },
    pane3d: {
      rows: [
        { source: "sin(x)*cos(y)", params: {}, color: 0x2563eb, visible: true },
        { source: "x^2-y^2", params: {}, color: 0xdc2626, visible: false },
      ],
    },
    crossSectionY: 0,
  };
  assert.deepEqual(decodeLinked3DState(encodeLinked3DState(state)), state);
});

test("unlimited overlaid surfaces: a legacy v1 (single-surface) fragment upgrades to a one-row v2 list", () => {
  const legacyV1 = {
    v: 1 as const,
    pane2d: { source: "sin(x)", params: {}, structureModulus: null },
    pane3d: { source: "sin(x)*cos(y)", params: { a: 1 } },
    crossSectionY: 0.5,
  };
  assert.ok(isLinked3DStateV1(legacyV1));
  const encodeLegacy = encodeLinked3DState as unknown as (s: unknown) => string;
  const decoded = decodeLinked3DState(encodeLegacy(legacyV1));
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.pane3d.rows.length, 1);
  assert.equal(decoded!.pane3d.rows[0]?.source, legacyV1.pane3d.source);
  assert.deepEqual(decoded!.pane3d.rows[0]?.params, legacyV1.pane3d.params);
  assert.equal(decoded!.pane2d.source, legacyV1.pane2d.source);
  assert.equal(decoded!.crossSectionY, legacyV1.crossSectionY);
  assert.ok(!isLinked3DStateV2(legacyV1));
});

test("decodeLinked3DState returns null for garbage or wrong-shape input rather than throwing", () => {
  assert.equal(decodeLinked3DState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeLinked3DState(""), null);
  const badFragment = encodeLinked3DState as unknown as (s: unknown) => string;
  assert.equal(decodeLinked3DState(badFragment({ v: 1, pane2d: {} })), null);
  assert.equal(decodeLinked3DState(badFragment({ v: 2, pane2d: { source: "x", params: {}, structureModulus: null } })), null);
});
