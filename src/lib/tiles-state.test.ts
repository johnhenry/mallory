import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TILES_STATE, decodeTilesState, encodeTilesState, isTilesStateV1 } from "./tiles-state.ts";

test("round-trips the default tiles state through encode/decode", () => {
  const encoded = encodeTilesState(DEFAULT_TILES_STATE);
  assert.deepEqual(decodeTilesState(encoded), DEFAULT_TILES_STATE);
});

test("round-trips a state with a custom tile set, size, and solver", () => {
  const state = { v: 1 as const, tilesText: "A 1 2 3 4", width: 6, height: 2, solver: "torus" as const, showAnimation: false };
  assert.deepEqual(decodeTilesState(encodeTilesState(state)), state);
});

test("decodeTilesState returns null for garbage or wrong-shape input rather than throwing", () => {
  assert.equal(decodeTilesState("not-valid-base64!!"), null);
  assert.equal(decodeTilesState(""), null);
});

test("isTilesStateV1 rejects an unrecognized solver value", () => {
  assert.equal(isTilesStateV1({ v: 1, tilesText: "x", width: 1, height: 1, solver: "bogus", showAnimation: true }), false);
});

test("isTilesStateV1 rejects missing/wrong-typed fields", () => {
  assert.equal(isTilesStateV1({ v: 1, tilesText: "x", width: "4", height: 1, solver: "wang", showAnimation: true }), false);
  assert.equal(isTilesStateV1({ v: 2, tilesText: "x", width: 1, height: 1, solver: "wang", showAnimation: true }), false);
  assert.equal(isTilesStateV1(null), false);
});
