import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCubeCompatibilityDigraph, cubeTilesCompatible, solveCube, type CubeDirection, type CubeGrid, type CubeTile } from "./cube-tile-model.ts";

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{ steps: T[]; result: R }> {
  const steps: T[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    next = await gen.next();
  }
  return { steps, result: next.value };
}

test("cubeTilesCompatible: matches when a's face in direction d equals b's face in the OPPOSITE direction, hand-computed with all 6 faces distinct", () => {
  const a: CubeTile = { id: "a", faces: { N: "n", S: "s", E: "e", W: "w", U: "u", D: "d" } };
  const b: CubeTile = { id: "b", faces: { N: "s", S: "n", E: "w", W: "e", U: "d", D: "u" } };
  for (const d of ["N", "S", "E", "W", "U", "D"] as CubeDirection[]) {
    assert.equal(cubeTilesCompatible(a, b, d), true, `direction ${d}`);
  }
});

test("cubeTilesCompatible: false when the opposite face doesn't match", () => {
  const a: CubeTile = { id: "a", faces: { N: "x", S: "x", E: "x", W: "x", U: "x", D: "x" } };
  const b: CubeTile = { id: "b", faces: { N: "y", S: "y", E: "y", W: "y", U: "y", D: "y" } };
  assert.equal(cubeTilesCompatible(a, b, "N"), false);
});

test("buildCubeCompatibilityDigraph: hand-computed for 2 tiles compatible in exactly one direction", () => {
  const a: CubeTile = { id: "a", faces: { N: "m", S: "p", E: "p", W: "p", U: "p", D: "p" } };
  const b: CubeTile = { id: "b", faces: { N: "q", S: "m", E: "p", W: "p", U: "p", D: "p" } };
  const digraph = buildCubeCompatibilityDigraph([a, b], "N");
  assert.deepEqual(digraph.get("a"), new Set(["b"]));
  assert.deepEqual(digraph.get("b"), new Set());
});

test("solveCube: a single uniform-face tile solves any box size", async () => {
  const tile: CubeTile = { id: "u", faces: { N: "x", S: "x", E: "x", W: "x", U: "x", D: "x" } };
  const { result } = await drain(solveCube({ tiles: [tile] }, 2, 2, 2));
  assert.ok(result);
  const grid = result as CubeGrid;
  assert.equal(grid.length, 2);
  assert.equal(grid[0]!.length, 2);
  assert.equal(grid[0]![0]!.length, 2);
  for (const layer of grid) for (const row of layer) for (const id of row) assert.equal(id, "u");
});

test("solveCube: a W/E-incompatible tile fails for a 2x1x1 box, hand-derived", async () => {
  const tile: CubeTile = { id: "t", faces: { N: "x", S: "x", E: "b", W: "a", U: "x", D: "x" } };
  const { result } = await drain(solveCube({ tiles: [tile] }, 2, 1, 1));
  assert.equal(result, null);
});

test("solveCube: a solved box is fully cube-compatible between every adjacent cell pair, not just the 3 directions checked during the search", async () => {
  // Self-compatible in ALL directions by construction: N=S="1", E=W="2", U=D="3".
  const tile: CubeTile = { id: "P", faces: { N: "1", S: "1", E: "2", W: "2", U: "3", D: "3" } };
  const width = 2;
  const height = 2;
  const depth = 2;
  const { result } = await drain(solveCube({ tiles: [tile] }, width, height, depth));
  assert.ok(result);
  const grid = result as CubeGrid;
  const neighborOffsets: Record<CubeDirection, [number, number, number]> = {
    N: [0, -1, 0],
    S: [0, 1, 0],
    E: [1, 0, 0],
    W: [-1, 0, 0],
    U: [0, 0, 1],
    D: [0, 0, -1],
  };
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (const d of ["N", "S", "E", "W", "U", "D"] as CubeDirection[]) {
          const [dx, dy, dz] = neighborOffsets[d];
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || nz < 0 || nz >= depth) continue;
          assert.equal(grid[z]![y]![x], "P");
          assert.equal(grid[nz]![ny]![nx], "P");
          assert.ok(cubeTilesCompatible(tile, tile, d), `direction ${d} at (${x},${y},${z})`);
        }
      }
    }
  }
});

test("solveCube: steps include both placements and (for an unsatisfiable set) a final backtrack", async () => {
  const tile: CubeTile = { id: "t", faces: { N: "x", S: "x", E: "b", W: "a", U: "x", D: "x" } };
  const { steps, result } = await drain(solveCube({ tiles: [tile] }, 2, 1, 1));
  assert.equal(result, null);
  assert.ok(steps.length > 0);
  assert.ok(steps.some((s) => s.contradiction));
});

test("solveCube: trackSteps: false yields grid: null on every step but doesn't change the final result", async () => {
  const tile: CubeTile = { id: "t", faces: { N: "x", S: "x", E: "b", W: "a", U: "x", D: "x" } };
  const { steps, result } = await drain(solveCube({ tiles: [tile] }, 2, 1, 1, { trackSteps: false }));
  assert.equal(result, null);
  assert.ok(steps.length > 0);
  for (const step of steps) assert.equal(step.grid, null);
});
