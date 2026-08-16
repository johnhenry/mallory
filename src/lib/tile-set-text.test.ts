import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TILES_TEXT, parseTileSetText, tileSetToText } from "./tile-set-text.ts";

test("parseTileSetText: one line per tile, id then N E S W in order", () => {
  const { tiles } = parseTileSetText("A 1 2 3 4\nB 9 8 7 6");
  assert.deepEqual(tiles, [
    { id: "A", edges: { N: "1", E: "2", S: "3", W: "4" } },
    { id: "B", edges: { N: "9", E: "8", S: "7", W: "6" } },
  ]);
});

test("parseTileSetText: blank lines and #-comment lines are ignored", () => {
  const { tiles } = parseTileSetText("# a comment\nA 1 2 3 4\n\n  \nB 9 8 7 6\n");
  assert.equal(tiles.length, 2);
});

test("parseTileSetText: extra/missing whitespace-separated fields on a line throws with the 1-indexed line number", () => {
  assert.throws(() => parseTileSetText("A 1 2 3\nB 9 8 7 6"), /Line 1/);
  assert.throws(() => parseTileSetText("A 1 2 3 4 5"), /Line 1/);
});

test("parseTileSetText: a duplicate tile id throws", () => {
  assert.throws(() => parseTileSetText("A 1 2 3 4\nA 5 6 7 8"), /duplicate tile id "A"/);
});

test("parseTileSetText: an all-blank/comment-only input throws (no tiles defined)", () => {
  assert.throws(() => parseTileSetText("# only a comment\n\n"), /No tiles defined/);
});

test("tileSetToText: round-trips through parseTileSetText", () => {
  const original = { tiles: [{ id: "L", edges: { N: "v", E: "a", S: "v", W: "b" } }, { id: "R", edges: { N: "v", E: "b", S: "v", W: "a" } }] };
  const text = tileSetToText(original);
  assert.deepEqual(parseTileSetText(text), original);
});

test("DEFAULT_TILES_TEXT parses to a valid 2-tile set", () => {
  const { tiles } = parseTileSetText(DEFAULT_TILES_TEXT);
  assert.equal(tiles.length, 2);
});
