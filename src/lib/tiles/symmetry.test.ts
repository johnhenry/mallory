import assert from "node:assert/strict";
import { test } from "node:test";
import { expandTileSetSymmetry } from "./symmetry.ts";
import type { Tile, TileSet } from "./tile-model.ts";

function edgeTuple(t: Tile): string {
  return `${t.edges.N}|${t.edges.E}|${t.edges.S}|${t.edges.W}`;
}

test("expandTileSetSymmetry('none') returns the tile set unchanged", () => {
  const ts: TileSet = { tiles: [{ id: "a", edges: { N: "0", E: "1", S: "2", W: "3" } }] };
  assert.deepEqual(expandTileSetSymmetry(ts, "none"), ts);
});

test("expandTileSetSymmetry('rotations') on a fully-asymmetric tile produces exactly its 4 cyclic rotations, hand-computed", () => {
  // Physical 90deg-clockwise rotation moves the label on each edge to the
  // NEXT edge clockwise (N->E->S->W->N), i.e. what was on W becomes the new N.
  const ts: TileSet = { tiles: [{ id: "a", edges: { N: "a", E: "b", S: "c", W: "d" } }] };
  const expanded = expandTileSetSymmetry(ts, "rotations");
  const got = new Set(expanded.tiles.map(edgeTuple));
  const expected = new Set([
    "a|b|c|d", // 0deg
    "d|a|b|c", // 90deg cw
    "c|d|a|b", // 180deg
    "b|c|d|a", // 270deg
  ]);
  assert.equal(got.size, 4, "4 distinct oriented variants, no accidental symmetry");
  assert.deepEqual(got, expected);
});

test("expandTileSetSymmetry('rotations-reflections') on a fully-asymmetric tile produces exactly 8 variants (D4 orbit)", () => {
  const ts: TileSet = { tiles: [{ id: "a", edges: { N: "a", E: "b", S: "c", W: "d" } }] };
  const expanded = expandTileSetSymmetry(ts, "rotations-reflections");
  const got = new Set(expanded.tiles.map(edgeTuple));
  assert.equal(got.size, 8, "D4 orbit of a fully-asymmetric tile has 8 elements");
  for (const rotation of ["a|b|c|d", "d|a|b|c", "c|d|a|b", "b|c|d|a"]) {
    assert.ok(got.has(rotation), `D4 orbit (superset of C4) must contain rotation ${rotation}`);
  }
});

test("expandTileSetSymmetry keeps a rotationally-symmetric tile as a single tile with its original id", () => {
  const ts: TileSet = { tiles: [{ id: "uniform", edges: { N: "x", E: "x", S: "x", W: "x" } }] };
  for (const group of ["rotations", "rotations-reflections"] as const) {
    const expanded = expandTileSetSymmetry(ts, group);
    assert.deepEqual(expanded.tiles, [{ id: "uniform", edges: { N: "x", E: "x", S: "x", W: "x" } }]);
  }
});

test("expandTileSetSymmetry: a checkerboard tile (N=S, E=W, N!=E) has a 2-element rotation orbit (order-2 stabilizer)", () => {
  const ts: TileSet = { tiles: [{ id: "cb", edges: { N: "p", E: "q", S: "p", W: "q" } }] };
  const expanded = expandTileSetSymmetry(ts, "rotations");
  const got = new Set(expanded.tiles.map(edgeTuple));
  assert.equal(got.size, 2);
  assert.ok(got.has("p|q|p|q"));
  assert.ok(got.has("q|p|q|p"));
});

test("expanded tile ids are always unique across a multi-tile set with mixed orbit sizes", () => {
  const ts: TileSet = {
    tiles: [
      { id: "asym", edges: { N: "a", E: "b", S: "c", W: "d" } },
      { id: "uniform", edges: { N: "1", E: "1", S: "1", W: "1" } },
    ],
  };
  const expanded = expandTileSetSymmetry(ts, "rotations-reflections");
  const ids = expanded.tiles.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "no id collisions across tiles with different orbit sizes");
  assert.ok(ids.includes("uniform"), "singleton-orbit tile keeps its original id");
});
