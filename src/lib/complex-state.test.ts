import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_COMPLEX_STATE,
  decodeComplexState,
  encodeComplexState,
  isComplexStateV1,
  isComplexStateV2,
  type ComplexStateV1,
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

test("isComplexStateV1/isComplexStateV2: distinguish the two shapes by their v tag", () => {
  const v1: ComplexStateV1 = { v: 1, exprText: "z^2", probeRe: "0", probeIm: "0", showRootsOfUnity: false, rootsN: "3" };
  assert.equal(isComplexStateV1(v1), true);
  assert.equal(isComplexStateV2(v1), false);
  assert.equal(isComplexStateV1(DEFAULT_COMPLEX_STATE), false);
  assert.equal(isComplexStateV2(DEFAULT_COMPLEX_STATE), true);
});

test("decodeComplexState: upgrades a v1 payload to v2, defaulting the conformal-grid fields off", () => {
  const v1: ComplexStateV1 = { v: 1, exprText: "1/z", probeRe: "2", probeIm: "-1", showRootsOfUnity: true, rootsN: "7" };
  const encoded = Buffer.from(JSON.stringify(v1)).toString("base64url");
  const decoded = decodeComplexState(encoded);
  assert.ok(decoded);
  assert.equal(decoded.v, 2);
  assert.equal(decoded.exprText, "1/z");
  assert.equal(decoded.probeRe, "2");
  assert.equal(decoded.probeIm, "-1");
  assert.equal(decoded.showRootsOfUnity, true);
  assert.equal(decoded.rootsN, "7");
  assert.equal(decoded.showConformalGrid, false);
  assert.equal(decoded.conformalGridType, "rectangular");
  assert.equal(decoded.conformalGridSpacing, "0.5");
});

test("decodeComplexState: rejects a v2 payload with a malformed conformalGridType", () => {
  const bad = { ...DEFAULT_COMPLEX_STATE, conformalGridType: "spiral" };
  const encoded = Buffer.from(JSON.stringify(bad)).toString("base64url");
  assert.equal(decodeComplexState(encoded), null);
});
