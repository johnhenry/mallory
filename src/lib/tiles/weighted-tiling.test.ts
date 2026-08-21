import assert from "node:assert/strict";
import { test } from "node:test";
import { Rng } from "mallory-tensor-core";
import { solveWangWeighted, weightedShuffle } from "./weighted-tiling.ts";
import type { Tile } from "./tile-model.ts";

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{ steps: T[]; result: R }> {
  const steps: T[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    next = await gen.next();
  }
  return { steps, result: next.value };
}

const A: Tile = { id: "A", edges: { N: "x", E: "x", S: "x", W: "x" } };
const B: Tile = { id: "B", edges: { N: "x", E: "x", S: "x", W: "x" } };
const C: Tile = { id: "C", edges: { N: "x", E: "x", S: "x", W: "x" } };

test("weightedShuffle: returns a permutation of the input (same elements, no loss or duplication)", () => {
  const shuffled = weightedShuffle([A, B, C], new Map([["A", 5], ["B", 1], ["C", 1]]), new Rng(1));
  assert.deepEqual(new Set(shuffled.map((t) => t.id)), new Set(["A", "B", "C"]));
  assert.equal(shuffled.length, 3);
});

test("weightedShuffle: a tile with an overwhelmingly larger weight is picked first far more often than uniform chance, over many seeded trials", () => {
  let firstIsA = 0;
  const trials = 500;
  for (let seed = 0; seed < trials; seed++) {
    const shuffled = weightedShuffle([A, B, C], new Map([["A", 1000], ["B", 1], ["C", 1]]), new Rng(seed));
    if (shuffled[0]!.id === "A") firstIsA++;
  }
  // Uniform chance would be ~1/3 (~167/500); weighted should be overwhelmingly higher.
  assert.ok(firstIsA > trials * 0.9, `expected A first in >90% of ${trials} trials, got ${firstIsA}`);
});

test("weightedShuffle: a tile with weight 0 is never picked while any positive-weight candidate remains", () => {
  for (let seed = 0; seed < 200; seed++) {
    const shuffled = weightedShuffle([A, B, C], new Map([["A", 0], ["B", 1], ["C", 1]]), new Rng(seed));
    assert.notEqual(shuffled[0]!.id, "A", `seed ${seed}: A (weight 0) was picked first`);
    assert.notEqual(shuffled[1]!.id, "A", `seed ${seed}: A (weight 0) was picked second`);
  }
});

test("weightedShuffle: missing ids default to weight 1 (uniform among unspecified tiles)", () => {
  // No weights specified at all -- every tile defaults to 1, so this is just a plain shuffle.
  const shuffled = weightedShuffle([A, B, C], new Map(), new Rng(42));
  assert.equal(shuffled.length, 3);
  assert.deepEqual(new Set(shuffled.map((t) => t.id)), new Set(["A", "B", "C"]));
});

test("weightedShuffle: is deterministic for a given seed", () => {
  const a = weightedShuffle([A, B, C], new Map([["A", 3], ["B", 2], ["C", 1]]), new Rng(7));
  const b = weightedShuffle([A, B, C], new Map([["A", 3], ["B", 2], ["C", 1]]), new Rng(7));
  assert.deepEqual(a.map((t) => t.id), b.map((t) => t.id));
});

test("solveWangWeighted: still finds the unique valid tiling of a constrained tile set regardless of weights -- weights affect search ORDER, not completeness", async () => {
  const c: Tile = { id: "C", edges: { N: "1", E: "x", S: "9", W: "x" } };
  const b: Tile = { id: "B", edges: { N: "2", E: "x", S: "1", W: "x" } };
  // Weight B far higher than C, even though the only valid vertical
  // arrangement is [B, C] top-to-bottom (B.S=1 matches C.N=1) -- backtracking
  // must still find it regardless of which order candidates are tried in.
  const { result } = await drain(solveWangWeighted({ tiles: [c, b] }, 1, 2, new Map([["B", 1000], ["C", 1]]), new Rng(3)));
  assert.deepEqual(result, [["B"], ["C"]]);
});

test("solveWangWeighted: a single self-compatible tile trivially fills any grid, same as solveWang", async () => {
  const t: Tile = { id: "t", edges: { N: "0", E: "0", S: "0", W: "0" } };
  const { result } = await drain(solveWangWeighted({ tiles: [t] }, 3, 3, new Map(), new Rng(1)));
  assert.ok(result);
  for (const row of result!) for (const id of row) assert.equal(id, "t");
});

test("solveWangWeighted: trackSteps: false yields grid: null on every step but doesn't change the final result", async () => {
  const t: Tile = { id: "t", edges: { N: "0", E: "0", S: "0", W: "0" } };
  const { steps, result } = await drain(solveWangWeighted({ tiles: [t] }, 2, 2, new Map(), new Rng(1), { trackSteps: false }));
  assert.ok(result);
  assert.ok(steps.length > 0);
  for (const step of steps) assert.equal(step.grid, null);
});
