import assert from "node:assert/strict";
import { test } from "node:test";
import { linearEntropy, linearTilesCompatible, solveLinear, solveLinearPeriodic, type LinearGrid, type LinearSolveStep, type LinearTile } from "./linear-tile-model.ts";

async function drain(gen: AsyncGenerator<LinearSolveStep, LinearGrid | null>): Promise<{ grid: LinearGrid | null; steps: LinearSolveStep[] }> {
  const steps: LinearSolveStep[] = [];
  let result = await gen.next();
  while (!result.done) {
    steps.push(result.value);
    result = await gen.next();
  }
  return { grid: result.value, steps };
}

test("linearTilesCompatible: true when a.right === b.left, false otherwise", () => {
  const a: LinearTile = { id: "A", left: "x", right: "1" };
  const b: LinearTile = { id: "B", left: "1", right: "y" };
  const c: LinearTile = { id: "C", left: "2", right: "z" };
  assert.ok(linearTilesCompatible(a, b));
  assert.ok(!linearTilesCompatible(a, c));
});

test("solveLinear: a single self-compatible tile fills any length", async () => {
  const tile: LinearTile = { id: "A", left: "1", right: "1" };
  const { grid } = await drain(solveLinear({ tiles: [tile] }, 5));
  assert.deepEqual(grid, ["A", "A", "A", "A", "A"]);
});

test("solveLinear: fails (null grid, a contradiction step) when no valid chain exists", async () => {
  // A's right never matches anything's left -- no chain of length > 1.
  const a: LinearTile = { id: "A", left: "1", right: "9" };
  const { grid, steps } = await drain(solveLinear({ tiles: [a] }, 2));
  assert.equal(grid, null);
  assert.ok(steps.some((s) => s.contradiction), "expected at least one contradiction step");
});

test("solveLinear rejects length < 1", async () => {
  await assert.rejects(async () => {
    for await (const _ of solveLinear({ tiles: [{ id: "A", left: "1", right: "1" }] }, 0)) {
      // no-op
    }
  }, RangeError);
});

test("solveLinearPeriodic: finds a genuinely periodic ring for alternating two tiles at an even length", async () => {
  const a: LinearTile = { id: "A", left: "2", right: "1" };
  const b: LinearTile = { id: "B", left: "1", right: "2" };
  const { grid } = await drain(solveLinearPeriodic({ tiles: [a, b] }, 4));
  assert.ok(grid, "expected a periodic solution to exist");
  assert.deepEqual(grid, ["A", "B", "A", "B"]);
  // Wrap check: last tile's right must match first tile's left.
  const last = (grid as LinearGrid)[(grid as LinearGrid).length - 1];
  const first = (grid as LinearGrid)[0];
  const tileMap = new Map([a, b].map((t) => [t.id, t]));
  assert.equal(tileMap.get(last!)!.right, tileMap.get(first!)!.left);
});

test("solveLinear (non-periodic) accepts a chain that would NOT close into a valid ring -- proving the periodic check is real, not a no-op", async () => {
  // A chain A -> B -> C is fine linearly, but C's right doesn't match A's
  // left, so this can never close into a ring.
  const a: LinearTile = { id: "A", left: "z", right: "1" };
  const b: LinearTile = { id: "B", left: "1", right: "2" };
  const c: LinearTile = { id: "C", left: "2", right: "y" };
  const tileSet = { tiles: [a, b, c] };

  const linear = await drain(solveLinear(tileSet, 3));
  assert.deepEqual(linear.grid, ["A", "B", "C"], "plain solveLinear should happily accept A,B,C");

  const periodic = await drain(solveLinearPeriodic(tileSet, 3));
  assert.equal(periodic.grid, null, "solveLinearPeriodic must reject the same tile set since C's right never matches A's left");
});

test("solveLinearPeriodic rejects length < 1", async () => {
  await assert.rejects(async () => {
    for await (const _ of solveLinearPeriodic({ tiles: [{ id: "A", left: "1", right: "1" }] }, 0)) {
      // no-op
    }
  }, RangeError);
});

test("linearEntropy throws on an empty tile set", () => {
  assert.throws(() => linearEntropy({ tiles: [] }), /empty/);
});

test("linearEntropy: N tiles all self- and cross-compatible form a complete transfer graph -- entropy = ln(N)", () => {
  const numTiles = 4;
  const tiles: LinearTile[] = Array.from({ length: numTiles }, (_, i) => ({ id: `t${i}`, left: "u", right: "u" }));
  const result = linearEntropy({ tiles });
  assert.equal(result.numTiles, numTiles);
  assert.ok(result.converged);
  assert.ok(Math.abs(result.dominantEigenvalue - numTiles) < 1e-6);
  assert.ok(Math.abs(result.entropy - Math.log(numTiles)) < 1e-6);
});

test("linearEntropy throws a domain-specific error when the transfer relation has no cycle", () => {
  // Only A -> B holds; no cycle exists among {A, B}.
  const a: LinearTile = { id: "A", left: "9", right: "1" };
  const b: LinearTile = { id: "B", left: "1", right: "5" };
  assert.throws(() => linearEntropy({ tiles: [a, b] }), /no cycle/);
});

test("linearEntropy: golden mean shift (edge shift for 0->0, 0->1, 1->0, NOT 1->1) has exact entropy log(golden ratio)", () => {
  // Standard edge-shift encoding of a subshift of finite type: each tile IS
  // a transition edge between the two states {0, 1}. Two tiles chain when
  // the first's `right` (destination state) equals the second's `left`
  // (source state). The state adjacency matrix is [[1,1],[1,0]] (state 0
  // can go to 0 or 1; state 1 can only go to 0) -- its dominant eigenvalue
  // is the golden ratio, a textbook exact result (Lind-Marcus).
  const e00: LinearTile = { id: "e00", left: "0", right: "0" };
  const e01: LinearTile = { id: "e01", left: "0", right: "1" };
  const e10: LinearTile = { id: "e10", left: "1", right: "0" };
  const result = linearEntropy({ tiles: [e00, e01, e10] });
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  assert.ok(result.converged);
  assert.ok(
    Math.abs(result.entropy - Math.log(goldenRatio)) < 1e-6,
    `expected entropy ~= log(golden ratio) = ${Math.log(goldenRatio)}, got ${result.entropy}`,
  );
});
