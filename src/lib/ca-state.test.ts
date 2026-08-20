import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CA_STATE, decodeCaState, encodeCaState, isCaStateV1, isCaStateV2, type CaState, type CaStateV1 } from "./ca-state.ts";

/** A hand-built V1 fixture (no `initial3d`/`customGrid3d`) -- `DEFAULT_CA_STATE` is V2 as of issue #389, so V1-specific tests need their own shape rather than reusing the default. */
function v1Fixture(): CaStateV1 {
  const { initial3d: _initial3d, customGrid3d: _customGrid3d, ...rest } = DEFAULT_CA_STATE;
  return { ...rest, v: 1 };
}

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

test("decodeCaState upgrades a V1 fragment to V2, defaulting initial3d to 'random' and customGrid3d to '' (issue #389)", () => {
  const v1 = v1Fixture();
  const decoded = decodeCaState(encodeCaState(v1 as unknown as CaState));
  assert.deepEqual(decoded, { ...v1, v: 2, initial3d: "random", customGrid3d: "" });
});

test("isCaStateV2 rejects an unrecognized dimension", () => {
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, dimension: "4d" }), false);
});

test("isCaStateV2 rejects an unrecognized boundary1d/boundary2d/boundary3d/initial1d/initial2d/initial3d", () => {
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, boundary1d: "bogus" }), false);
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, boundary2d: "bogus" }), false);
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, boundary3d: "bogus" }), false);
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, initial1d: "bogus" }), false);
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, initial2d: "bogus" }), false);
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, initial3d: "bogus" }), false);
});

test("isCaStateV2 accepts initial1d/initial2d/initial3d: 'custom' and rejects a missing/non-string customGrid1d/customGrid2d/customGrid3d", () => {
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, initial1d: "custom" }), true);
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, initial2d: "custom" }), true);
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, initial3d: "custom" }), true);
  const { customGrid1d: _omit1, ...missingGrid1d } = DEFAULT_CA_STATE;
  assert.equal(isCaStateV2(missingGrid1d), false);
  const { customGrid2d: _omit2, ...missingGrid2d } = DEFAULT_CA_STATE;
  assert.equal(isCaStateV2(missingGrid2d), false);
  const { customGrid3d: _omit3, ...missingGrid3d } = DEFAULT_CA_STATE;
  assert.equal(isCaStateV2(missingGrid3d), false);
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, customGrid1d: 42 }), false);
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

test("round-trips a custom state with a painted 3D custom initial volume (issue #389)", () => {
  const state = {
    ...DEFAULT_CA_STATE,
    dimension: "3d" as const,
    initial3d: "custom" as const,
    width3d: 2,
    height3d: 2,
    depth3d: 2,
    customGrid3d: "10011100",
  };
  assert.deepEqual(decodeCaState(encodeCaState(state)), state);
});

test("isCaStateV2 rejects missing/wrong-typed fields", () => {
  assert.equal(isCaStateV2({ ...DEFAULT_CA_STATE, ruleNumber: "30" }), false);
  assert.equal(isCaStateV2(null), false);
  const { showVoxelView: _omit, ...missingField } = DEFAULT_CA_STATE;
  assert.equal(isCaStateV2(missingField), false);
});

test("isCaStateV1: accepts a well-formed V1 fixture and rejects a V2 one (wrong v tag)", () => {
  assert.equal(isCaStateV1(v1Fixture()), true);
  assert.equal(isCaStateV1(DEFAULT_CA_STATE), false, "DEFAULT_CA_STATE is v2 as of issue #389");
});

test("isCaStateV2: rejects a well-formed V1 fixture (missing initial3d/customGrid3d, wrong v tag)", () => {
  assert.equal(isCaStateV2(v1Fixture()), false);
});
