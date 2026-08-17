/**
 * 3D Wang cubes (issue #92 M4). A `CubeTile` has one face label per one of
 * the 6 cube directions (N/S/E/W up/down, i.e. the 3 axis pairs), matching
 * this lab's own "core machinery first" precedent for every prior lattice
 * (square/hex/tri) -- a separate module, not a generalization of any of
 * them, since a cube's 6-face adjacency is a genuinely different
 * constraint structure from a 2D lattice's edges.
 */
export type CubeDirection = "N" | "S" | "E" | "W" | "U" | "D";

export interface CubeTile {
  id: string;
  faces: Record<CubeDirection, string>;
}

export interface CubeTileSet {
  tiles: CubeTile[];
}

const OPPOSITE_CUBE_DIRECTION: Record<CubeDirection, CubeDirection> = { N: "S", S: "N", E: "W", W: "E", U: "D", D: "U" };

/** True when `a` and `b` can sit adjacent with `b` in direction `d` from `a` -- same edge/face-matching rule as every other lattice in this lab. */
export function cubeTilesCompatible(a: CubeTile, b: CubeTile, d: CubeDirection): boolean {
  return a.faces[d] === b.faces[OPPOSITE_CUBE_DIRECTION[d]];
}

/** Per-direction compatibility digraph, mirroring tile-model.ts's `buildCompatibilityDigraph` for the cube case. */
export function buildCubeCompatibilityDigraph(tiles: readonly CubeTile[], d: CubeDirection): Map<string, Set<string>> {
  const digraph = new Map<string, Set<string>>();
  for (const a of tiles) {
    const compatible = new Set<string>();
    for (const b of tiles) {
      if (cubeTilesCompatible(a, b, d)) compatible.add(b.id);
    }
    digraph.set(a.id, compatible);
  }
  return digraph;
}

function cubeNeighborCoords(x: number, y: number, z: number, d: CubeDirection): readonly [number, number, number] {
  switch (d) {
    case "E":
      return [x + 1, y, z];
    case "W":
      return [x - 1, y, z];
    case "S":
      return [x, y + 1, z];
    case "N":
      return [x, y - 1, z];
    case "U":
      return [x, y, z + 1];
    case "D":
      return [x, y, z - 1];
  }
}

/** `grid[z][y][x]` -- a `width x height x depth` box of placed cube tile ids. */
export type CubeGrid = ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>;

export interface CubeSolveStep {
  /**
   * The grid so far, `[z][y][x]`, `null` for not-yet-decided cells -- or
   * `null` itself when `options.trackSteps` is `false` (see `solveCube`'s
   * own doc comment), skipping the O(width * height * depth) clone a
   * caller that only wants the final grid would otherwise pay on every
   * placement AND every backtrack for nothing.
   */
  grid: ReadonlyArray<ReadonlyArray<ReadonlyArray<string | null>>> | null;
  x: number;
  y: number;
  z: number;
  contradiction: boolean;
}

/**
 * Every direction whose neighbor is ALREADY placed when filling `(x, y,
 * z)` cells in raster order (`z` outermost, then `y`, then `x`
 * innermost): W (`x-1,y,z`, same layer+row, earlier x), N (`x,y-1,z`,
 * same layer, earlier row), and D (`x,y,z-1`, an earlier layer entirely)
 * -- the direct 3D generalization of the square lattice's own "west/north"
 * pair (2D's 2 already-placed directions out of 4 -> 3D's 3 out of 6, the
 * same "half the directions, the ones toward the origin" pattern).
 */
const ALREADY_PLACED_CUBE_DIRECTIONS: readonly CubeDirection[] = ["W", "N", "D"];

/**
 * Fills a `width x height x depth` box with tiles from `tileSet` under
 * cube face-matching, via plain backtracking -- the 3D counterpart to
 * `solveWang`/`solveHex`/`solveTri`. Same "core solver only" scoping:
 * async generator yielding a `CubeSolveStep` after every placement and
 * every backtrack, no torus/SAT variants yet.
 *
 * `options.trackSteps` (default `true`), same escape hatch as `solveHex`'s/
 * `solveTri`'s own: `TilesPanel` drains this straight to the final grid and
 * discards every intermediate step (no step-by-step animation for cube),
 * so it passes `trackSteps: false` to skip the O(width * height * depth)
 * clone on every step -- otherwise a hard-to-satisfy tile set needing many
 * backtracks pays that 3D-grid-copy cost for a value nobody reads.
 */
export async function* solveCube(
  tileSet: CubeTileSet,
  width: number,
  height: number,
  depth: number,
  options: { trackSteps?: boolean } = {},
): AsyncGenerator<CubeSolveStep, CubeGrid | null> {
  const trackSteps = options.trackSteps ?? true;
  const tiles = tileSet.tiles;
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const grid: (string | null)[][][] = Array.from({ length: depth }, () =>
    Array.from({ length: height }, () => Array<string | null>(width).fill(null)),
  );

  function candidatesAt(x: number, y: number, z: number): CubeTile[] {
    return tiles.filter((t) => {
      for (const d of ALREADY_PLACED_CUBE_DIRECTIONS) {
        const [nx, ny, nz] = cubeNeighborCoords(x, y, z, d);
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || nz < 0 || nz >= depth) continue;
        const neighborId = grid[nz]![ny]![nx];
        if (neighborId !== null && !cubeTilesCompatible(t, byId.get(neighborId)!, d)) return false;
      }
      return true;
    });
  }

  function snapshot(): (string | null)[][][] | null {
    return trackSteps ? grid.map((layer) => layer.map((row) => [...row])) : null;
  }

  async function* backtrack(index: number): AsyncGenerator<CubeSolveStep, boolean> {
    const total = width * height * depth;
    if (index === total) return true;
    const z = Math.floor(index / (width * height));
    const rem = index % (width * height);
    const y = Math.floor(rem / width);
    const x = rem % width;
    for (const tile of candidatesAt(x, y, z)) {
      grid[z]![y]![x] = tile.id;
      yield { grid: snapshot(), x, y, z, contradiction: false };
      if (yield* backtrack(index + 1)) return true;
    }
    grid[z]![y]![x] = null;
    yield { grid: snapshot(), x, y, z, contradiction: true };
    return false;
  }

  const solved = yield* backtrack(0);
  return solved ? (grid as CubeGrid) : null;
}
