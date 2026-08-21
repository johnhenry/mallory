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

test("parseCompoundTileSetText: a continuation line with the id omitted (4 fields) stacks below the previous line, same tile (issue #390)", () => {
  // Vertical stacking: (0,0)'s internal side is S, (1,0)'s is N.
  const text = "A 1 2 ? 4\n? 6 7 8";
  const { tiles } = parseCompoundTileSetText(text);
  assert.equal(tiles.length, 1);
  const [tile] = tiles;
  assert.equal(tile!.id, "A");
  assert.deepEqual(
    [...tile!.footprint].sort((a, b) => a.row - b.row),
    [
      { row: 0, col: 0 },
      { row: 1, col: 0 },
    ],
  );
  assert.deepEqual(tile!.cells.get("1,0")!.edges, { N: "?", E: "6", S: "7", W: "8" });
});

test("parseCompoundTileSetText: a continuation line with a bare '?' id (5 fields) means the same as omitting it entirely", () => {
  const withoutId = parseCompoundTileSetText("A 1 2 ? 4\n? 6 7 8");
  const withQuestionId = parseCompoundTileSetText("A 1 2 ? 4\n? ? 6 7 8");
  assert.deepEqual(withQuestionId, withoutId);
});

test("parseCompoundTileSetText: three continuation lines stack three rows deep under the same base id", () => {
  const { tiles } = parseCompoundTileSetText("A 1 x x x\nx x x x\nx x x x");
  assert.equal(tiles.length, 1);
  assert.deepEqual(
    [...tiles[0]!.footprint].sort((a, b) => a.row - b.row).map((o) => o.row),
    [0, 1, 2],
  );
});

test("parseCompoundTileSetText: a continuation line with nothing preceding it is a parse error", () => {
  assert.throws(() => parseCompoundTileSetText("1 2 3 4"), /needs a preceding tile line/);
});

test("parseCompoundTileSetText: a trailing * on a unit tile's id marks it locked (#414)", () => {
  const { tiles } = parseCompoundTileSetText("A* 1 2 3 4\nB 9 8 7 6");
  const a = tiles.find((t) => t.id === "A")!;
  const b = tiles.find((t) => t.id === "B")!;
  assert.equal(a.locked, true);
  assert.equal(b.locked, undefined);
});

test("parseCompoundTileSetText: * on a multi-cell tile's anchor line (before @) locks the whole compound tile", () => {
  const { tiles } = parseCompoundTileSetText("A*@0,0 1 ? 3 4\nA@0,1 5 6 7 ?");
  const a = tiles.find((t) => t.id === "A")!;
  assert.equal(a.locked, true);
  assert.equal(a.footprint.length, 2);
});

test("parseCompoundTileSetText: * only needs to appear on ONE line for a multi-cell tile -- a later un-starred line for the same id doesn't unlock it", () => {
  const { tiles } = parseCompoundTileSetText("A*@0,0 1 ? 3 4\nA@0,1 5 6 7 ?");
  assert.equal(tiles.find((t) => t.id === "A")!.locked, true);
});

test("compoundTileSetToText: re-adds the * for a locked tile, on every line for a multi-cell footprint, round-tripping through parseCompoundTileSetText", () => {
  const text = "A*@0,0 1 ? 3 4\nA@0,1 5 6 7 ?";
  const parsed = parseCompoundTileSetText(text);
  const serialized = compoundTileSetToText(parsed);
  assert.match(serialized, /^A\*@0,0/);
  assert.match(serialized, /A\*@0,1/);
  const roundTripped = parseCompoundTileSetText(serialized);
  assert.equal(roundTripped.tiles.find((t) => t.id === "A")!.locked, true);
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
