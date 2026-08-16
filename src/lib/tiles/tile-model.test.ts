import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCompatibilityDigraph,
  encodeWangSat,
  solveSat,
  solveTorus,
  solveWang,
  solveWangViaSat,
  type Tile,
  tilesCompatible,
} from "./tile-model.ts";

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

test("solveTorus: a single asymmetric tile (E !== W) fails a 1x1 torus even though solveWang trivially accepts the same tile/size -- the wraparound self-edge check is the differentiator", async () => {
  const t: Tile = { id: "asym", edges: { N: "0", E: "0", S: "0", W: "1" } };
  const plain = await drain(solveWang({ tiles: [t] }, 1, 1));
  assert.deepEqual(plain.result, [["asym"]], "solveWang has no neighbor to conflict with, so it trivially succeeds");
  const torus = await drain(solveTorus({ tiles: [t] }, 1, 1));
  assert.equal(torus.result, null, "on a 1-cell torus the tile's own E must equal its own W via wraparound, and it doesn't (E=0, W=1)");
});

test("solveTorus: a genuinely periodic 2-tile horizontal pair (L.E matches R.W, and R.E wraps back to match L.W) succeeds on a 2x1 torus", async () => {
  const l: Tile = { id: "L", edges: { N: "v", E: "a", S: "v", W: "b" } };
  const r: Tile = { id: "R", edges: { N: "v", E: "b", S: "v", W: "a" } };
  const { result } = await drain(solveTorus({ tiles: [l, r] }, 2, 1));
  assert.deepEqual(result, [["L", "R"]]);
});

test("solveSat: a satisfiable 2-clause 2-variable CNF returns an assignment satisfying every clause, hand-verified", () => {
  // (x1 OR x2) AND (NOT x1 OR x2) AND (NOT x2 OR NOT x1) -- forces x2=true, x1=false.
  const cnf = [
    [1, 2],
    [-1, 2],
    [-2, -1],
  ];
  const assignment = solveSat(cnf, 2);
  assert.notEqual(assignment, null);
  assert.equal(assignment!.get(1), false);
  assert.equal(assignment!.get(2), true);
});

test("solveSat: an unsatisfiable CNF (unit clause forces x1=true, which propagates to force x2=true, contradicting a unit clause forcing x2=false) returns null", () => {
  const cnf = [[1], [-1, 2], [-2]];
  assert.equal(solveSat(cnf, 2), null);
});

test("encodeWangSat + solveSat: an unsatisfiable tiling (two tiles whose edges never match in any direction) is correctly UNSAT via the SAT encoding, cross-checking solveWang's own null result", async () => {
  const p: Tile = { id: "p", edges: { N: "1", E: "x", S: "2", W: "x" } };
  const q: Tile = { id: "q", edges: { N: "3", E: "x", S: "4", W: "x" } };
  const { cnf, numVars } = encodeWangSat({ tiles: [p, q] }, 1, 2);
  assert.equal(solveSat(cnf, numVars), null);
  const wang = await drain(solveWang({ tiles: [p, q] }, 1, 2));
  assert.equal(wang.result, null, "solveWang agrees: no valid vertical pairing exists");
});

test("solveWangViaSat: agrees with solveWang on the same 'backtracks past a dead end' tile set (issue #92 M1's own cross-check property)", async () => {
  const c: Tile = { id: "C", edges: { N: "1", E: "x", S: "9", W: "x" } };
  const b: Tile = { id: "B", edges: { N: "2", E: "x", S: "1", W: "x" } };
  const viaSat = solveWangViaSat({ tiles: [c, b] }, 1, 2);
  assert.deepEqual(viaSat, [["B"], ["C"]]);
  const { result } = await drain(solveWang({ tiles: [c, b] }, 1, 2));
  assert.deepEqual(viaSat, result, "SAT cross-check and backtracking solver must agree on the same tiling");
});

test("solveWangViaSat: a single self-compatible tile trivially fills a 2x2 grid, matching solveWang", () => {
  const t: Tile = { id: "t", edges: { N: "0", E: "0", S: "0", W: "0" } };
  const viaSat = solveWangViaSat({ tiles: [t] }, 2, 2);
  assert.deepEqual(viaSat, [
    ["t", "t"],
    ["t", "t"],
  ]);
});
