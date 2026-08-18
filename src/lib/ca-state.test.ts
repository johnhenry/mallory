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
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, dimension: "4d" }), false);
});

test("isCaStateV1 rejects an unrecognized boundary1d/boundary2d/boundary3d/initial1d/initial2d", () => {
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, boundary1d: "bogus" }), false);
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, boundary2d: "bogus" }), false);
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, boundary3d: "bogus" }), false);
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, initial1d: "bogus" }), false);
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, initial2d: "bogus" }), false);
});

test("isCaStateV1 accepts initial1d: 'custom' (issue #260) and rejects a missing/non-string customGrid1d/customGrid2d", () => {
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, initial1d: "custom" }), true);
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, initial2d: "custom" }), true);
  const { customGrid1d: _omit1, ...missingGrid1d } = DEFAULT_CA_STATE;
  assert.equal(isCaStateV1(missingGrid1d), false);
  const { customGrid2d: _omit2, ...missingGrid2d } = DEFAULT_CA_STATE;
  assert.equal(isCaStateV1(missingGrid2d), false);
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, customGrid1d: 42 }), false);
});

test("round-trips a custom state with a painted 1D custom initial row", () => {
  const state = {
    ...DEFAULT_CA_STATE,
    initial1d: "custom" as const,
    customGrid1d: "0001110100",
  };
  assert.deepEqual(decodeCaState(encodeCaState(state)), state);
});

test("round-trips a custom state with a painted 2D custom initial grid", () => {
  const state = {
    ...DEFAULT_CA_STATE,
    dimension: "2d" as const,
    initial2d: "custom" as const,
    width2d: 5,
    height2d: 5,
    customGrid2d: "0".repeat(25).split("").map((_, i) => (i % 3 === 0 ? "1" : "0")).join(""),
  };
  assert.deepEqual(decodeCaState(encodeCaState(state)), state);
});

test("round-trips a custom state with a 3D dimension and non-default fields", () => {
  const state = {
    ...DEFAULT_CA_STATE,
    dimension: "3d" as const,
    rule3d: "B4/S6,7,8",
    width3d: 8,
    height3d: 8,
    depth3d: 8,
    generations3d: 12,
    boundary3d: "wrap" as const,
    seed3d: 42,
    density3d: 0.25,
  };
  assert.deepEqual(decodeCaState(encodeCaState(state)), state);
});

test("isCaStateV1 rejects missing/wrong-typed fields", () => {
  assert.equal(isCaStateV1({ ...DEFAULT_CA_STATE, ruleNumber: "30" }), false);
  assert.equal(isCaStateV1(null), false);
  const { showVoxelView: _omit, ...missingField } = DEFAULT_CA_STATE;
  assert.equal(isCaStateV1(missingField), false);
});
