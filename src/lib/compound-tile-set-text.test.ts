import assert from "node:assert/strict";
import { test } from "node:test";
import { compoundTileSetToText, parseCompoundTileSetText } from "./compound-tile-set-text.ts";
import { DEFAULT_TILES_TEXT, parseTileSetText } from "./tile-set-text.ts";

test("parseCompoundTileSetText: a plain 'id N E S W' line (no @offset) parses as a unit tile, matching parseTileSetText exactly", () => {
  const compound = parseCompoundTileSetText(DEFAULT_TILES_TEXT);
  const unit = parseTileSetText(DEFAULT_TILES_TEXT);
  assert.equal(compound.tiles.length, unit.tiles.length);
  for (const tile of compound.tiles) {
    assert.deepEqual(tile.footprint, [{ row: 0, col: 0 }]);
    const matching = unit.tiles.find((t) => t.id === tile.id)!;
    assert.deepEqual(tile.cells.get("0,0")!.edges, matching.edges);
  }
});

test("parseCompoundTileSetText: two lines sharing a base id with @offsets become one 2-cell compound tile", () => {
  // (0,0) and (0,1) sit side by side -- their internal side is (0,0)'s E / (0,1)'s W.
  const text = "A@0,0 1 ? 3 4\nA@0,1 5 6 7 ?";
  const { tiles } = parseCompoundTileSetText(text);
  assert.equal(tiles.length, 1);
  const [tile] = tiles;
  assert.equal(tile!.id, "A");
  assert.equal(tile!.footprint.length, 2);
  assert.deepEqual(tile!.cells.get("0,0")!.edges, { N: "1", E: "?", S: "3", W: "4" });
  assert.deepEqual(tile!.cells.get("0,1")!.edges, { N: "5", E: "6", S: "7", W: "?" });
});

test("parseCompoundTileSetText: '?' on a genuinely internal side is accepted; on a non-internal side it's a parse error", () => {
  // Two cells side by side (0,0) and (0,1): (0,0)'s E and (0,1)'s W are internal.
  assert.doesNotThrow(() => parseCompoundTileSetText("A@0,0 1 ? x 4\nA@0,1 x 3 4 ?"));
  // (0,0)'s N is NOT internal (no footprint-mate to the north) -- '?' there is a mistake.
  assert.throws(() => parseCompoundTileSetText("A@0,0 ? ? x 4\nA@0,1 ? 3 4 5"), /isn't internal/);
});

test("parseCompoundTileSetText: rejects a disconnected footprint (surfaces buildCompoundTile's own validation)", () => {
  assert.throws(() => parseCompoundTileSetText("A@0,0 1 2 3 4\nA@5,5 1 2 3 4"), /connected/);
});

test("parseCompoundTileSetText: rejects a duplicate offset within the same tile", () => {
  assert.throws(() => parseCompoundTileSetText("A@0,0 1 2 3 4\nA@0,0 5 6 7 8"), /already has a cell/);
});

test("parseCompoundTileSetText: rejects a malformed offset", () => {
  assert.throws(() => parseCompoundTileSetText("A@x,y 1 2 3 4"), /invalid offset/);
});

test("compoundTileSetToText round-trips through parseCompoundTileSetText", () => {
  const text = "A@0,0 1 ? 3 4\nA@0,1 5 6 7 ?\nB 9 9 9 9";
  const parsed = parseCompoundTileSetText(text);
  const roundTripped = parseCompoundTileSetText(compoundTileSetToText(parsed));
  assert.equal(roundTripped.tiles.length, parsed.tiles.length);
  for (const tile of parsed.tiles) {
    const match = roundTripped.tiles.find((t) => t.id === tile.id)!;
    assert.deepEqual([...match.footprint].sort(offsetSort), [...tile.footprint].sort(offsetSort));
    for (const offset of tile.footprint) {
      const key = `${offset.row},${offset.col}`;
      assert.deepEqual(match.cells.get(key)!.edges, tile.cells.get(key)!.edges);
    }
  }
});

function offsetSort(a: { row: number; col: number }, b: { row: number; col: number }): number {
  return a.row - b.row || a.col - b.col;
}
