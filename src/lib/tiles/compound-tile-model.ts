/**
 * Polyomino-supported (multi-cell footprint) tiles -- issue #92 M5's one
 * remaining gap, scoped in #277 and implemented here. Deliberately
 * ADDITIVE rather than a rework of `tile-model.ts`: `Tile`/`TileSet`,
 * `tilesCompatible`, and every one of their consumers (symmetry expansion,
 * entropy, diffraction, differentiable relaxation, the hex/tri/cube
 * variants, the plain-text format, the 3D scene) stay exactly as they are,
 * untouched. A `CompoundTile` is a small footprint of *ordinary* unit
 * `Tile`s (each with its familiar `edges: Record<Direction, string>`)
 * fused together at an anchor; the only new idea is which of those cells'
 * sides are real (matched against a neighboring tile) versus welded to
 * another cell in the same footprint (no matching, no border). A unit
 * tile is exactly the degenerate case: a compound tile whose footprint is
 * a single cell -- see {@link unitCompoundTile}.
 *
 * v1 scope (per #277's design pass): the backtracking solver below is the
 * only solver generalized to compound tiles. The torus/periodicity search
 * and the SAT cross-check (`solveTorus`/`solveWangViaSat` in
 * `tile-model.ts`) stay unit-tile-only for now -- both are real, separate
 * generalizations (periodicity's wrap-around neighbors and the SAT CNF
 * encoding's one-variable-per-cell-per-tile scheme both need their own
 * footprint-aware rework), deliberately deferred rather than guessed at
 * here. Likewise the transfer-matrix entropy solver, SCC pruning, and
 * `/tiles` panel rendering are out of scope for this pass.
 */

import type { Direction, Tile } from "./tile-model.ts";

const DIRECTIONS: Direction[] = ["N", "E", "S", "W"];
const OPPOSITE: Record<Direction, Direction> = { N: "S", S: "N", E: "W", W: "E" };
const DIRECTION_DELTA: Record<Direction, CellOffset> = {
  N: { row: -1, col: 0 },
  S: { row: 1, col: 0 },
  E: { row: 0, col: 1 },
  W: { row: 0, col: -1 },
};

export interface CellOffset {
  row: number;
  col: number;
}

/** Stable map key for an offset -- footprints are small, string keys are simplest and fast enough. */
export function offsetKey(o: CellOffset): string {
  return `${o.row},${o.col}`;
}

export interface CompoundTile {
  id: string;
  /** Anchor-relative offsets this tile covers. Always includes `{row:0,col:0}` (the anchor itself). */
  footprint: readonly CellOffset[];
  /** Per-offset cell content (its 4 edge labels), keyed by {@link offsetKey}. Has exactly one entry per `footprint` offset. */
  cells: ReadonlyMap<string, Tile>;
  /**
   * Orientation lock (issue #414), same meaning as `Tile.locked` --
   * carried on the whole `CompoundTile` (not per-cell) since a footprint's
   * orientation is a property of the tile as a whole. Only meaningful for
   * the unit (single-cell) case in practice, since symmetry expansion
   * isn't compound-aware yet (#383) -- see `TilesPanel.tsx`'s own
   * `tileSetResult` derivation for where this gets read back out.
   */
  locked?: boolean;
}

/**
 * True when `footprint` is edge-connected (every offset reachable from any
 * other via a chain of N/E/S/W steps that stay inside the footprint) --
 * the real-polyomino requirement #277 settled on (no disconnected
 * footprints, no holes needed for v1).
 */
export function isFootprintConnected(footprint: readonly CellOffset[]): boolean {
  if (footprint.length === 0) return false;
  const remaining = new Set(footprint.map(offsetKey));
  const byKey = new Map(footprint.map((o) => [offsetKey(o), o]));
  const start = footprint[0]!;
  const stack = [start];
  remaining.delete(offsetKey(start));
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const dir of DIRECTIONS) {
      const delta = DIRECTION_DELTA[dir];
      const neighborKey = offsetKey({ row: current.row + delta.row, col: current.col + delta.col });
      if (remaining.has(neighborKey)) {
        remaining.delete(neighborKey);
        stack.push(byKey.get(neighborKey)!);
      }
    }
  }
  return remaining.size === 0;
}

/**
 * Builds and validates a {@link CompoundTile}: throws if `cells` is empty,
 * doesn't include the `{0,0}` anchor, has a duplicate offset, or isn't
 * edge-connected (see {@link isFootprintConnected}) -- every one of these
 * would otherwise surface much later as a confusing solver bug rather than
 * a clear construction-time error.
 */
export function buildCompoundTile(id: string, cells: ReadonlyArray<{ offset: CellOffset; edges: Record<Direction, string> }>, locked?: boolean): CompoundTile {
  if (cells.length === 0) throw new Error(`Compound tile "${id}": no cells given`);
  const footprint = cells.map((c) => c.offset);
  const keys = footprint.map(offsetKey);
  if (new Set(keys).size !== keys.length) throw new Error(`Compound tile "${id}": duplicate offset in footprint`);
  if (!keys.includes(offsetKey({ row: 0, col: 0 }))) throw new Error(`Compound tile "${id}": footprint must include the anchor offset {0,0}`);
  if (!isFootprintConnected(footprint)) throw new Error(`Compound tile "${id}": footprint is not edge-connected`);
  const cellMap = new Map<string, Tile>();
  for (const c of cells) cellMap.set(offsetKey(c.offset), { id, edges: c.edges });
  return locked ? { id, footprint, cells: cellMap, locked: true } : { id, footprint, cells: cellMap };
}

/** A unit (single-cell) tile expressed as the degenerate 1-cell `CompoundTile` -- every existing `Tile` can be lifted this way with no behavior change. */
export function unitCompoundTile(tile: Tile): CompoundTile {
  return { id: tile.id, footprint: [{ row: 0, col: 0 }], cells: new Map([[offsetKey({ row: 0, col: 0 }), tile]]) };
}

/**
 * True when `direction` from `offset` leaves the footprint -- a REAL edge
 * that participates in matching against whatever tile ends up adjacent
 * there. False means the neighboring cell in that direction is also part
 * of this same footprint: an internal, welded side -- no matching
 * constraint, no border. Purely geometric (derived from the footprint
 * shape), so a compound tile never needs an explicit "welded" flag: it
 * falls out of which offset/direction pairs this function excludes.
 */
export function isBoundaryEdge(footprint: readonly CellOffset[], offset: CellOffset, direction: Direction): boolean {
  const delta = DIRECTION_DELTA[direction];
  const neighborKey = offsetKey({ row: offset.row + delta.row, col: offset.col + delta.col });
  return !footprint.some((o) => offsetKey(o) === neighborKey);
}

/** Every `(offset, direction, label)` this tile actually needs to match against a neighbor -- i.e. every boundary edge, skipping internal welds. */
export function boundaryEdges(tile: CompoundTile): { offset: CellOffset; direction: Direction; label: string }[] {
  const result: { offset: CellOffset; direction: Direction; label: string }[] = [];
  for (const offset of tile.footprint) {
    const cell = tile.cells.get(offsetKey(offset))!;
    for (const direction of DIRECTIONS) {
      if (isBoundaryEdge(tile.footprint, offset, direction)) {
        result.push({ offset, direction, label: cell.edges[direction] });
      }
    }
  }
  return result;
}

export interface CompoundTileSet {
  tiles: CompoundTile[];
}

// ---- Solver -----------------------------------------------------------

interface PlacedCell {
  tileId: string;
  anchorRow: number;
  anchorCol: number;
  edges: Record<Direction, string>;
}

export type CompoundWangGrid = ReadonlyArray<ReadonlyArray<{ tileId: string; anchorRow: number; anchorCol: number }>>;

export interface CompoundSolveStep {
  /** Same snapshot/`trackSteps` tradeoff as `tile-model.ts`'s `SolveStep`. */
  grid: ReadonlyArray<ReadonlyArray<{ tileId: string; anchorRow: number; anchorCol: number } | null>> | null;
  /** The anchor cell this step placed a tile at (or tried to and failed, on a contradiction). */
  anchorRow: number;
  anchorCol: number;
  /** The tile placed, or `null` on a contradiction (no candidate fit at this anchor). */
  tileId: string | null;
  contradiction: boolean;
}

/**
 * Fills a `width`x`height` grid with tiles from `tileSet`, generalizing
 * `tile-model.ts`'s `solveWang` to multi-cell footprints: row-major over
 * ANCHOR cells (skipping cells a wider tile already covers), trying every
 * tile whose footprint fits in-bounds and doesn't overlap an already-
 * placed cell, checking every one of its BOUNDARY edges (see
 * {@link boundaryEdges}) against whatever neighbor is already placed
 * there (in any direction -- a multi-cell footprint can have an
 * already-covered neighbor to its south or east, not just west/north, so
 * this checks all four rather than assuming raster order like the unit
 * solver does), and backtracking the whole footprint atomically on
 * failure.
 *
 * A tile set of only unit (single-cell) tiles behaves identically to
 * `solveWang` -- every footprint reduces to one cell with all 4 sides as
 * boundary edges, and checking a not-yet-placed neighbor is always a
 * no-op, so the extra checks this generalization adds beyond `solveWang`'s
 * west/north-only check never change the outcome.
 */
export async function* solveWangCompound(
  tileSet: CompoundTileSet,
  width: number,
  height: number,
  options: { trackSteps?: boolean } = {},
): AsyncGenerator<CompoundSolveStep, CompoundWangGrid | null> {
  const trackSteps = options.trackSteps ?? true;
  const tiles = tileSet.tiles;
  const grid: (PlacedCell | null)[][] = Array.from({ length: height }, () => Array<PlacedCell | null>(width).fill(null));

  function inBounds(row: number, col: number): boolean {
    return row >= 0 && row < height && col >= 0 && col < width;
  }

  function footprintCandidateCells(tile: CompoundTile, anchorRow: number, anchorCol: number): { row: number; col: number; offset: CellOffset }[] | null {
    const cells: { row: number; col: number; offset: CellOffset }[] = [];
    for (const offset of tile.footprint) {
      const row = anchorRow + offset.row;
      const col = anchorCol + offset.col;
      if (!inBounds(row, col) || grid[row]![col] !== null) return null;
      cells.push({ row, col, offset });
    }
    return cells;
  }

  function fits(tile: CompoundTile, anchorRow: number, anchorCol: number, cells: { row: number; col: number; offset: CellOffset }[]): boolean {
    for (const { row, col, offset } of cells) {
      const cellTile = tile.cells.get(offsetKey(offset))!;
      for (const direction of DIRECTIONS) {
        if (!isBoundaryEdge(tile.footprint, offset, direction)) continue;
        const delta = DIRECTION_DELTA[direction];
        const nr = row + delta.row;
        const nc = col + delta.col;
        if (!inBounds(nr, nc)) continue;
        const neighbor = grid[nr]![nc];
        if (neighbor !== null && neighbor.edges[OPPOSITE[direction]] !== cellTile.edges[direction]) return false;
      }
    }
    return true;
  }

  function place(tile: CompoundTile, anchorRow: number, anchorCol: number, cells: { row: number; col: number; offset: CellOffset }[]): void {
    for (const { row, col, offset } of cells) {
      const cellTile = tile.cells.get(offsetKey(offset))!;
      grid[row]![col] = { tileId: tile.id, anchorRow, anchorCol, edges: cellTile.edges };
    }
  }

  function unplace(cells: { row: number; col: number }[]): void {
    for (const { row, col } of cells) grid[row]![col] = null;
  }

  function snapshot(): ReadonlyArray<ReadonlyArray<{ tileId: string; anchorRow: number; anchorCol: number } | null>> | null {
    if (!trackSteps) return null;
    return grid.map((r) => r.map((c) => (c === null ? null : { tileId: c.tileId, anchorRow: c.anchorRow, anchorCol: c.anchorCol })));
  }

  function nextUncoveredIndex(fromIndex: number): number {
    let index = fromIndex;
    while (index < width * height) {
      const row = Math.floor(index / width);
      const col = index % width;
      if (grid[row]![col] === null) return index;
      index++;
    }
    return index;
  }

  async function* backtrack(fromIndex: number): AsyncGenerator<CompoundSolveStep, boolean> {
    const index = nextUncoveredIndex(fromIndex);
    if (index === width * height) return true;
    const anchorRow = Math.floor(index / width);
    const anchorCol = index % width;
    for (const tile of tiles) {
      const cells = footprintCandidateCells(tile, anchorRow, anchorCol);
      if (cells === null) continue;
      if (!fits(tile, anchorRow, anchorCol, cells)) continue;
      place(tile, anchorRow, anchorCol, cells);
      yield { grid: snapshot(), anchorRow, anchorCol, tileId: tile.id, contradiction: false };
      if (yield* backtrack(index + 1)) return true;
      unplace(cells);
    }
    yield { grid: snapshot(), anchorRow, anchorCol, tileId: null, contradiction: true };
    return false;
  }

  const solved = yield* backtrack(0);
  if (!solved) return null;
  return grid.map((r) => r.map((c) => ({ tileId: c!.tileId, anchorRow: c!.anchorRow, anchorCol: c!.anchorCol })));
}
