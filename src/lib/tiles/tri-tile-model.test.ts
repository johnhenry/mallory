import assert from "node:assert/strict";
import { test } from "node:test";
import { type TriDirection, triNeighbor, triOrientation } from "@johnhenry/math";
import { buildTriCompatibilityDigraph, solveTri, triTilesCompatible, type TriGrid, type TriTile } from "./tri-tile-model.ts";

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{ steps: T[]; result: R }> {
  const steps: T[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    next = await gen.next();
  }
  return { steps, result: next.value };
}

test("triTilesCompatible: left<->right and top<->bottom are the opposite pairs, hand-computed with all 4 edges distinct", () => {
  const a: TriTile = { id: "a", edges: { left: "L", right: "R", top: "T", bottom: "B" } };
  const b: TriTile = { id: "b", edges: { left: "R", right: "L", top: "B", bottom: "T" } };
  assert.equal(triTilesCompatible(a, b, "left"), true, "a.left(L) === b.right(L)");
  assert.equal(triTilesCompatible(a, b, "right"), true, "a.right(R) === b.left(R)");
  assert.equal(triTilesCompatible(a, b, "top"), true, "a.top(T) === b.bottom(T)");
  assert.equal(triTilesCompatible(a, b, "bottom"), true, "a.bottom(B) === b.top(B)");
});

test("triTilesCompatible: false when the opposite edge doesn't match", () => {
  const a: TriTile = { id: "a", edges: { left: "x", right: "x", top: "x", bottom: "x" } };
  const b: TriTile = { id: "b", edges: { left: "y", right: "y", top: "y", bottom: "y" } };
  assert.equal(triTilesCompatible(a, b, "left"), false);
});

test("buildTriCompatibilityDigraph: hand-computed for 2 tiles compatible in exactly one direction", () => {
  // a -> b holds (a.left="m" === b.right="m"); b -> a does NOT
  // (b.left="q" !== a.right="p") -- distinct non-"m" fillers on both
  // sides so the two directions can't accidentally agree (the exact bug
  // caught in hex-tile-model.test.ts's first draft).
  const a: TriTile = { id: "a", edges: { left: "m", right: "p", top: "p", bottom: "p" } };
  const b: TriTile = { id: "b", edges: { left: "q", right: "m", top: "p", bottom: "p" } };
  const digraph = buildTriCompatibilityDigraph([a, b], "left");
  assert.deepEqual(digraph.get("a"), new Set(["b"]));
  assert.deepEqual(digraph.get("b"), new Set());
});

test("solveTri: a fully self-compatible tile (left=right, top=bottom) solves any size patch", async () => {
  const tile: TriTile = { id: "u", edges: { left: "L", right: "L", top: "T", bottom: "T" } };
  const { result } = await drain(solveTri({ tiles: [tile] }, 4, 3));
  assert.ok(result);
  const grid = result as TriGrid;
  assert.equal(grid.length, 3);
  assert.equal(grid[0]!.length, 4);
  for (const row of grid) for (const id of row) assert.equal(id, "u");
});

test("solveTri: a left/right-incompatible tile fails for a 2x1 patch, hand-derived", async () => {
  const tile: TriTile = { id: "t", edges: { left: "a", right: "b", top: "x", bottom: "x" } };
  const { result } = await drain(solveTri({ tiles: [tile] }, 2, 1));
  assert.equal(result, null);
});

test("solveTri: a solved grid is fully tri-compatible between every adjacent cell pair, not just the directions checked during the search", async () => {
  const tile: TriTile = { id: "P", edges: { left: "L", right: "L", top: "T", bottom: "T" } };
  const width = 4;
  const height = 4;
  const { result } = await drain(solveTri({ tiles: [tile] }, width, height));
  assert.ok(result);
  const grid = result as TriGrid;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const orientation = triOrientation(x, y);
      const directions: readonly TriDirection[] = orientation === "up" ? ["left", "right", "top"] : ["left", "right", "bottom"];
      for (const d of directions) {
        const [nx, ny] = triNeighbor(x, y, d);
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        assert.equal(grid[y]![x], "P");
        assert.equal(grid[ny]![nx], "P");
        assert.ok(triTilesCompatible(tile, tile, d), `direction ${d} at (${x},${y})`);
      }
    }
  }
});

test("solveTri: steps include both placements and (for an unsatisfiable set) a final backtrack", async () => {
  const tile: TriTile = { id: "t", edges: { left: "a", right: "b", top: "x", bottom: "x" } };
  const { steps, result } = await drain(solveTri({ tiles: [tile] }, 2, 1));
  assert.equal(result, null);
  assert.ok(steps.length > 0);
  assert.ok(steps.some((s) => s.contradiction));
});

test("solveTri: trackSteps: false yields grid: null on every step but doesn't change the final result", async () => {
  const tile: TriTile = { id: "t", edges: { left: "a", right: "b", top: "x", bottom: "x" } };
  const { steps, result } = await drain(solveTri({ tiles: [tile] }, 2, 1, { trackSteps: false }));
  assert.equal(result, null);
  assert.ok(steps.length > 0);
  for (const step of steps) assert.equal(step.grid, null);
});
