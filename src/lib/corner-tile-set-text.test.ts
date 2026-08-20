import assert from "node:assert/strict";
import { test } from "node:test";
import { cornerTileSetToText, DEFAULT_CORNER_TILES_TEXT, parseCornerTileSetText } from "./corner-tile-set-text.ts";
import { solveCornerTiles } from "./tiles/corner-tile-model.ts";

async function drainToGrid<T, R>(gen: AsyncGenerator<T, R>): Promise<R> {
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}

test("parseCornerTileSetText: parses 'id NE SE SW NW' lines in order", () => {
  const { tiles } = parseCornerTileSetText("A 1 2 3 4\nB 5 6 7 8");
  assert.deepEqual(tiles, [
    { id: "A", corners: { NE: "1", SE: "2", SW: "3", NW: "4" } },
    { id: "B", corners: { NE: "5", SE: "6", SW: "7", NW: "8" } },
  ]);
});

test("parseCornerTileSetText: ignores blank lines and # comments", () => {
  const { tiles } = parseCornerTileSetText("# a comment\n\nA 1 2 3 4\n");
  assert.equal(tiles.length, 1);
});

test("parseCornerTileSetText: rejects the wrong field count and duplicate ids", () => {
  assert.throws(() => parseCornerTileSetText("A 1 2 3"), /expected "id NE SE SW NW"/);
  assert.throws(() => parseCornerTileSetText("A 1 2 3 4\nA 5 6 7 8"), /duplicate tile id/);
});

test("parseCornerTileSetText: rejects empty input", () => {
  assert.throws(() => parseCornerTileSetText(""), /No tiles defined/);
});

test("cornerTileSetToText round-trips through parseCornerTileSetText", () => {
  const original = parseCornerTileSetText(DEFAULT_CORNER_TILES_TEXT);
  const roundTripped = parseCornerTileSetText(cornerTileSetToText(original));
  assert.deepEqual(roundTripped, original);
});

test("DEFAULT_CORNER_TILES_TEXT: parses and solves its own natural 2x2 grid", async () => {
  const tileSet = parseCornerTileSetText(DEFAULT_CORNER_TILES_TEXT);
  const grid = await drainToGrid(solveCornerTiles(tileSet, 2, 2, { trackSteps: false }));
  assert.deepEqual(grid, [
    ["A", "B"],
    ["C", "D"],
  ]);
});
