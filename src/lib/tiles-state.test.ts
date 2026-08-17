import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HEX_TILES_TEXT } from "./hex-tile-set-text.ts";
import { DEFAULT_TRI_TILES_TEXT } from "./tri-tile-set-text.ts";
import { DEFAULT_TILES_STATE, decodeTilesState, encodeTilesState, isTilesStateV1, isTilesStateV2, isTilesStateV3 } from "./tiles-state.ts";

test("round-trips the default tiles state through encode/decode", () => {
  const encoded = encodeTilesState(DEFAULT_TILES_STATE);
  assert.deepEqual(decodeTilesState(encoded), DEFAULT_TILES_STATE);
});

test("round-trips a v3 state with a custom tile set, size, solver, symmetry, and lattice", () => {
  const state = {
    v: 3 as const,
    tilesText: "A 1 2 3 4",
    width: 6,
    height: 2,
    solver: "torus" as const,
    showAnimation: false,
    symmetry: "rotations-reflections" as const,
    lattice: "hex" as const,
    hexTilesText: "A 1 2 3 4 5 6",
    triTilesText: "B 1 2 3 4",
  };
  assert.deepEqual(decodeTilesState(encodeTilesState(state)), state);
});

test("decodeTilesState upgrades a v2 payload to v3 with lattice 'square' and hex/tri text defaulted", () => {
  const v2 = {
    v: 2 as const,
    tilesText: "A 1 2 3 4",
    width: 6,
    height: 2,
    solver: "torus" as const,
    showAnimation: false,
    symmetry: "rotations-reflections" as const,
  };
  const fragment = btoa(JSON.stringify(v2)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.deepEqual(decodeTilesState(fragment), {
    ...v2,
    v: 3,
    lattice: "square",
    hexTilesText: DEFAULT_HEX_TILES_TEXT,
    triTilesText: DEFAULT_TRI_TILES_TEXT,
  });
});

test("decodeTilesState upgrades a v1 payload all the way to v3", () => {
  const v1 = { v: 1 as const, tilesText: "A 1 2 3 4", width: 6, height: 2, solver: "torus" as const, showAnimation: false };
  const fragment = btoa(JSON.stringify(v1)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.deepEqual(decodeTilesState(fragment), {
    ...v1,
    v: 3,
    symmetry: "none",
    lattice: "square",
    hexTilesText: DEFAULT_HEX_TILES_TEXT,
    triTilesText: DEFAULT_TRI_TILES_TEXT,
  });
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

test("isTilesStateV2 rejects an unrecognized symmetry value", () => {
  assert.equal(
    isTilesStateV2({ v: 2, tilesText: "x", width: 1, height: 1, solver: "wang", showAnimation: true, symmetry: "bogus" }),
    false,
  );
});

test("isTilesStateV2 rejects a v1-shaped payload (missing symmetry)", () => {
  assert.equal(isTilesStateV2({ v: 1, tilesText: "x", width: 1, height: 1, solver: "wang", showAnimation: true }), false);
});

test("isTilesStateV3 rejects an unrecognized lattice value", () => {
  assert.equal(
    isTilesStateV3({
      v: 3,
      tilesText: "x",
      width: 1,
      height: 1,
      solver: "wang",
      showAnimation: true,
      symmetry: "none",
      lattice: "bogus",
      hexTilesText: "",
      triTilesText: "",
    }),
    false,
  );
});

test("isTilesStateV3 rejects a v2-shaped payload (missing lattice/hexTilesText/triTilesText)", () => {
  assert.equal(
    isTilesStateV3({ v: 2, tilesText: "x", width: 1, height: 1, solver: "wang", showAnimation: true, symmetry: "none" }),
    false,
  );
});
