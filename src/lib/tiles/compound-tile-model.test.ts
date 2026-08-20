import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundaryEdges,
  buildCompoundTile,
  type CompoundTileSet,
  isBoundaryEdge,
  isFootprintConnected,
  offsetKey,
  solveWangCompound,
  unitCompoundTile,
} from "./compound-tile-model.ts";

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{ steps: T[]; result: R }> {
  const steps: T[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    next = await gen.next();
  }
  return { steps, result: next.value };
}

test("isFootprintConnected: a single cell is trivially connected", () => {
  assert.equal(isFootprintConnected([{ row: 0, col: 0 }]), true);
});

test("isFootprintConnected: two edge-adjacent cells are connected, two diagonal-only cells are not", () => {
  assert.equal(isFootprintConnected([{ row: 0, col: 0 }, { row: 0, col: 1 }]), true);
  assert.equal(isFootprintConnected([{ row: 0, col: 0 }, { row: 1, col: 1 }]), false);
});

test("isFootprintConnected: an L-tromino (3 cells, one bend) is connected", () => {
  assert.equal(isFootprintConnected([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }]), true);
});

test("buildCompoundTile: throws when the footprint is missing the {0,0} anchor", () => {
  assert.throws(() => buildCompoundTile("A", [{ offset: { row: 0, col: 1 }, edges: { N: "x", E: "x", S: "x", W: "x" } }]), /anchor/);
});

test("buildCompoundTile: throws on a duplicate offset", () => {
  assert.throws(
    () =>
      buildCompoundTile("A", [
        { offset: { row: 0, col: 0 }, edges: { N: "x", E: "x", S: "x", W: "x" } },
        { offset: { row: 0, col: 0 }, edges: { N: "y", E: "y", S: "y", W: "y" } },
      ]),
    /duplicate/,
  );
});

test("buildCompoundTile: throws on a disconnected footprint", () => {
  assert.throws(
    () =>
      buildCompoundTile("A", [
        { offset: { row: 0, col: 0 }, edges: { N: "x", E: "x", S: "x", W: "x" } },
        { offset: { row: 2, col: 2 }, edges: { N: "y", E: "y", S: "y", W: "y" } },
      ]),
    /connected/,
  );
});

test("isBoundaryEdge / boundaryEdges: a horizontal domino has exactly 6 boundary edges (8 sides minus the 2 welded internal ones)", () => {
  const domino = buildCompoundTile("AB", [
    { offset: { row: 0, col: 0 }, edges: { N: "n0", E: "weld", S: "s0", W: "w0" } },
    { offset: { row: 0, col: 1 }, edges: { N: "n1", E: "e1", S: "s1", W: "weld" } },
  ]);
  assert.equal(isBoundaryEdge(domino.footprint, { row: 0, col: 0 }, "E"), false, "left cell's east side faces its own footprint-mate");
  assert.equal(isBoundaryEdge(domino.footprint, { row: 0, col: 1 }, "W"), false, "right cell's west side faces its own footprint-mate");
  assert.equal(isBoundaryEdge(domino.footprint, { row: 0, col: 0 }, "N"), true);
  const edges = boundaryEdges(domino);
  assert.equal(edges.length, 6);
  assert.ok(!edges.some((e) => offsetKey(e.offset) === "0,0" && e.direction === "E"), "internal side excluded");
  assert.ok(!edges.some((e) => offsetKey(e.offset) === "0,1" && e.direction === "W"), "internal side excluded");
});

test("unitCompoundTile: lifts a plain Tile to a 1-cell footprint with all 4 sides as boundary edges", () => {
  const unit = unitCompoundTile({ id: "u", edges: { N: "n", E: "e", S: "s", W: "w" } });
  assert.deepEqual(unit.footprint, [{ row: 0, col: 0 }]);
  const edges = boundaryEdges(unit);
  assert.equal(edges.length, 4);
});

test("solveWangCompound: unit-only tile set behaves exactly like tile-model.ts's solveWang (a single self-compatible tile fills any grid)", async () => {
  const tileSet: CompoundTileSet = { tiles: [unitCompoundTile({ id: "a", edges: { N: "x", E: "x", S: "x", W: "x" } })] };
  const { result } = await drain(solveWangCompound(tileSet, 3, 2));
  assert.ok(result);
  for (const row of result!) for (const cell of row) assert.equal(cell.tileId, "a");
});

test("solveWangCompound: two edge-matching unit tiles alternate horizontally, matching solveWang's own known-good fixture", async () => {
  const tileSet: CompoundTileSet = {
    tiles: [
      unitCompoundTile({ id: "A", edges: { N: "x", E: "1", S: "x", W: "2" } }),
      unitCompoundTile({ id: "B", edges: { N: "x", E: "2", S: "x", W: "1" } }),
    ],
  };
  const { result } = await drain(solveWangCompound(tileSet, 4, 1));
  assert.ok(result);
  const row = result![0]!.map((c) => c.tileId);
  assert.deepEqual(row, ["A", "B", "A", "B"]);
});

test("solveWangCompound: a horizontal domino tiles a 4x1 grid in 2 placements, with mismatched internal-edge values ignored (never checked)", async () => {
  const domino = buildCompoundTile("AB", [
    { offset: { row: 0, col: 0 }, edges: { N: "x", E: "internal-left", S: "x", W: "x" } },
    { offset: { row: 0, col: 1 }, edges: { N: "x", E: "x", S: "x", W: "internal-right" } },
  ]);
  const tileSet: CompoundTileSet = { tiles: [domino] };
  const { result } = await drain(solveWangCompound(tileSet, 4, 1));
  assert.ok(result, "solves despite domino's internal E/W labels not matching each other -- they're welded, never checked");
  const anchors = result![0]!.map((c) => c.anchorCol);
  assert.deepEqual(anchors, [0, 0, 2, 2], "two domino placements, each covering 2 cells sharing one anchor");
});

test("solveWangCompound: an L-tromino that can't legally tile a 2x2 grid (parity/shape mismatch) returns null, same contract as solveWang", async () => {
  const lTromino = buildCompoundTile("L", [
    { offset: { row: 0, col: 0 }, edges: { N: "x", E: "internal", S: "internal", W: "x" } },
    { offset: { row: 0, col: 1 }, edges: { N: "x", E: "x", S: "x", W: "internal" } },
    { offset: { row: 1, col: 0 }, edges: { N: "internal", E: "x", S: "x", W: "x" } },
  ]);
  const tileSet: CompoundTileSet = { tiles: [lTromino] };
  // A 2x2 grid has 4 cells; a single 3-cell L-tromino can't cover it exactly
  // (one cell left over with no tile small enough to fill it), and there's
  // no second tile to fill the remainder -- must fail.
  const { result } = await drain(solveWangCompound(tileSet, 2, 2));
  assert.equal(result, null);
});
