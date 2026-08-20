import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCornerCompatibilityDigraph,
  cornersCompatible,
  cornerTilesCompatible,
  solveCornerTiles,
  type CornerTile,
} from "./corner-tile-model.ts";

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{ steps: T[]; result: R }> {
  const steps: T[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    next = await gen.next();
  }
  return { steps, result: next.value };
}

test("cornersCompatible: true iff the two named corners' labels are equal, hand-verified", () => {
  const a: CornerTile = { id: "a", corners: { NE: "1", SE: "2", SW: "3", NW: "4" } };
  const b: CornerTile = { id: "b", corners: { NE: "4", SE: "9", SW: "9", NW: "9" } };
  assert.equal(cornersCompatible(a, "NW", b, "NE"), true, "a.NW(4) === b.NE(4)");
  assert.equal(cornersCompatible(a, "NE", b, "NE"), false, "a.NE(1) !== b.NE(4)");
});

test("cornerTilesCompatible: W direction checks BOTH shared vertices (NW/SW), not just one", () => {
  const a: CornerTile = { id: "a", corners: { NE: "x", SE: "x", SW: "1", NW: "2" } };
  const westNeighborBothMatch: CornerTile = { id: "w1", corners: { NE: "2", SE: "1", SW: "x", NW: "x" } };
  const westNeighborOneMismatch: CornerTile = { id: "w2", corners: { NE: "2", SE: "9", SW: "x", NW: "x" } };
  assert.equal(cornerTilesCompatible(a, westNeighborBothMatch, "W"), true);
  assert.equal(cornerTilesCompatible(a, westNeighborOneMismatch, "W"), false, "SW/SE mismatch alone must fail even though NW/NE matches");
});

test("cornerTilesCompatible: NW/NE diagonal directions check exactly ONE shared vertex", () => {
  const a: CornerTile = { id: "a", corners: { NE: "e", SE: "x", SW: "x", NW: "w" } };
  const nwNeighbor: CornerTile = { id: "nw", corners: { NE: "x", SE: "w", SW: "x", NW: "x" } };
  const neNeighbor: CornerTile = { id: "ne", corners: { NE: "x", SE: "x", SW: "e", NW: "x" } };
  assert.equal(cornerTilesCompatible(a, nwNeighbor, "NW"), true, "a.NW === nwNeighbor.SE");
  assert.equal(cornerTilesCompatible(a, neNeighbor, "NE"), true, "a.NE === neNeighbor.SW");
});

test("buildCornerCompatibilityDigraph: 3 tiles, hand-computed W-direction digraph", () => {
  const p: CornerTile = { id: "p", corners: { NE: "x", SE: "x", SW: "1", NW: "1" } };
  const q: CornerTile = { id: "q", corners: { NE: "1", SE: "1", SW: "x", NW: "x" } };
  const r: CornerTile = { id: "r", corners: { NE: "9", SE: "9", SW: "x", NW: "x" } };
  // p sits west of q (p.NW/SW = 1,1 matches q.NE/SE = 1,1); p does not sit west of r (9 != 1).
  const digraph = buildCornerCompatibilityDigraph([p, q, r], "W");
  assert.deepEqual(digraph.get("p"), new Set(["q"]));
});

test("solveCornerTiles: a single tile self-compatible in every direction trivially fills any grid", async () => {
  const t: CornerTile = { id: "t", corners: { NE: "x", SE: "x", SW: "x", NW: "x" } };
  const { result } = await drain(solveCornerTiles({ tiles: [t] }, 3, 3));
  assert.ok(result);
  for (const row of result!) for (const id of row) assert.equal(id, "t");
});

test("solveCornerTiles: a genuine 2x2 corner-consistent block, hand-verified against the shared-vertex model", async () => {
  // 4 tiles occupying a 2x2 block, one shared color per interior vertex --
  // exactly the paper's own h(x,y)-per-lattice-point model, hand-instantiated:
  // vertex values: TL=1 (grid corner, only touches A), TM=2 (top-middle, A/B), TR=3 (only B)
  //                ML=4 (left-middle, A/C), MM=5 (center, all 4), MR=6 (right-middle, B/D)
  //                BL=7 (only C), BM=8 (bottom-middle, C/D), BR=9 (only D)
  const a: CornerTile = { id: "A", corners: { NW: "1", NE: "2", SE: "5", SW: "4" } };
  const b: CornerTile = { id: "B", corners: { NW: "2", NE: "3", SE: "6", SW: "5" } };
  const c: CornerTile = { id: "C", corners: { NW: "4", NE: "5", SE: "8", SW: "7" } };
  const d: CornerTile = { id: "D", corners: { NW: "5", NE: "6", SE: "9", SW: "8" } };
  const { result } = await drain(solveCornerTiles({ tiles: [a, b, c, d] }, 2, 2));
  assert.deepEqual(result, [
    ["A", "B"],
    ["C", "D"],
  ]);
});

test("solveCornerTiles: a genuine diagonal mismatch is still caught, even though the solver only checks W/N directly -- transitivity through the already-placed neighbors catches it (see solveCornerTiles's own doc comment for why this is guaranteed, not coincidental)", async () => {
  // Same 2x2 layout as the block above, except D's NW corner (which must
  // equal A's SE corner, the shared center vertex) is deliberately wrong
  // (99 instead of 5). D is only ever checked directly against its W (C)
  // and N (B) neighbors -- never against A, which is diagonal from D. The
  // mismatch is still caught because C's own NE corner was already forced
  // to equal A's SE corner when C itself was placed (via C's N-check
  // against A), so D's W-check against C (which compares D.NW vs C.NE)
  // transitively catches the A-vs-D disagreement without ever comparing
  // them directly.
  const a: CornerTile = { id: "A", corners: { NW: "1", NE: "2", SE: "5", SW: "4" } };
  const b: CornerTile = { id: "B", corners: { NW: "2", NE: "3", SE: "6", SW: "5" } };
  const c: CornerTile = { id: "C", corners: { NW: "4", NE: "5", SE: "8", SW: "7" } };
  const dBroken: CornerTile = { id: "D", corners: { NW: "99", NE: "6", SE: "9", SW: "8" } };
  const { result } = await drain(solveCornerTiles({ tiles: [a, b, c, dBroken] }, 2, 2));
  assert.equal(result, null, "D's NW corner (99) doesn't match A's SE corner (5) -- must fail to solve, not silently accept a broken diagonal");
});

test("solveCornerTiles: the solved grid is fully diagonal-consistent even though only W/N were ever checked directly -- spot-checks the same NE/SW diagonal pair the (retracted) 4-neighbor design would have checked explicitly", async () => {
  const a: CornerTile = { id: "A", corners: { NW: "1", NE: "2", SE: "5", SW: "4" } };
  const b: CornerTile = { id: "B", corners: { NW: "2", NE: "3", SE: "6", SW: "5" } };
  const c: CornerTile = { id: "C", corners: { NW: "4", NE: "5", SE: "8", SW: "7" } };
  const d: CornerTile = { id: "D", corners: { NW: "5", NE: "6", SE: "9", SW: "8" } };
  const byId = new Map([a, b, c, d].map((t) => [t.id, t]));
  const { result } = await drain(solveCornerTiles({ tiles: [a, b, c, d] }, 2, 2));
  assert.ok(result);
  // B (NE-diagonal from C) and C (NW-diagonal from B) must agree on their
  // one shared vertex (B.SW / C.NE) purely as a consequence of both being
  // independently pinned to A's SE corner -- confirms the transitivity
  // argument empirically on the actual solved grid, not just this
  // hand-built fixture.
  const placedB = byId.get(result![0]![1]!)!;
  const placedC = byId.get(result![1]![0]!)!;
  assert.equal(placedB.corners.SW, placedC.corners.NE, "B and C must agree on their shared diagonal vertex");
});

test("solveCornerTiles: trackSteps: false yields grid: null on every step but doesn't change the final result", async () => {
  const t: CornerTile = { id: "t", corners: { NE: "x", SE: "x", SW: "x", NW: "x" } };
  const { steps, result } = await drain(solveCornerTiles({ tiles: [t] }, 2, 2, { trackSteps: false }));
  assert.ok(result);
  assert.ok(steps.length > 0);
  for (const step of steps) assert.equal(step.grid, null);
});
