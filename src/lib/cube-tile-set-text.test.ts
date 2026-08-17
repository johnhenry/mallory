import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCubeTileSetText, cubeTileSetToText, DEFAULT_CUBE_TILES_TEXT } from "./cube-tile-set-text.ts";

test("parseCubeTileSetText: one line per tile, id then N S E W U D in order", () => {
  const { tiles } = parseCubeTileSetText("A 1 2 3 4 5 6\nB 9 8 7 6 5 4");
  assert.deepEqual(tiles, [
    { id: "A", faces: { N: "1", S: "2", E: "3", W: "4", U: "5", D: "6" } },
    { id: "B", faces: { N: "9", S: "8", E: "7", W: "6", U: "5", D: "4" } },
  ]);
});

test("parseCubeTileSetText: blank lines and #-comment lines are ignored", () => {
  const { tiles } = parseCubeTileSetText("# a comment\nA 1 2 3 4 5 6\n\n  \nB 9 8 7 6 5 4\n");
  assert.equal(tiles.length, 2);
});

test("parseCubeTileSetText: wrong field count throws with the 1-indexed line number", () => {
  assert.throws(() => parseCubeTileSetText("A 1 2 3\nB 9 8 7 6 5 4"), /Line 1/);
  assert.throws(() => parseCubeTileSetText("A 1 2 3 4 5 6 7"), /Line 1/);
});

test("parseCubeTileSetText: a duplicate tile id throws", () => {
  assert.throws(() => parseCubeTileSetText("A 1 2 3 4 5 6\nA 9 8 7 6 5 4"), /duplicate tile id "A"/);
});

test("parseCubeTileSetText: an all-blank/comment-only input throws", () => {
  assert.throws(() => parseCubeTileSetText("# only a comment\n\n"), /No tiles defined/);
});

test("cubeTileSetToText: round-trips through parseCubeTileSetText", () => {
  const original = { tiles: [{ id: "L", faces: { N: "a", S: "b", E: "c", W: "d", U: "e", D: "f" } }] };
  const text = cubeTileSetToText(original);
  assert.deepEqual(parseCubeTileSetText(text), original);
});

test("DEFAULT_CUBE_TILES_TEXT parses to a valid 2-tile set that's compatible with itself both ways N<->S", () => {
  const { tiles } = parseCubeTileSetText(DEFAULT_CUBE_TILES_TEXT);
  assert.equal(tiles.length, 2);
  const [a, b] = tiles as [(typeof tiles)[number], (typeof tiles)[number]];
  assert.equal(a.faces.N, b.faces.S, "A's N face should match B's S face");
  assert.equal(b.faces.N, a.faces.S, "B's N face should match A's S face");
});
