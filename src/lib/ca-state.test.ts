import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CA_STATE, decodeCaState, encodeCaState, isCaStateV1 } from "./ca-state.ts";

test("round-trips the default ca state through encode/decode", () => {
  const encoded = encodeCaState(DEFAULT_CA_STATE);
  assert.deepEqual(decodeCaState(encoded), DEFAULT_CA_STATE);
});

test("round-trips a custom state with a 2D dimension and non-default fields", () => {
  const state = {
    ...DEFAULT_CA_STATE,
    dimension: "2d" as const,
    bsRule: "B36/S23",
    width2d: 25,
    height2d: 25,
    generations2d: 15,
    boundary2d: "wrap" as const,
    showVoxelView: true,
  };
  assert.deepEqual(decodeCaState(encodeCaState(state)), state);
});

test("decodeCaState returns null for garbage or wrong-shape input rather than throwing", () => {
  assert.equal(decodeCaState("not-valid-base64!!"), null);
  assert.equal(decodeCaState(""), null);
});

test("isCaStateV1 rejects an unrecognized dimension", () => {
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, dimension: "3d" }), false);
});

test("isCaStateV1 rejects an unrecognized boundary1d/boundary2d/initial1d", () => {
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, boundary1d: "bogus" }), false);
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, boundary2d: "bogus" }), false);
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, initial1d: "bogus" }), false);
});

test("isCaStateV1 rejects missing/wrong-typed fields", () => {
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, ruleNumber: "30" }), false);
  assert.equal(isCaStateV1(null), false);
  const { showVoxelView: _omit, ...missingField } = DEFAULT_CA_STATE;
  assert.equal(isCaStateV1(missingField), false);
});
