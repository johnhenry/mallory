/**
 * A subtly wrong hand-authored edge label in an illustrative example
 * (#416) wouldn't just fail loudly -- it could silently produce a
 * DIFFERENT, still-"valid" tiling that doesn't tell the intended story
 * (e.g. the chain starting from the wrong tile, or wrapping around). These
 * tests run the actual solver, not just eyeball the tile-set text, per
 * this session's own "verify before shipping a fixture" discipline.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { solveWang, tilesCompatible } from "./tile-model.ts";
import { TILE_SET_EXAMPLES } from "./tile-set-examples.ts";

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<R> {
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}

test("TILE_SET_EXAMPLES: every entry's id is unique", () => {
  const ids = TILE_SET_EXAMPLES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("wire-chain: solves at its recommended size to EXACTLY the intended pipeline order, not just some valid tiling", async () => {
  const entry = TILE_SET_EXAMPLES.find((e) => e.id === "wire-chain")!;
  const grid = await drain(solveWang(entry.tileSet, entry.recommendedWidth, entry.recommendedHeight));
  assert.deepEqual(grid, [["Intake", "Planner", "Coder", "Sink"]]);
});

test("wire-chain: the east-direction adjacency graph is a simple 4-node PATH, not a cycle or branching graph -- the only possible reason a 4-wide row can't be satisfied any other way", () => {
  // solveWang is exhaustive backtracking: reordering the tiles array only
  // changes SEARCH ORDER, never whether a solution exists -- so "does the
  // solver still succeed with a different array order" can't test
  // uniqueness. What actually guarantees the pipeline can only complete in
  // one order is the adjacency structure itself: every tile has AT MOST
  // ONE valid east-neighbor, Sink has NONE, and Intake is the only tile
  // nothing else points to -- i.e. a simple path Intake->Planner->Coder->
  // Sink with no other edges, checked directly here via tilesCompatible.
  const entry = TILE_SET_EXAMPLES.find((e) => e.id === "wire-chain")!;
  const tiles = entry.tileSet.tiles;
  const outEdges = new Map(tiles.map((t) => [t.id, tiles.filter((other) => tilesCompatible(t, other, "E")).map((other) => other.id)]));
  assert.deepEqual(outEdges.get("Intake"), ["Planner"]);
  assert.deepEqual(outEdges.get("Planner"), ["Coder"]);
  assert.deepEqual(outEdges.get("Coder"), ["Sink"]);
  assert.deepEqual(outEdges.get("Sink"), [], "Sink must be a dead end -- nothing may legally follow it");
  const hasIncoming = new Set(tiles.flatMap((t) => outEdges.get(t.id)!));
  assert.ok(!hasIncoming.has("Intake"), "nothing may legally precede Intake -- it's the only valid starting tile");
});

test("wire-chain: Intake and Sink's sentinel edges ('start'/'end') don't accidentally match each other or anything else in the set", () => {
  const entry = TILE_SET_EXAMPLES.find((e) => e.id === "wire-chain")!;
  const allLabels = entry.tileSet.tiles.flatMap((t) => Object.values(t.edges));
  const intakeW = entry.tileSet.tiles.find((t) => t.id === "Intake")!.edges.W;
  const sinkE = entry.tileSet.tiles.find((t) => t.id === "Sink")!.edges.E;
  assert.notEqual(intakeW, sinkE, "the two open-end sentinels must be distinct, or the row could wrap into a cycle");
  assert.equal(allLabels.filter((l) => l === intakeW).length, 1, "Intake's own W sentinel appears nowhere else in the set");
  assert.equal(allLabels.filter((l) => l === sinkE).length, 1, "Sink's own E sentinel appears nowhere else in the set");
});
