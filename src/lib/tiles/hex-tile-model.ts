/**
 * Hex-lattice Wang tiles (issue #92 M3's hex/tri lattice generalization,
 * hex half). A `HexTile` has one edge label per one of the 6 axial
 * directions (mallory-math's `HexDirection`, the standard pointy-top
 * ordering E/NE/NW/W/SW/SE), matching mallory-math's own `HEX_AXIAL_
 * DIRECTIONS` indexing exactly -- direction `d`'s opposite is `(d+3) % 6`,
 * per that module's own verified doc comment.
 *
 * Deliberately a SEPARATE module from tile-model.ts, not a generalization
 * of it: the square-lattice `Tile`/`solveWang` machinery stays exactly as
 * it is (still the default, still what M1/M2/M3's square-lattice slice
 * build on), and this is a parallel implementation for the hex case --
 * matching this lab's own "lattice descriptor" framing (square/hex/tri are
 * different constraint structures, not different parameterizations of one
 * structure). Only the CORE solver ships here (mirroring solveWang's own
 * simplest-correct-form precedent from M1); the torus/periodicity search
 * and SAT cross-check solver that square lattices later grew are deferred.
 */
import { type HexDirection, hexNeighbor } from "@johnhenry/math";

export interface HexTile {
  id: string;
  edges: Record<HexDirection, string>;
}

export interface HexTileSet {
  tiles: HexTile[];
}

/** `HexDirection` `d`'s opposite -- `(d+3) % 6`, per mallory-math's own `HEX_AXIAL_DIRECTIONS` doc comment (verified there: `hexNeighbor` in direction `d` then `(d+3)%6` returns to the start cell). */
const OPPOSITE_HEX_DIRECTION: Record<HexDirection, HexDirection> = { 0: 3, 1: 4, 2: 5, 3: 0, 4: 1, 5: 2 };

/**
 * True when `a` and `b` can sit adjacent with `b` in direction `d` from
 * `a` -- the label `a` shows on its `d` edge matches the label `b` shows
 * on the edge facing back at `a`. Same matching rule as the square
 * lattice's `tilesCompatible`, just over 6 directions instead of 4.
 */
export function hexTilesCompatible(a: HexTile, b: HexTile, d: HexDirection): boolean {
  return a.edges[d] === b.edges[OPPOSITE_HEX_DIRECTION[d]];
}

/** Per-direction compatibility digraph, mirroring tile-model.ts's `buildCompatibilityDigraph` for the hex case. */
export function buildHexCompatibilityDigraph(tiles: readonly HexTile[], d: HexDirection): Map<string, Set<string>> {
  const digraph = new Map<string, Set<string>>();
  for (const a of tiles) {
    const compatible = new Set<string>();
    for (const b of tiles) {
      if (hexTilesCompatible(a, b, d)) compatible.add(b.id);
    }
    digraph.set(a.id, compatible);
  }
  return digraph;
}

/**
 * A parallelogram-shaped patch of the hex lattice in axial coordinates:
 * `q in [0, width)`, `r in [0, height)`. The simplest hex-region shape to
 * enumerate and fill (a hexagonal or rhombic region needs more bookkeeping
 * to define its boundary) -- the same "simplest correct region, more
 * shapes are a later concern" choice `solveWang`'s own axis-aligned
 * rectangle already makes for the square lattice.
 */
export type HexGrid = ReadonlyArray<ReadonlyArray<string>>;

export interface HexSolveStep {
  /**
   * The grid so far, row-major over `r` then `q`, `null` for not-yet-decided
   * cells -- or `null` itself when `options.trackSteps` is `false` (see
   * `solveHex`'s own doc comment): a full-grid deep clone costs O(width *
   * height) and a caller that only wants the final grid (no step-by-step
   * animation) would otherwise pay that cost on every placement AND every
   * backtrack for nothing.
   */
  grid: ReadonlyArray<ReadonlyArray<string | null>> | null;
  q: number;
  r: number;
  contradiction: boolean;
}

/**
 * Every direction whose neighbor is ALREADY placed when filling axial
 * cells in row-major order (`r` ascending, then `q` ascending within each
 * row): direction 1 (NE, `(q+1,r-1)`), 2 (NW, `(q,r-1)`), and 3 (W,
 * `(q-1,r)`) -- the only three of the six axial offsets that move to a
 * strictly earlier `(r,q)` in that fill order (verified against
 * `HEX_AXIAL_DIRECTIONS`' own offsets before writing this: direction 0/E
 * moves to a LATER q same row, 4/SW and 5/SE both move to a LATER r).
 */
const ALREADY_PLACED_DIRECTIONS: readonly HexDirection[] = [1, 2, 3];

/**
 * Fills a `width`x`height` axial parallelogram with tiles from `tileSet`
 * under hex edge-matching, via plain backtracking -- the hex-lattice
 * counterpart to `solveWang`. At each cell, tries every tile compatible
 * with its already-placed NE/NW/W neighbors (the three neighbors a
 * row-major fill order has already decided; see
 * {@link ALREADY_PLACED_DIRECTIONS}), recurses, and on total failure
 * clears the cell for the caller's next candidate. An async generator
 * (same "streamed so long searches stay pausable" reasoning as
 * `solveWang`): yields a `HexSolveStep` after every placement and every
 * backtrack.
 *
 * `options.trackSteps` (default `true`) controls whether each yielded step
 * carries a full grid snapshot. `TilesPanel` currently drains this solver
 * straight to its final grid (no step-by-step animation for hex -- see
 * `MAX_HEX_TRI_CELLS`'s own doc comment) and discards every intermediate
 * step, so it passes `trackSteps: false` to skip the O(width * height)
 * clone on every step -- otherwise a hard-to-satisfy tile set needing many
 * backtracks pays that cost for a value nobody reads.
 */
export async function* solveHex(
  tileSet: HexTileSet,
  width: number,
  height: number,
  options: { trackSteps?: boolean } = {},
): AsyncGenerator<HexSolveStep, HexGrid | null> {
  const trackSteps = options.trackSteps ?? true;
  const tiles = tileSet.tiles;
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const grid: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null));

  function candidatesAt(q: number, r: number): HexTile[] {
    return tiles.filter((t) => {
      for (const d of ALREADY_PLACED_DIRECTIONS) {
        const [nq, nr] = hexNeighbor(q, r, d);
        if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
        const neighborId = grid[nr]![nq];
        if (neighborId !== null && !hexTilesCompatible(t, byId.get(neighborId)!, d)) return false;
      }
      return true;
    });
  }

  function snapshot(): (string | null)[][] | null {
    return trackSteps ? grid.map((row) => [...row]) : null;
  }

  async function* backtrack(index: number): AsyncGenerator<HexSolveStep, boolean> {
    if (index === width * height) return true;
    const r = Math.floor(index / width);
    const q = index % width;
    for (const tile of candidatesAt(q, r)) {
      grid[r]![q] = tile.id;
      yield { grid: snapshot(), q, r, contradiction: false };
      if (yield* backtrack(index + 1)) return true;
    }
    grid[r]![q] = null;
    yield { grid: snapshot(), q, r, contradiction: true };
    return false;
  }

  const solved = yield* backtrack(0);
  return solved ? (grid as HexGrid) : null;
}
