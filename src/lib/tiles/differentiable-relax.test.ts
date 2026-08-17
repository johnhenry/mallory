import assert from "node:assert/strict";
import { test } from "node:test";
import { relaxWangTiling } from "./differentiable-relax.ts";
import type { Tile, TileSet } from "./tile-model.ts";

test("relaxWangTiling: rejects non-positive/non-integer width, height, steps, and lr", () => {
  const tileSet: TileSet = { tiles: [{ id: "u", edges: { N: "x", E: "x", S: "x", W: "x" } }] };
  assert.throws(() => relaxWangTiling(tileSet, 0, 2), /width/);
  assert.throws(() => relaxWangTiling(tileSet, 1.5, 2), /width/);
  assert.throws(() => relaxWangTiling(tileSet, 2, 0), /height/);
  assert.throws(() => relaxWangTiling(tileSet, 2, 2, { steps: 0 }), /steps/);
  assert.throws(() => relaxWangTiling(tileSet, 2, 2, { lr: 0 }), /lr/);
  assert.throws(() => relaxWangTiling(tileSet, 2, 2, { lr: -1 }), /lr/);
});

test("relaxWangTiling: rejects an empty tile set", () => {
  assert.throws(() => relaxWangTiling({ tiles: [] }, 2, 2), /Tile set is empty/);
});

test("relaxWangTiling: a single uniform-edge tile is trivially valid on any grid (only one tile choice exists)", () => {
  const tile: Tile = { id: "u", edges: { N: "x", E: "x", S: "x", W: "x" } };
  const result = relaxWangTiling({ tiles: [tile] }, 3, 2, { steps: 20, seed: 1 });
  assert.equal(result.valid, true);
  assert.equal(result.grid.length, 2);
  assert.equal(result.grid[0]!.length, 3);
  for (const row of result.grid) for (const id of row) assert.equal(id, "u");
});

test("relaxWangTiling: a single tile that's E/W-incompatible with itself can never be valid on a 2x1 grid, no matter how much training", () => {
  const tile: Tile = { id: "t", edges: { N: "x", E: "a", S: "x", W: "b" } };
  const result = relaxWangTiling({ tiles: [tile] }, 2, 1, { steps: 50, seed: 1 });
  assert.equal(result.valid, false);
});

test("relaxWangTiling: energyHistory has one entry per step, and every entry is non-negative (a mismatch mass over probability distributions)", () => {
  const tileSet: TileSet = { tiles: [{ id: "u", edges: { N: "x", E: "x", S: "x", W: "x" } }] };
  const result = relaxWangTiling(tileSet, 2, 2, { steps: 15, seed: 1 });
  assert.equal(result.energyHistory.length, 15);
  for (const e of result.energyHistory) assert.ok(e >= -1e-9, `energy ${e} should be non-negative`);
});

test("relaxWangTiling: same seed produces the same grid and energy trajectory (deterministic init)", () => {
  const tileSet: TileSet = { tiles: [{ id: "u", edges: { N: "x", E: "x", S: "x", W: "x" } }] };
  const a = relaxWangTiling(tileSet, 3, 3, { steps: 10, seed: 42 });
  const b = relaxWangTiling(tileSet, 3, 3, { steps: 10, seed: 42 });
  assert.deepEqual(a.grid, b.grid);
  assert.deepEqual(a.energyHistory, b.energyHistory);
});

test("relaxWangTiling: a genuinely 2-tile compatible set converges to a valid (non-uniform) tiling on a 1x2 row -- real optimization, not a structurally-forced trivial case", () => {
  // A.E("1") matches B.W("1"); B.E("9") matches A.W("9") -- so [A,B] and [B,A]
  // are both valid, but [A,A] and [B,B] are both invalid (hand-checked: A.E
  // vs A.W = "1" vs "9", B.E vs B.W = "9" vs "1", neither matches itself).
  const a: Tile = { id: "A", edges: { N: "x", E: "1", S: "x", W: "9" } };
  const b: Tile = { id: "B", edges: { N: "x", E: "9", S: "x", W: "1" } };
  const result = relaxWangTiling({ tiles: [a, b] }, 2, 1, { steps: 400, lr: 0.5, seed: 7 });
  assert.equal(result.valid, true);
  assert.notEqual(result.grid[0]![0], result.grid[0]![1]);
});
