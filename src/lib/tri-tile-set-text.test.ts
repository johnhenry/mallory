import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTriTileSetText, triTileSetToText, DEFAULT_TRI_TILES_TEXT } from "./tri-tile-set-text.ts";

test("parseTriTileSetText: one line per tile, id then left right top bottom in order", () => {
  const { tiles } = parseTriTileSetText("A 1 2 3 4\nB 9 8 7 6");
  assert.deepEqual(tiles, [
    { id: "A", edges: { left: "1", right: "2", top: "3", bottom: "4" } },
    { id: "B", edges: { left: "9", right: "8", top: "7", bottom: "6" } },
  ]);
});

test("parseTriTileSetText: blank lines and #-comment lines are ignored", () => {
  const { tiles } = parseTriTileSetText("# a comment\nA 1 2 3 4\n\n  \nB 9 8 7 6\n");
  assert.equal(tiles.length, 2);
});

test("parseTriTileSetText: wrong field count throws with the 1-indexed line number", () => {
  assert.throws(() => parseTriTileSetText("A 1 2 3\nB 9 8 7 6"), /Line 1/);
  assert.throws(() => parseTriTileSetText("A 1 2 3 4 5"), /Line 1/);
});

test("parseTriTileSetText: a duplicate tile id throws", () => {
  assert.throws(() => parseTriTileSetText("A 1 2 3 4\nA 5 6 7 8"), /duplicate tile id "A"/);
});

test("parseTriTileSetText: an all-blank/comment-only input throws", () => {
  assert.throws(() => parseTriTileSetText("# only a comment\n\n"), /No tiles defined/);
});

test("triTileSetToText: round-trips through parseTriTileSetText", () => {
  const original = { tiles: [{ id: "L", edges: { left: "a", right: "b", top: "c", bottom: "d" } }] };
  const text = triTileSetToText(original);
  assert.deepEqual(parseTriTileSetText(text), original);
});

test("DEFAULT_TRI_TILES_TEXT parses to a valid 2-tile set that's compatible with itself both ways left<->right", () => {
  const { tiles } = parseTriTileSetText(DEFAULT_TRI_TILES_TEXT);
  assert.equal(tiles.length, 2);
  const [a, b] = tiles as [(typeof tiles)[number], (typeof tiles)[number]];
  assert.equal(a.edges.right, b.edges.left, "A's right edge should match B's left edge");
  assert.equal(b.edges.right, a.edges.left, "B's right edge should match A's left edge");
});
