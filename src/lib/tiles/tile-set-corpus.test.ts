import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CULIK_13,
  JEANDEL_RAO_11,
  KARI_14,
  MACMAHON_24,
  TILE_SET_CORPUS,
} from "./tile-set-corpus.ts";
import { solveWang, type Tile } from "./tile-model.ts";

async function drainToGrid<T, R>(gen: AsyncGenerator<T, R>): Promise<R> {
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}

function noDuplicateIds(tiles: readonly Tile[]): void {
  assert.equal(new Set(tiles.map((t) => t.id)).size, tiles.length, "duplicate tile ids");
}

/**
 * A basic transcription-error smoke test: every tile must be compatible
 * with SOMETHING (possibly itself) in every direction it has a chance to
 * face -- a tile with a color that appears nowhere else as its opposite
 * would be an isolated vertex in the compatibility digraph, a strong
 * signal of a transcription slip (this doesn't prove aperiodicity, but a
 * genuinely mistranscribed fixture usually fails this immediately).
 */
function everyTileHasSomeNeighborInEveryDirection(tiles: readonly Tile[]): void {
  const dirs = ["N", "E", "S", "W"] as const;
  const opposite = { N: "S", S: "N", E: "W", W: "E" } as const;
  for (const t of tiles) {
    for (const d of dirs) {
      const hasNeighbor = tiles.some((other) => t.edges[d] === other.edges[opposite[d]]);
      assert.ok(hasNeighbor, `tile "${t.id}" has no possible neighbor in direction ${d} (label "${t.edges[d]}") -- likely a transcription error`);
    }
  }
}

test("JEANDEL_RAO_11: 11 tiles, 4 distinct color labels, no duplicate ids, every tile has a possible neighbor in every direction", () => {
  assert.equal(JEANDEL_RAO_11.tiles.length, 11);
  const colors = new Set(JEANDEL_RAO_11.tiles.flatMap((t) => Object.values(t.edges)));
  assert.equal(colors.size, 4, `expected 4 distinct colors, got ${[...colors].sort().join(",")}`);
  noDuplicateIds(JEANDEL_RAO_11.tiles);
  everyTileHasSomeNeighborInEveryDirection(JEANDEL_RAO_11.tiles);
});

test("JEANDEL_RAO_11: solves a modest finite grid (transcription sanity check, not an aperiodicity proof)", async () => {
  const grid = await drainToGrid(solveWang(JEANDEL_RAO_11, 8, 8, { trackSteps: false }));
  assert.ok(grid, "expected the Jeandel-Rao 11-tile set to tile an 8x8 grid");
});

test("KARI_14: 14 tiles, no duplicate ids, every tile has a possible neighbor in every direction (0 and 0' stay distinct labels)", () => {
  assert.equal(KARI_14.tiles.length, 14);
  noDuplicateIds(KARI_14.tiles);
  const zero = KARI_14.tiles.some((t) => Object.values(t.edges).includes("0"));
  const zeroPrime = KARI_14.tiles.some((t) => Object.values(t.edges).includes("0'"));
  assert.ok(zero && zeroPrime, "expected both '0' and \"0'\" to appear as distinct labels");
  everyTileHasSomeNeighborInEveryDirection(KARI_14.tiles);
});

test("KARI_14: solves a modest finite grid", async () => {
  const grid = await drainToGrid(solveWang(KARI_14, 8, 8, { trackSteps: false }));
  assert.ok(grid, "expected the Kari 14-tile set to tile an 8x8 grid");
});

test("CULIK_13: 13 tiles, 5 distinct color labels, no duplicate ids, every tile has a possible neighbor in every direction", () => {
  assert.equal(CULIK_13.tiles.length, 13);
  const colors = new Set(CULIK_13.tiles.flatMap((t) => Object.values(t.edges)));
  assert.equal(colors.size, 5, `expected 5 distinct colors, got ${[...colors].sort().join(",")}`);
  noDuplicateIds(CULIK_13.tiles);
  everyTileHasSomeNeighborInEveryDirection(CULIK_13.tiles);
});

test("CULIK_13: solves a modest finite grid", async () => {
  const grid = await drainToGrid(solveWang(CULIK_13, 8, 8, { trackSteps: false }));
  assert.ok(grid, "expected the Culik 13-tile set to tile an 8x8 grid");
});

test("MACMAHON_24: generates exactly 24 tiles (Burnside's lemma over C4: (81+3+9+3)/4 = 24), all distinct under rotation", () => {
  assert.equal(MACMAHON_24.tiles.length, 24);
  noDuplicateIds(MACMAHON_24.tiles);
  const rotate = (e: readonly [string, string, string, string]): [string, string, string, string] => [e[3], e[0], e[1], e[2]];
  const canonical = new Set<string>();
  for (const t of MACMAHON_24.tiles) {
    let variants: Array<[string, string, string, string]> = [[t.edges.N, t.edges.E, t.edges.S, t.edges.W]];
    for (let i = 0; i < 3; i++) variants.push(rotate(variants[variants.length - 1]!));
    const key = variants.map((v) => v.join(",")).sort()[0]!;
    assert.ok(!canonical.has(key), `tile "${t.id}" is a rotation of an earlier tile -- not distinct`);
    canonical.add(key);
  }
});

test("MACMAHON_24: solves a small finite grid (a bounded puzzle, not aperiodic, but every distinct-coloring set trivially tiles since every color combination exists)", async () => {
  const grid = await drainToGrid(solveWang(MACMAHON_24, 4, 4, { trackSteps: false }));
  assert.ok(grid, "expected MacMahon's 24-tile set to tile a small grid");
});

test("TILE_SET_CORPUS: every entry's id is unique and its tileSet matches its own named export", () => {
  const ids = TILE_SET_CORPUS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate corpus entry ids");
  for (const entry of TILE_SET_CORPUS) {
    assert.ok(entry.name.length > 0);
    assert.ok(entry.description.length > 0);
    assert.equal(entry.lattice, "square", "no cube entries are included yet -- see this file's own 'investigated and not included' note");
  }
});
