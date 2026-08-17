/**
 * Triangular-lattice Wang tiles (issue #92 M3, tri half). Companion to
 * hex-tile-model.ts -- same "separate module per lattice, not one
 * generalized model" framing.
 *
 * A `TriTile` always defines all 4 possible edges (`left`/`right`/`top`/
 * `bottom`), even though any single placement only uses 3 of them: which
 * 3 depends on the CELL's orientation (mallory-math's `triOrientation`),
 * not the tile -- an "up" cell (left/right/top) and a "down" cell
 * (left/right/bottom) are different physical shapes at different lattice
 * positions, and the same tile design can appear in either. Defining all
 * 4 up front lets one `TriTile` be placed at any position without a
 * separate up-specific/down-specific tile type.
 */
import { type TriDirection, type TriOrientation, triNeighbor, triOrientation } from "mallory-math";

export interface TriTile {
  id: string;
  edges: { left: string; right: string; top: string; bottom: string };
}

export interface TriTileSet {
  tiles: TriTile[];
}

/**
 * `left`<->`right` and `top`<->`bottom` are the universal opposite pairs
 * -- verified against mallory-math's own `triNeighbor` doc comment: "an
 * 'up' cell's 'right' neighbor's 'left' is itself" and "an 'up' cell's
 * 'top' neighbor's 'bottom' is itself" (and symmetrically for the down
 * cell on the other side of each edge). Unlike the hex/square opposite
 * maps, this one doesn't depend on which specific direction value you
 * start from -- just this one fixed pairing.
 */
const OPPOSITE_TRI_DIRECTION: Record<TriDirection, TriDirection> = { left: "right", right: "left", top: "bottom", bottom: "top" };

/** True when `a` and `b` can sit adjacent with `b` in direction `d` from `a` (same edge-matching rule as the square/hex lattices). */
export function triTilesCompatible(a: TriTile, b: TriTile, d: TriDirection): boolean {
  return a.edges[d] === b.edges[OPPOSITE_TRI_DIRECTION[d]];
}

/** Per-direction compatibility digraph, mirroring tile-model.ts's `buildCompatibilityDigraph` for the triangular case. */
export function buildTriCompatibilityDigraph(tiles: readonly TriTile[], d: TriDirection): Map<string, Set<string>> {
  const digraph = new Map<string, Set<string>>();
  for (const a of tiles) {
    const compatible = new Set<string>();
    for (const b of tiles) {
      if (triTilesCompatible(a, b, d)) compatible.add(b.id);
    }
    digraph.set(a.id, compatible);
  }
  return digraph;
}

export type TriGrid = ReadonlyArray<ReadonlyArray<string>>;

export interface TriSolveStep {
  /** The grid so far, row-major over `y` then `x`, `null` for not-yet-decided cells. */
  grid: ReadonlyArray<ReadonlyArray<string | null>>;
  x: number;
  y: number;
  contradiction: boolean;
}

/**
 * Every direction whose neighbor is ALREADY placed when filling `(x, y)`
 * cells in row-major order (`y` ascending, then `x` ascending within each
 * row), for a cell of the given `orientation` -- derived from
 * `triNeighbor`'s own offsets: `"left"` is `(x-1,y)` (same row, earlier
 * `x` -- always already placed), `"right"` is `(x+1,y)` (later `x` --
 * never yet placed), `"top"` (only valid on an "up" cell) is `(x,y+1)`
 * (a later row -- never yet placed), `"bottom"` (only valid on a "down"
 * cell) is `(x,y-1)` (an earlier row -- always already placed). So an
 * "up" cell has exactly one already-placed neighbor direction (`"left"`);
 * a "down" cell has two (`"left"` and `"bottom"`).
 */
function alreadyPlacedDirections(orientation: TriOrientation): readonly TriDirection[] {
  return orientation === "up" ? ["left"] : ["left", "bottom"];
}

/**
 * Fills a `width`x`height` rectangular patch of triangular cells with
 * tiles from `tileSet` under tri edge-matching, via plain backtracking --
 * the triangular-lattice counterpart to `solveWang`/`solveHex`. Same
 * "core solver only" scoping as hex-tile-model.ts's `solveHex`: an async
 * generator yielding a `TriSolveStep` after every placement and every
 * backtrack, no torus/SAT variants yet.
 */
export async function* solveTri(tileSet: TriTileSet, width: number, height: number): AsyncGenerator<TriSolveStep, TriGrid | null> {
  const tiles = tileSet.tiles;
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const grid: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null));

  function candidatesAt(x: number, y: number): TriTile[] {
    const directions = alreadyPlacedDirections(triOrientation(x, y));
    return tiles.filter((t) => {
      for (const d of directions) {
        const [nx, ny] = triNeighbor(x, y, d);
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighborId = grid[ny]![nx];
        if (neighborId !== null && !triTilesCompatible(t, byId.get(neighborId)!, d)) return false;
      }
      return true;
    });
  }

  function snapshot(): (string | null)[][] {
    return grid.map((row) => [...row]);
  }

  async function* backtrack(index: number): AsyncGenerator<TriSolveStep, boolean> {
    if (index === width * height) return true;
    const y = Math.floor(index / width);
    const x = index % width;
    for (const tile of candidatesAt(x, y)) {
      grid[y]![x] = tile.id;
      yield { grid: snapshot(), x, y, contradiction: false };
      if (yield* backtrack(index + 1)) return true;
    }
    grid[y]![x] = null;
    yield { grid: snapshot(), x, y, contradiction: true };
    return false;
  }

  const solved = yield* backtrack(0);
  return solved ? (grid as TriGrid) : null;
}
