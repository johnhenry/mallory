/**
 * Core Wang-tile machinery for the tiling laboratory (issue #92, M1: square
 * lattice, translations only -- no symmetry expansion, no hex/tri lattice,
 * no 3D cubes; those are later milestones, each gated on an upstream
 * dependency this M1 slice doesn't need). Lives in `src/lib/tiles/` per the
 * issue's own explicit ordering ("Core machinery... first; extract to a
 * `mallory-tiles` package once M2 stabilizes"), ahead of the `/tiles` panel
 * itself, which is a separate follow-up PR.
 *
 * A tile is a unit square with one edge-label per side. Two tiles placed
 * side by side are compatible in a direction when the label on the shared
 * border matches -- the classical Wang-tile matching rule (edge colors, not
 * corner colors; corner-tile matching is issue #92's own explicitly later
 * "Matching locus" axis).
 */

export type Direction = "N" | "E" | "S" | "W";

/** The direction you'd travel to look back at the tile you came from. */
const OPPOSITE: Record<Direction, Direction> = { N: "S", S: "N", E: "W", W: "E" };

export interface Tile {
  id: string;
  edges: Record<Direction, string>;
}

export interface TileSet {
  tiles: Tile[];
}

/**
 * True when `a` and `b` can sit side by side with `b` in `direction` from
 * `a` -- i.e. the label `a` shows on its `direction` edge matches the label
 * `b` shows on the edge facing back at `a`.
 */
export function tilesCompatible(a: Tile, b: Tile, direction: Direction): boolean {
  return a.edges[direction] === b.edges[OPPOSITE[direction]];
}

/**
 * Per-direction compatibility digraph: for each tile, the set of tile ids
 * that may legally sit in `direction` from it. One of issue #92's own
 * listed "Analysis" artifacts (feeds the deferred SCC-pruning solver, which
 * needs Graph SCC from johnhenry/mallory#30) -- exposed here as a small
 * pure function, independent of the backtracking solver below, which
 * recomputes compatibility inline rather than consulting this digraph
 * (the digraph is for analysis/pruning; the solver's own per-cell filter
 * is simpler and doesn't need a graph structure to stay correct at M1's
 * unit-tile, translations-only scale).
 */
export function buildCompatibilityDigraph(tiles: readonly Tile[], direction: Direction): Map<string, Set<string>> {
  const digraph = new Map<string, Set<string>>();
  for (const a of tiles) {
    const compatible = new Set<string>();
    for (const b of tiles) {
      if (tilesCompatible(a, b, direction)) compatible.add(b.id);
    }
    digraph.set(a.id, compatible);
  }
  return digraph;
}

export type WangGrid = ReadonlyArray<ReadonlyArray<string>>;

export interface SolveStep {
  /** The grid so far, row-major, `null` for not-yet-decided cells. */
  grid: ReadonlyArray<ReadonlyArray<string | null>>;
  row: number;
  col: number;
  /** True when this step is a backtrack out of a dead end (the cell at row/col ran out of candidates and was cleared), not a placement. */
  contradiction: boolean;
}

/**
 * Fills a `width`x`height` grid with tiles from `tileSet` under the edge-
 * matching constraint, row-major (west-to-east, north-to-south), via plain
 * backtracking: at each cell, try every tile compatible with its already-
 * placed west/north neighbors (no other neighbors are placed yet in
 * row-major order), recurse, and on total failure clear the cell and let
 * the caller try its own next candidate. This is issue #92's own listed
 * "Backtracking with constraint propagation" solver in its simplest
 * correct form -- checking against already-fixed neighbors as each cell is
 * placed, not full arc-consistency (AC-3, which would also prune *future*
 * cells' domains before they're reached). AC-3 propagation, the SAT
 * cross-check solver, and the torus/periodicity search are the issue's own
 * separate listed solver variants, deferred to follow-up PRs.
 *
 * An async generator (per the issue's own "streamed as async generator so
 * long searches stay pausable"): yields a `SolveStep` after every
 * placement AND every backtrack, so a caller (the eventual `/tiles` solve
 * view's transport animation) can play back the search step by step. The
 * generator's return value is the finished grid, or `null` if no tiling of
 * this size exists for this tile set.
 */
export async function* solveWang(tileSet: TileSet, width: number, height: number): AsyncGenerator<SolveStep, WangGrid | null> {
  const tiles = tileSet.tiles;
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const grid: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null));

  function candidatesAt(row: number, col: number): Tile[] {
    return tiles.filter((t) => {
      if (col > 0) {
        const westId = grid[row][col - 1];
        if (westId !== null && !tilesCompatible(byId.get(westId)!, t, "E")) return false;
      }
      if (row > 0) {
        const northId = grid[row - 1][col];
        if (northId !== null && !tilesCompatible(byId.get(northId)!, t, "S")) return false;
      }
      return true;
    });
  }

  function snapshot(): (string | null)[][] {
    return grid.map((r) => [...r]);
  }

  async function* backtrack(index: number): AsyncGenerator<SolveStep, boolean> {
    if (index === width * height) return true;
    const row = Math.floor(index / width);
    const col = index % width;
    for (const tile of candidatesAt(row, col)) {
      grid[row][col] = tile.id;
      yield { grid: snapshot(), row, col, contradiction: false };
      if (yield* backtrack(index + 1)) return true;
    }
    grid[row][col] = null;
    yield { grid: snapshot(), row, col, contradiction: true };
    return false;
  }

  const solved = yield* backtrack(0);
  return solved ? (grid as WangGrid) : null;
}
