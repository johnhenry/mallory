import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompatibilityDigraph, solveWang, type Tile, tilesCompatible } from "./tile-model.ts";

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{ steps: T[]; result: R }> {
  const steps: T[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    next = await gen.next();
  }
  return { steps, result: next.value };
}

test("tilesCompatible: matches when a's edge label equals b's opposite-facing edge, hand-computed", () => {
  const a: Tile = { id: "a", edges: { N: "0", E: "1", S: "0", W: "2" } };
  const b: Tile = { id: "b", edges: { N: "9", E: "9", S: "9", W: "1" } };
  assert.equal(tilesCompatible(a, b, "E"), true, "a.E(1) === b.W(1)");
  assert.equal(tilesCompatible(a, b, "N"), false, "a.N(0) !== b.S(9)");
  assert.equal(tilesCompatible(a, b, "W"), false, "a.W(2) !== b.E(9)");
});

test("tilesCompatible: every direction checks against the geometrically OPPOSITE edge, not the same-named one -- hand-computed with all 4 edges distinct so a same-direction bug can't hide", () => {
  const a: Tile = { id: "a", edges: { N: "n1", E: "e1", S: "s1", W: "w1" } };
  // b's edges are set so each of a's directions matches b's OPPOSITE edge and nothing else.
  const b: Tile = { id: "b", edges: { N: "s1", E: "w1", S: "n1", W: "e1" } };
  assert.equal(tilesCompatible(a, b, "N"), true, "a.N(n1) === b.S(n1)");
  assert.equal(tilesCompatible(a, b, "E"), true, "a.E(e1) === b.W(e1)");
  assert.equal(tilesCompatible(a, b, "S"), true, "a.S(s1) === b.N(s1)");
  assert.equal(tilesCompatible(a, b, "W"), true, "a.W(w1) === b.E(w1)");
});

test("tilesCompatible: not symmetric in general -- a compatible-east-of b doesn't imply b compatible-east-of a", () => {
  const a: Tile = { id: "a", edges: { N: "x", E: "1", S: "x", W: "x" } };
  const b: Tile = { id: "b", edges: { N: "x", E: "9", S: "x", W: "1" } };
  assert.equal(tilesCompatible(a, b, "E"), true, "a.E(1) === b.W(1)");
  assert.equal(tilesCompatible(b, a, "E"), false, "b.E(9) !== a.W(x)");
});

test("buildCompatibilityDigraph: 3 tiles, hand-computed east-direction digraph", () => {
  const p: Tile = { id: "p", edges: { N: "x", E: "1", S: "x", W: "9" } };
  const q: Tile = { id: "q", edges: { N: "x", E: "9", S: "x", W: "1" } };
  const r: Tile = { id: "r", edges: { N: "x", E: "9", S: "x", W: "9" } };
  // East: p.E(1) matches only q.W(1). q.E(9) matches p.W(9) and r.W(9). r.E(9) matches p.W(9) and r.W(9).
  const digraph = buildCompatibilityDigraph([p, q, r], "E");
  assert.deepEqual(digraph.get("p"), new Set(["q"]));
  assert.deepEqual(digraph.get("q"), new Set(["p", "r"]));
  assert.deepEqual(digraph.get("r"), new Set(["p", "r"]));
});

test("solveWang: a single self-compatible tile trivially fills any grid", async () => {
  const t: Tile = { id: "t", edges: { N: "0", E: "0", S: "0", W: "0" } };
  const { result } = await drain(solveWang({ tiles: [t] }, 3, 2));
  assert.deepEqual(result, [
    ["t", "t", "t"],
    ["t", "t", "t"],
  ]);
});

test("solveWang: a 1x1 grid always succeeds regardless of edge labels (no neighbors to conflict with)", async () => {
  const t: Tile = { id: "t", edges: { N: "0", E: "0", S: "0", W: "1" } };
  const { result } = await drain(solveWang({ tiles: [t] }, 1, 1));
  assert.deepEqual(result, [["t"]]);
});

test("solveWang: an asymmetric single tile (E !== W) cannot tile a 2x1 row -- returns null after trying and undoing both cells, hand-computed step sequence", async () => {
  const t: Tile = { id: "t", edges: { N: "0", E: "0", S: "0", W: "1" } };
  const { steps, result } = await drain(solveWang({ tiles: [t] }, 2, 1));
  assert.equal(result, null);
  assert.deepEqual(steps, [
    { grid: [["t", null]], row: 0, col: 0, contradiction: false },
    { grid: [["t", null]], row: 0, col: 1, contradiction: true },
    { grid: [[null, null]], row: 0, col: 0, contradiction: true },
  ]);
});

test("solveWang: backtracks past a first-tried dead-end tile to a later one that works, hand-computed step-by-step (issue #92 M1's own 'backtracking' solver, not forward-only placement)", async () => {
  // Tile array order is [C, B] -- C is tried first at every cell, matching the solver's own array-order candidate iteration.
  // C: N=1, S=9 (nothing has N=9, so anything placed south of C is a dead end).
  // B: N=2, S=1 (C's own N=1 matches B's S=1, so B-then-C works vertically).
  const c: Tile = { id: "C", edges: { N: "1", E: "x", S: "9", W: "x" } };
  const b: Tile = { id: "B", edges: { N: "2", E: "x", S: "1", W: "x" } };
  const { steps, result } = await drain(solveWang({ tiles: [c, b] }, 1, 2));
  assert.deepEqual(result, [["B"], ["C"]], "C's own dead-end forces the solver back to try B first, which then admits C below it");
  assert.deepEqual(steps, [
    { grid: [["C"], [null]], row: 0, col: 0, contradiction: false }, // (0,0) tries C first (array order)
    { grid: [["C"], [null]], row: 1, col: 0, contradiction: true }, // (1,0): needs N=9, neither C nor B has it -> dead end
    { grid: [["B"], [null]], row: 0, col: 0, contradiction: false }, // backtrack: (0,0) tries its next candidate, B
    { grid: [["B"], ["C"]], row: 1, col: 0, contradiction: false }, // (1,0): needs N=1 -> C matches
  ]);
});

test("solveWang: horizontal pairing checks the west neighbor's EAST edge against the new tile's WEST edge (not the other way around), hand-computed with a west-only-valid pairing", async () => {
  // L.E("a") matches only R.W("a"); R.E("q") matches nothing in this 2-tile set, so L must come first.
  const l: Tile = { id: "L", edges: { N: "v", E: "a", S: "v", W: "z" } };
  const r: Tile = { id: "R", edges: { N: "v", E: "q", S: "v", W: "a" } };
  const { result } = await drain(solveWang({ tiles: [l, r] }, 2, 1));
  assert.deepEqual(result, [["L", "R"]]);
});

test("solveWang: two tiles with no valid vertical pairing in any combination (including with themselves) cannot tile a 1x2 column", async () => {
  // p.N=1,S=2 and q.N=3,S=4: every N/S value is distinct, so no tile's N ever matches any tile's S.
  const p: Tile = { id: "p", edges: { N: "1", E: "x", S: "2", W: "x" } };
  const q: Tile = { id: "q", edges: { N: "3", E: "x", S: "4", W: "x" } };
  const { result } = await drain(solveWang({ tiles: [p, q] }, 1, 2));
  assert.equal(result, null);
});
