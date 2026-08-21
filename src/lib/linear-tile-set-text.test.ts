import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LINEAR_TILES_TEXT, linearTileSetToText, parseLinearTileSetText } from "./linear-tile-set-text.ts";
import { linearTilesCompatible } from "./tiles/linear-tile-model.ts";

test("parseLinearTileSetText: one line per tile, id then left/right in order", () => {
  const { tiles } = parseLinearTileSetText("A 1 2\nB 9 8");
  assert.deepEqual(tiles, [
    { id: "A", left: "1", right: "2" },
    { id: "B", left: "9", right: "8" },
  ]);
});

test("parseLinearTileSetText: blank lines and #-comment lines are ignored", () => {
  const { tiles } = parseLinearTileSetText("# a comment\nA 1 2\n\n  \nB 9 8\n");
  assert.equal(tiles.length, 2);
});

test("parseLinearTileSetText: wrong field count throws with the 1-indexed line number", () => {
  assert.throws(() => parseLinearTileSetText("A 1\nB 9 8"), /Line 1/);
  assert.throws(() => parseLinearTileSetText("A 1 2 3"), /Line 1/);
});

test("parseLinearTileSetText: a duplicate tile id throws", () => {
  assert.throws(() => parseLinearTileSetText("A 1 2\nA 1 2"), /duplicate tile id "A"/);
});

test("parseLinearTileSetText: an all-blank/comment-only input throws", () => {
  assert.throws(() => parseLinearTileSetText("# only a comment\n\n"), /No tiles defined/);
});

test("linearTileSetToText: round-trips through parseLinearTileSetText", () => {
  const original = { tiles: [{ id: "L", left: "a", right: "b" }] };
  const text = linearTileSetToText(original);
  assert.deepEqual(parseLinearTileSetText(text), original);
});

test("DEFAULT_LINEAR_TILES_TEXT parses to a 2-tile set that chains A->B->A->B... but neither tile can follow itself", () => {
  const { tiles } = parseLinearTileSetText(DEFAULT_LINEAR_TILES_TEXT);
  assert.equal(tiles.length, 2);
  const [a, b] = tiles as [{ id: string; left: string; right: string }, { id: string; left: string; right: string }];
  assert.ok(linearTilesCompatible(a, b), "expected A -> B to be compatible");
  assert.ok(linearTilesCompatible(b, a), "expected B -> A to be compatible");
  assert.ok(!linearTilesCompatible(a, a), "expected A -> A to NOT be compatible");
  assert.ok(!linearTilesCompatible(b, b), "expected B -> B to NOT be compatible");
});
