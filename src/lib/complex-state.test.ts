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
  type ComplexStateV1,
  type ComplexStateV2,
} from "./complex-state.ts";

test("encodeComplexState/decodeComplexState: round-trips the default state", () => {
  const encoded = encodeComplexState(DEFAULT_COMPLEX_STATE);
  const decoded = decodeComplexState(encoded);
  assert.deepEqual(decoded, DEFAULT_COMPLEX_STATE);
});

test("decodeComplexState: returns null for garbage input rather than throwing", () => {
  assert.equal(decodeComplexState("not-valid-base64url!!"), null);
  assert.equal(decodeComplexState(""), null);
});

test("isComplexStateV1/isComplexStateV2/isComplexStateV3: distinguish the three shapes by their v tag", () => {
  const v1: ComplexStateV1 = { v: 1, exprText: "z^2", probeRe: "0", probeIm: "0", showRootsOfUnity: false, rootsN: "3" };
  assert.equal(isComplexStateV1(v1), true);
  assert.equal(isComplexStateV2(v1), false);
  assert.equal(isComplexStateV3(v1), false);
  assert.equal(isComplexStateV1(DEFAULT_COMPLEX_STATE), false);
  assert.equal(isComplexStateV2(DEFAULT_COMPLEX_STATE), false);
  assert.equal(isComplexStateV3(DEFAULT_COMPLEX_STATE), true);
});

test("decodeComplexState: upgrades a v1 payload all the way to v3, defaulting the conformal-grid and zeros/poles fields off", () => {
  const v1: ComplexStateV1 = { v: 1, exprText: "1/z", probeRe: "2", probeIm: "-1", showRootsOfUnity: true, rootsN: "7" };
  const encoded = encodeStateFragment(v1);
  const decoded = decodeComplexState(encoded);
  assert.ok(decoded);
  assert.equal(decoded.v, 3);
  assert.equal(decoded.exprText, "1/z");
  assert.equal(decoded.probeRe, "2");
  assert.equal(decoded.probeIm, "-1");
  assert.equal(decoded.showRootsOfUnity, true);
  assert.equal(decoded.rootsN, "7");
  assert.equal(decoded.showConformalGrid, false);
  assert.equal(decoded.conformalGridType, "rectangular");
  assert.equal(decoded.conformalGridSpacing, "0.5");
  assert.equal(decoded.showZeros, false);
  assert.equal(decoded.showPoles, false);
});

test("decodeComplexState: upgrades a v2 payload to v3, defaulting showZeros/showPoles off and preserving the conformal-grid fields", () => {
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
  assert.equal(decoded.v, 3);
  assert.equal(decoded.showConformalGrid, true);
  assert.equal(decoded.conformalGridType, "polar");
  assert.equal(decoded.conformalGridSpacing, "0.25");
  assert.equal(decoded.showZeros, false);
  assert.equal(decoded.showPoles, false);
});

test("decodeComplexState: rejects a v3 payload with a malformed conformalGridType", () => {
  const bad = { ...DEFAULT_COMPLEX_STATE, conformalGridType: "spiral" };
  const encoded = encodeStateFragment(bad);
  assert.equal(decodeComplexState(encoded), null);
});

test("decodeComplexState: rejects a v3 payload with a non-boolean showZeros/showPoles", () => {
  const badZeros = { ...DEFAULT_COMPLEX_STATE, showZeros: "yes" };
  assert.equal(decodeComplexState(encodeStateFragment(badZeros)), null);
  const badPoles = { ...DEFAULT_COMPLEX_STATE, showPoles: null };
  assert.equal(decodeComplexState(encodeStateFragment(badPoles)), null);
});
