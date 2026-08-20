import assert from "node:assert/strict";
import { encodeStateFragment } from "./url-fragment.ts";
import { test } from "node:test";
import {
  DEFAULT_COMPLEX_STATE,
  decodeComplexState,
  encodeComplexState,
  isComplexStateV1,
  isComplexStateV2,
  isComplexStateV3,
  isComplexStateV4,
  type ComplexStateV1,
  type ComplexStateV2,
  type ComplexStateV3,
} from "./complex-state.ts";

test("encodeComplexState/decodeComplexState: round-trips the default state", () => {
  const encoded = encodeComplexState(DEFAULT_COMPLEX_STATE);
  const decoded = decodeComplexState(encoded);
  assert.deepEqual(decoded, DEFAULT_COMPLEX_STATE);
});

test("round-trips a custom multi-function state", () => {
  const state = {
    v: 4 as const,
    rows: [
      {
        exprText: "z^2",
        probeRe: "0",
        probeIm: "0",
        showRootsOfUnity: false,
        rootsN: "3",
        showConformalGrid: false,
        conformalGridType: "rectangular" as const,
        conformalGridSpacing: "0.5",
        showZeros: false,
        showPoles: false,
        color: 0x2563eb,
        visible: true,
      },
      {
        exprText: "1/z",
        probeRe: "1",
        probeIm: "1",
        showRootsOfUnity: true,
        rootsN: "6",
        showConformalGrid: true,
        conformalGridType: "polar" as const,
        conformalGridSpacing: "0.25",
        showZeros: true,
        showPoles: true,
        color: 0xdc2626,
        visible: false,
      },
    ],
  };
  assert.deepEqual(decodeComplexState(encodeComplexState(state)), state);
});

test("decodeComplexState: returns null for garbage input rather than throwing", () => {
  assert.equal(decodeComplexState("not-valid-base64url!!"), null);
  assert.equal(decodeComplexState(""), null);
});

test("isComplexStateV1/isComplexStateV2/isComplexStateV3/isComplexStateV4: distinguish the four shapes by their v tag", () => {
  const v1: ComplexStateV1 = { v: 1, exprText: "z^2", probeRe: "0", probeIm: "0", showRootsOfUnity: false, rootsN: "3" };
  assert.equal(isComplexStateV1(v1), true);
  assert.equal(isComplexStateV2(v1), false);
  assert.equal(isComplexStateV3(v1), false);
  assert.equal(isComplexStateV4(v1), false);
  assert.equal(isComplexStateV1(DEFAULT_COMPLEX_STATE), false);
  assert.equal(isComplexStateV2(DEFAULT_COMPLEX_STATE), false);
  assert.equal(isComplexStateV3(DEFAULT_COMPLEX_STATE), false);
  assert.equal(isComplexStateV4(DEFAULT_COMPLEX_STATE), true);
});

test("decodeComplexState: upgrades a v1 payload all the way to v4, defaulting the conformal-grid and zeros/poles fields off and producing a single-row list", () => {
  const v1: ComplexStateV1 = { v: 1, exprText: "1/z", probeRe: "2", probeIm: "-1", showRootsOfUnity: true, rootsN: "7" };
  const encoded = encodeStateFragment(v1);
  const decoded = decodeComplexState(encoded);
  assert.ok(decoded);
  assert.equal(decoded.v, 4);
  assert.equal(decoded.rows.length, 1);
  const row = decoded.rows[0]!;
  assert.equal(row.exprText, "1/z");
  assert.equal(row.probeRe, "2");
  assert.equal(row.probeIm, "-1");
  assert.equal(row.showRootsOfUnity, true);
  assert.equal(row.rootsN, "7");
  assert.equal(row.showConformalGrid, false);
  assert.equal(row.conformalGridType, "rectangular");
  assert.equal(row.conformalGridSpacing, "0.5");
  assert.equal(row.showZeros, false);
  assert.equal(row.showPoles, false);
  assert.equal(row.visible, true);
});

test("decodeComplexState: upgrades a v2 payload to v4, defaulting showZeros/showPoles off and preserving the conformal-grid fields", () => {
  const v2: ComplexStateV2 = {
    v: 2,
    exprText: "sin(z)",
    probeRe: "0",
    probeIm: "0",
    showRootsOfUnity: false,
    rootsN: "4",
    showConformalGrid: true,
    conformalGridType: "polar",
    conformalGridSpacing: "0.25",
  };
  const encoded = encodeStateFragment(v2);
  const decoded = decodeComplexState(encoded);
  assert.ok(decoded);
  assert.equal(decoded.v, 4);
  assert.equal(decoded.rows.length, 1);
  const row = decoded.rows[0]!;
  assert.equal(row.showConformalGrid, true);
  assert.equal(row.conformalGridType, "polar");
  assert.equal(row.conformalGridSpacing, "0.25");
  assert.equal(row.showZeros, false);
  assert.equal(row.showPoles, false);
});

test("decodeComplexState: upgrades a v3 payload to v4, preserving every field into a single-row list", () => {
  const v3: ComplexStateV3 = {
    v: 3,
    exprText: "z^3 - 1",
    probeRe: "2",
    probeIm: "-1",
    showRootsOfUnity: false,
    rootsN: "7",
    showConformalGrid: true,
    conformalGridType: "polar",
    conformalGridSpacing: "0.25",
    showZeros: true,
    showPoles: true,
  };
  const encoded = encodeStateFragment(v3);
  const decoded = decodeComplexState(encoded);
  assert.ok(decoded);
  assert.equal(decoded.v, 4);
  assert.equal(decoded.rows.length, 1);
  const row = decoded.rows[0]!;
  assert.equal(row.exprText, "z^3 - 1");
  assert.equal(row.showZeros, true);
  assert.equal(row.showPoles, true);
  assert.equal(row.visible, true);
  assert.equal(typeof row.color, "number");
});

test("decodeComplexState: rejects a v4 payload with a malformed conformalGridType", () => {
  const bad = { ...DEFAULT_COMPLEX_STATE, rows: [{ ...DEFAULT_COMPLEX_STATE.rows[0], conformalGridType: "spiral" }] };
  const encoded = encodeStateFragment(bad);
  assert.equal(decodeComplexState(encoded), null);
});

test("decodeComplexState: rejects a v4 payload with a non-boolean showZeros/showPoles", () => {
  const badZeros = { ...DEFAULT_COMPLEX_STATE, rows: [{ ...DEFAULT_COMPLEX_STATE.rows[0], showZeros: "yes" }] };
  assert.equal(decodeComplexState(encodeStateFragment(badZeros)), null);
  const badPoles = { ...DEFAULT_COMPLEX_STATE, rows: [{ ...DEFAULT_COMPLEX_STATE.rows[0], showPoles: null }] };
  assert.equal(decodeComplexState(encodeStateFragment(badPoles)), null);
});

test("decodeComplexState: rejects a v4 payload whose rows are not an array", () => {
  assert.equal(decodeComplexState(encodeStateFragment({ v: 4, rows: "not-an-array" })), null);
});
