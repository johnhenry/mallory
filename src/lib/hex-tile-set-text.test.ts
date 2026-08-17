import assert from "node:assert/strict";
import { test } from "node:test";
import { hexTileSetToText, parseHexTileSetText, DEFAULT_HEX_TILES_TEXT } from "./hex-tile-set-text.ts";

test("parseHexTileSetText: one line per tile, id then e0..e5 in order", () => {
  const { tiles } = parseHexTileSetText("A 1 2 3 4 5 6\nB 9 8 7 6 5 4");
  assert.deepEqual(tiles, [
    { id: "A", edges: { 0: "1", 1: "2", 2: "3", 3: "4", 4: "5", 5: "6" } },
    { id: "B", edges: { 0: "9", 1: "8", 2: "7", 3: "6", 4: "5", 5: "4" } },
  ]);
});

test("parseHexTileSetText: blank lines and #-comment lines are ignored", () => {
  const { tiles } = parseHexTileSetText("# a comment\nA 1 2 3 4 5 6\n\n  \nB 9 8 7 6 5 4\n");
  assert.equal(tiles.length, 2);
});

test("parseHexTileSetText: wrong field count throws with the 1-indexed line number", () => {
  assert.throws(() => parseHexTileSetText("A 1 2 3 4 5\nB 9 8 7 6 5 4"), /Line 1/);
  assert.throws(() => parseHexTileSetText("A 1 2 3 4 5 6 7"), /Line 1/);
});

test("parseHexTileSetText: a duplicate tile id throws", () => {
  assert.throws(() => parseHexTileSetText("A 1 2 3 4 5 6\nA 1 2 3 4 5 6"), /duplicate tile id "A"/);
});

test("parseHexTileSetText: an all-blank/comment-only input throws", () => {
  assert.throws(() => parseHexTileSetText("# only a comment\n\n"), /No tiles defined/);
});

test("hexTileSetToText: round-trips through parseHexTileSetText", () => {
  const original = { tiles: [{ id: "L", edges: { 0: "a", 1: "b", 2: "c", 3: "d", 4: "e", 5: "f" } }] };
  const text = hexTileSetToText(original);
  assert.deepEqual(parseHexTileSetText(text), original);
});

test("DEFAULT_HEX_TILES_TEXT parses to a valid 2-tile set that's compatible with itself both ways in direction 0", () => {
  const { tiles } = parseHexTileSetText(DEFAULT_HEX_TILES_TEXT);
  assert.equal(tiles.length, 2);
  const [a, b] = tiles as [{ id: string; edges: Record<number, string> }, { id: string; edges: Record<number, string> }];
  assert.equal(a.edges[0], b.edges[3], "A's direction-0 edge should match B's direction-3 (opposite) edge");
  assert.equal(b.edges[0], a.edges[3], "B's direction-0 edge should match A's direction-3 (opposite) edge");
});
