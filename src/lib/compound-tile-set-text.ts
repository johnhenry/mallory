import type { Direction } from "./tiles/tile-model.ts";
import { buildCompoundTile, type CellOffset, type CompoundTile, type CompoundTileSet, offsetKey } from "./tiles/compound-tile-model.ts";

/**
 * Plain-text format for a (possibly polyomino-supported) Wang tile set --
 * issue #293's own ask, resolved per #277/#382's `CompoundTile` model.
 * Grows `tile-set-text.ts`'s existing `id N E S W` grammar (kept
 * completely unmodified there -- this is a separate, additive parser) with
 * two ideas:
 *
 * 1. An optional `@row,col` footprint offset suffix on the id:
 *    `A@0,0 1 2 ? 4` declares cell `(0,0)` of a multi-cell tile named `A`.
 *    Every line sharing the same base id (the part before `@`) belongs to
 *    that one compound tile; a plain `id` with no `@` is exactly today's
 *    unit tile (implicitly `@0,0`), so every existing tile-set text file
 *    still parses unchanged.
 * 2. A `?` edge value marks a side as INTERNAL -- welded to whatever other
 *    footprint cell is geometrically on that side, no matching enforced,
 *    no border drawn. Resolves #293's own open question of exact marker
 *    syntax: rather than the sketched paired numbers (`?1`/`?2`...), a
 *    single `?` is enough, because which side pairs with which is already
 *    fully determined by the footprint geometry (two cells adjacent in the
 *    declared offsets are welded on the shared side automatically -- see
 *    `compound-tile-model.ts`'s `isBoundaryEdge`) -- asking the user to
 *    ALSO number-pair sides that geometry already pairs would just be
 *    redundant bookkeeping that could silently mismatch. `?` on a side
 *    that ISN'T geometrically internal (no footprint-mate on that side) is
 *    a parse error -- almost always a copy-paste offset typo, better
 *    caught here than as a silently-ignored edge label.
 */
const DIRECTIONS: Direction[] = ["N", "E", "S", "W"];
const WELD_MARKER = "?";

interface RawCellLine {
  baseId: string;
  offset: CellOffset;
  edges: Record<Direction, string>;
  lineNumber: number;
}

function parseIdAndOffset(idField: string, lineNumber: number): { baseId: string; offset: CellOffset } {
  const at = idField.indexOf("@");
  if (at === -1) return { baseId: idField, offset: { row: 0, col: 0 } };
  const baseId = idField.slice(0, at);
  const offsetText = idField.slice(at + 1);
  const match = /^(-?\d+),(-?\d+)$/.exec(offsetText);
  if (!match) throw new Error(`Line ${lineNumber}: invalid offset "@${offsetText}" -- expected "@row,col" (e.g. "@0,1")`);
  if (baseId === "") throw new Error(`Line ${lineNumber}: "@${offsetText}" has no tile id before it`);
  return { baseId, offset: { row: Number(match[1]), col: Number(match[2]) } };
}

export function parseCompoundTileSetText(text: string): CompoundTileSet {
  const rawByBaseId = new Map<string, RawCellLine[]>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Line ${i + 1}: expected "id[@row,col] N E S W" (5 fields), got ${parts.length}: "${line}"`);
    }
    const [idField, n, e, s, w] = parts as [string, string, string, string, string];
    const { baseId, offset } = parseIdAndOffset(idField, i + 1);
    const edges: Record<Direction, string> = { N: n, E: e, S: s, W: w };
    const raw = rawByBaseId.get(baseId) ?? [];
    if (raw.some((r) => offsetKey(r.offset) === offsetKey(offset))) {
      throw new Error(`Line ${i + 1}: tile "${baseId}" already has a cell at offset (${offset.row},${offset.col})`);
    }
    raw.push({ baseId, offset, edges, lineNumber: i + 1 });
    rawByBaseId.set(baseId, raw);
  }
  if (rawByBaseId.size === 0) throw new Error('No tiles defined -- add at least one line: id N E S W (or "id@row,col N E S W" for a multi-cell tile)');

  const tiles: CompoundTile[] = [];
  for (const [baseId, raw] of rawByBaseId) {
    const footprint = raw.map((r) => r.offset);
    const cellsInput = raw.map((r) => ({ offset: r.offset, edges: r.edges }));
    const tile = buildCompoundTile(baseId, cellsInput);
    // Validate every `?` sits on a genuinely internal side, and derive the
    // real matched label for boundary sides (a boundary side's value is
    // never allowed to be the weld marker -- that's meaningless there).
    for (const r of raw) {
      for (const direction of DIRECTIONS) {
        const isInternal = !isBoundaryOffsetDirection(footprint, r.offset, direction);
        const value = r.edges[direction];
        if (value === WELD_MARKER && !isInternal) {
          throw new Error(`Line ${r.lineNumber}: "${WELD_MARKER}" on side ${direction} of "${baseId}@${r.offset.row},${r.offset.col}" isn't internal -- no footprint-mate on that side`);
        }
      }
    }
    tiles.push(tile);
  }
  return { tiles };
}

function isBoundaryOffsetDirection(footprint: readonly CellOffset[], offset: CellOffset, direction: Direction): boolean {
  const delta = { N: { row: -1, col: 0 }, S: { row: 1, col: 0 }, E: { row: 0, col: 1 }, W: { row: 0, col: -1 } }[direction];
  const neighborKey = offsetKey({ row: offset.row + delta.row, col: offset.col + delta.col });
  return !footprint.some((o) => offsetKey(o) === neighborKey);
}

export function compoundTileSetToText(tileSet: CompoundTileSet): string {
  const lines: string[] = [];
  for (const tile of tileSet.tiles) {
    const isUnit = tile.footprint.length === 1 && offsetKey(tile.footprint[0]!) === "0,0";
    for (const offset of tile.footprint) {
      const cell = tile.cells.get(offsetKey(offset))!;
      const idField = isUnit ? tile.id : `${tile.id}@${offset.row},${offset.col}`;
      const values = DIRECTIONS.map((d) => (isBoundaryOffsetDirection(tile.footprint, offset, d) ? cell.edges[d] : WELD_MARKER));
      lines.push([idField, ...values].join(" "));
    }
  }
  return lines.join("\n");
}
