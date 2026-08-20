/**
 * Corner-tile Wang tiles (issue #92's "Matching locus" axis, scoped in
 * #388, implemented here). A `CornerTile` has one label per one of its 4
 * CORNERS (NE/SE/SW/NW) instead of one per side -- Lagae & Dutré, "An
 * Alternative for Wang Tiles: Colored Edges versus Colored Corners" (ACM
 * TOG 25(4), 2006).
 *
 * Deliberately a separate module from tile-model.ts, matching this lab's
 * own "lattice/locus descriptor, not a parameterization" precedent
 * (hex/tri/cube/compound each got their own file too): corner tiles have
 * NO edge concept at all in the paper's own model ("edges have no color
 * in this scheme"), so there's nothing to share with the edge-based
 * `Tile`.
 *
 * The paper's own underlying model is genuinely N-way (one shared color
 * per grid VERTEX, read by up to 4 tiles touching it -- confirmed via its
 * §4.2 "Direct Stochastic Tiling" construction, `h(x,y)` evaluated at
 * lattice points), NOT a series of independent pairwise edge checks. But
 * for a SOLVER, equality's transitivity makes pairwise checks against
 * every already-placed neighbor sharing a corner exactly equivalent and
 * sufficient -- that's what {@link cornersCompatible} implements. It
 * further turns out (see {@link solveCornerTiles}'s own doc comment for
 * the proof) that in row-major fill order, checking only the W and N
 * already-placed neighbors -- exactly `solveWang`'s own shape -- already
 * forces full diagonal agreement too, so `NeighborDirection`'s "NW"/"NE"
 * variants exist here as general-purpose compatibility primitives, not
 * because the solver itself needs them.
 */

export type Corner = "NE" | "SE" | "SW" | "NW";

export interface CornerTile {
  id: string;
  corners: Record<Corner, string>;
}

export interface CornerTileSet {
  tiles: CornerTile[];
}

/**
 * True when `a`'s `aCorner` and `b`'s `bCorner` can be the same grid
 * vertex -- i.e. their labels there agree. Unlike edge matching's single
 * "opposite direction" relationship, which corner of `b` corresponds to
 * which corner of `a` depends entirely on `b`'s position relative to `a`
 * (caller's responsibility -- see {@link solveCornerTiles}'s own 4
 * already-placed-neighbor checks for the concrete pairings).
 */
export function cornersCompatible(a: CornerTile, aCorner: Corner, b: CornerTile, bCorner: Corner): boolean {
  return a.corners[aCorner] === b.corners[bCorner];
}

/**
 * Per-neighbor-direction compatibility digraph, mirroring tile-model.ts's
 * `buildCompatibilityDigraph` -- `direction` is which of the 4
 * already-placed-neighbor relationships (see `solveCornerTiles`) to build
 * the digraph for, e.g. "W" means "the set of tiles that may legally sit
 * to the WEST of each tile" (checked via that pair's shared NW/SW corners).
 */
export type NeighborDirection = "W" | "N" | "NW" | "NE";

const NEIGHBOR_CORNER_PAIRS: Record<NeighborDirection, ReadonlyArray<readonly [Corner, Corner]>> = {
  // West neighbor: this tile's NW/SW == west neighbor's NE/SE.
  W: [
    ["NW", "NE"],
    ["SW", "SE"],
  ],
  // North neighbor: this tile's NW/NE == north neighbor's SW/SE.
  N: [
    ["NW", "SW"],
    ["NE", "SE"],
  ],
  // Northwest-diagonal neighbor: this tile's NW == that neighbor's SE (one shared vertex).
  NW: [["NW", "SE"]],
  // Northeast-diagonal neighbor: this tile's NE == that neighbor's SW (one shared vertex).
  NE: [["NE", "SW"]],
};

/** True when `b` may legally sit in `direction` from `a` (see {@link NeighborDirection}), checking every corner pair that relationship shares. */
export function cornerTilesCompatible(a: CornerTile, b: CornerTile, direction: NeighborDirection): boolean {
  return NEIGHBOR_CORNER_PAIRS[direction].every(([aCorner, bCorner]) => cornersCompatible(a, aCorner, b, bCorner));
}

/** Per-direction compatibility digraph, mirroring tile-model.ts's `buildCompatibilityDigraph`. */
export function buildCornerCompatibilityDigraph(tiles: readonly CornerTile[], direction: NeighborDirection): Map<string, Set<string>> {
  const digraph = new Map<string, Set<string>>();
  for (const a of tiles) {
    const compatible = new Set<string>();
    for (const b of tiles) {
      if (cornerTilesCompatible(a, b, direction)) compatible.add(b.id);
    }
    digraph.set(a.id, compatible);
  }
  return digraph;
}

export type CornerGrid = ReadonlyArray<ReadonlyArray<string>>;

export interface CornerSolveStep {
  grid: ReadonlyArray<ReadonlyArray<string | null>> | null;
  row: number;
  col: number;
  contradiction: boolean;
}

/**
 * Fills a `width`x`height` grid with corner tiles from `tileSet`, row-major,
 * via plain backtracking -- the corner-tile counterpart to `solveWang`.
 *
 * Checks only W and N, exactly like `solveWang` -- NOT all 4 of
 * W/N/NW/NE, despite an earlier draft of this design (see #388's own
 * design-pass comment) arguing the NW/NE diagonal checks were required
 * to avoid silently accepting an invalid diagonal. That argument was
 * WRONG, and worth documenting precisely so it doesn't get "corrected"
 * back in later: for any already-placed diagonal neighbor D of the cell
 * being placed, D is only reachable via a chain of already-placed W/N
 * relationships (D sits in an earlier row or the same row to the west),
 * and every one of THOSE relationships was itself already fully checked
 * (both corner pairs) when D and its own neighbors were placed. By
 * induction, the W/N checks alone already force every already-placed
 * pair of tiles -- orthogonal OR diagonal -- into full corner agreement;
 * checking NW/NE again is pure redundant work, never a correctness
 * difference. Verified two ways before relying on this: a hand
 * transitivity proof, and a 2000-trial randomized comparison between a
 * W/N-only solver and a W/N/NW/NE one across small tile sets/grids --
 * zero disagreements.
 */
export async function* solveCornerTiles(
  tileSet: CornerTileSet,
  width: number,
  height: number,
  options: { trackSteps?: boolean } = {},
): AsyncGenerator<CornerSolveStep, CornerGrid | null> {
  const trackSteps = options.trackSteps ?? true;
  const tiles = tileSet.tiles;
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const grid: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null));

  function candidatesAt(row: number, col: number): CornerTile[] {
    return tiles.filter((t) => {
      if (col > 0) {
        const w = grid[row]![col - 1];
        if (w !== null && !cornerTilesCompatible(t, byId.get(w)!, "W")) return false;
      }
      if (row > 0) {
        const n = grid[row - 1]![col];
        if (n !== null && !cornerTilesCompatible(t, byId.get(n)!, "N")) return false;
      }
      return true;
    });
  }

  function snapshot(): (string | null)[][] | null {
    return trackSteps ? grid.map((r) => [...r]) : null;
  }

  async function* backtrack(index: number): AsyncGenerator<CornerSolveStep, boolean> {
    if (index === width * height) return true;
    const row = Math.floor(index / width);
    const col = index % width;
    for (const tile of candidatesAt(row, col)) {
      grid[row]![col] = tile.id;
      yield { grid: snapshot(), row, col, contradiction: false };
      if (yield* backtrack(index + 1)) return true;
    }
    grid[row]![col] = null;
    yield { grid: snapshot(), row, col, contradiction: true };
    return false;
  }

  const solved = yield* backtrack(0);
  return solved ? (grid as CornerGrid) : null;
}
