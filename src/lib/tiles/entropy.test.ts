import assert from "node:assert/strict";
import { test } from "node:test";
import { buildValidColumns, stripEntropy } from "./entropy.ts";
import { buildCompatibilityDigraph, type Tile, type TileSet } from "./tile-model.ts";

test("buildValidColumns rejects height < 1", () => {
  assert.throws(() => buildValidColumns({ tiles: [] }, 0), RangeError);
});

test("buildValidColumns: height 2 keeps only vertically-compatible tile pairs, hand-computed", () => {
  const P: Tile = { id: "P", edges: { N: "0", S: "1", E: "e", W: "e" } };
  const Q: Tile = { id: "Q", edges: { N: "1", S: "0", E: "e", W: "e" } };
  const columns = buildValidColumns({ tiles: [P, Q] }, 2);
  const asStrings = new Set(columns.map((col) => col.map((t) => t.id).join(",")));
  assert.deepEqual(asStrings, new Set(["P,Q", "Q,P"]));
});

test("stripEntropy: N tiles with identical edges form a complete transfer graph -- entropy = ln(N) at height 1", () => {
  const numTiles = 3;
  const tiles: Tile[] = Array.from({ length: numTiles }, (_, i) => ({
    id: `t${i}`,
    edges: { N: "u", E: "u", S: "u", W: "u" },
  }));
  const result = stripEntropy({ tiles }, 1);
  assert.equal(result.numColumns, numTiles);
  assert.ok(result.converged);
  assert.ok(
    Math.abs(result.dominantEigenvalue - numTiles) < 1e-6,
    `expected dominant eigenvalue ${numTiles}, got ${result.dominantEigenvalue}`,
  );
  assert.ok(Math.abs(result.entropy - Math.log(numTiles)) < 1e-6);
});

test("stripEntropy: the same full-shift fixture gives the SAME entropy at height 2 (exact, not merely converging)", () => {
  const numTiles = 3;
  const tiles: Tile[] = Array.from({ length: numTiles }, (_, i) => ({
    id: `t${i}`,
    edges: { N: "u", E: "u", S: "u", W: "u" },
  }));
  const result = stripEntropy({ tiles }, 2);
  assert.equal(result.numColumns, numTiles * numTiles);
  assert.ok(Math.abs(result.entropy - Math.log(numTiles)) < 1e-6);
});

test("stripEntropy at height 1: numColumns matches buildCompatibilityDigraph('E')'s own tile count (both are the height-1 transfer relation)", () => {
  const A: Tile = { id: "A", edges: { N: "x", S: "x", E: "1", W: "2" } };
  const B: Tile = { id: "B", edges: { N: "x", S: "x", E: "2", W: "1" } };
  const C: Tile = { id: "C", edges: { N: "x", S: "x", E: "3", W: "3" } };
  const tileSet: TileSet = { tiles: [A, B, C] };
  const digraph = buildCompatibilityDigraph(tileSet.tiles, "E");
  const columns = buildValidColumns(tileSet, 1);
  assert.equal(columns.length, digraph.size);
});

test("stripEntropy throws a domain-specific error when the transfer relation has no cycle (nilpotent transfer matrix)", () => {
  // Only A -> B holds (A.E="1" matches B.W="1"); neither B -> A nor A -> A
  // nor B -> B holds, so the transfer digraph is a single edge, not a cycle.
  const A: Tile = { id: "A", edges: { N: "x", S: "x", E: "1", W: "9" } };
  const B: Tile = { id: "B", edges: { N: "x", S: "x", E: "5", W: "1" } };
  assert.throws(() => stripEntropy({ tiles: [A, B] }, 1), /no cycle/);
});

test("stripEntropy throws a distinct error when NO valid column exists at all", () => {
  // A.S ("1") never matches A.N ("0"), so no height-2 column can be built
  // from this single-tile set -- a different failure mode than "has
  // columns but no cycle among them."
  const A: Tile = { id: "A", edges: { N: "0", S: "1", E: "e", W: "e" } };
  assert.throws(() => stripEntropy({ tiles: [A] }, 2), /admits no valid height-2 column/);
});
