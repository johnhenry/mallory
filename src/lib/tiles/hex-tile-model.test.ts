import assert from "node:assert/strict";
import { test } from "node:test";
import { type HexDirection, hexNeighbor } from "mallory-math";
import { buildHexCompatibilityDigraph, hexTilesCompatible, solveHex, type HexGrid, type HexTile } from "./hex-tile-model.ts";

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{ steps: T[]; result: R }> {
  const steps: T[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    next = await gen.next();
  }
  return { steps, result: next.value };
}

test("hexTilesCompatible: matches when a's edge in direction d equals b's edge in the OPPOSITE direction, hand-computed with all 6 edges distinct so a same-direction bug can't hide", () => {
  const a: HexTile = { id: "a", edges: { 0: "e0", 1: "e1", 2: "e2", 3: "e3", 4: "e4", 5: "e5" } };
  const b: HexTile = { id: "b", edges: { 0: "e3", 1: "e4", 2: "e5", 3: "e0", 4: "e1", 5: "e2" } };
  for (let d = 0; d < 6; d++) {
    assert.equal(hexTilesCompatible(a, b, d as HexDirection), true, `direction ${d}`);
  }
});

test("hexTilesCompatible: false when the opposite edge doesn't match", () => {
  const a: HexTile = { id: "a", edges: { 0: "x", 1: "x", 2: "x", 3: "x", 4: "x", 5: "x" } };
  const b: HexTile = { id: "b", edges: { 0: "y", 1: "y", 2: "y", 3: "y", 4: "y", 5: "y" } };
  assert.equal(hexTilesCompatible(a, b, 0), false);
});

test("buildHexCompatibilityDigraph: hand-computed for 2 tiles compatible in exactly one direction", () => {
  // a -> b holds (a.edges[0]="m" === b.edges[3]="m"); b -> a does NOT
  // (b.edges[0]="q" !== a.edges[3]="p") -- distinct non-"m" fillers on
  // both sides so the two directions can't accidentally agree.
  const a: HexTile = { id: "a", edges: { 0: "m", 1: "p", 2: "p", 3: "p", 4: "p", 5: "p" } };
  const b: HexTile = { id: "b", edges: { 0: "q", 1: "p", 2: "p", 3: "m", 4: "p", 5: "p" } };
  const digraph = buildHexCompatibilityDigraph([a, b], 0);
  assert.deepEqual(digraph.get("a"), new Set(["b"]));
  assert.deepEqual(digraph.get("b"), new Set());
});

test("solveHex: a single uniform-edge tile solves any size patch", async () => {
  const tile: HexTile = { id: "u", edges: { 0: "x", 1: "x", 2: "x", 3: "x", 4: "x", 5: "x" } };
  const { result } = await drain(solveHex({ tiles: [tile] }, 3, 2));
  assert.ok(result);
  const grid = result as HexGrid;
  assert.equal(grid.length, 2);
  assert.equal(grid[0]!.length, 3);
  for (const row of grid) for (const id of row) assert.equal(id, "u");
});

test("solveHex: a self-incompatible tile fails for a patch bigger than 1x1, hand-derived", () => {
  // direction 0 and 3 are opposites (OPPOSITE_HEX_DIRECTION); edges differ there.
  const tile: HexTile = { id: "t", edges: { 0: "a", 1: "x", 2: "x", 3: "b", 4: "x", 5: "x" } };
  return drain(solveHex({ tiles: [tile] }, 2, 1)).then(({ result }) => assert.equal(result, null));
});

test("solveHex: a solved grid is fully hex-compatible in every direction, not just the 3 checked during the search", async () => {
  // Self-compatible in ALL directions by construction: edges[0]=edges[3]="1", edges[1]=edges[4]="2", edges[2]=edges[5]="3".
  const tile: HexTile = { id: "P", edges: { 0: "1", 1: "2", 2: "3", 3: "1", 4: "2", 5: "3" } };
  const width = 3;
  const height = 3;
  const { result } = await drain(solveHex({ tiles: [tile] }, width, height));
  assert.ok(result);
  const grid = result as HexGrid;
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      for (let d = 0; d < 6; d++) {
        const [nq, nr] = hexNeighbor(q, r, d as HexDirection);
        if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
        assert.equal(grid[r]![q], "P");
        assert.equal(grid[nr]![nq], "P");
        assert.ok(hexTilesCompatible(tile, tile, d as HexDirection), `direction ${d} at (${q},${r})`);
      }
    }
  }
});

test("solveHex: steps include both placements and (for an unsatisfiable set) a final backtrack", async () => {
  const tile: HexTile = { id: "t", edges: { 0: "a", 1: "x", 2: "x", 3: "b", 4: "x", 5: "x" } };
  const { steps, result } = await drain(solveHex({ tiles: [tile] }, 2, 1));
  assert.equal(result, null);
  assert.ok(steps.length > 0);
  assert.ok(steps.some((s) => s.contradiction));
});
