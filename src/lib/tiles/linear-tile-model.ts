/**
 * 1D ("linear") Wang tiles (issue #397, split from #92's own "Dimension"
 * axis -- the "1D (bi-infinite words)" half of that axis; the 3D half
 * shipped as `cube-tile-model.ts` for #92 M4). A `LinearTile` is a labeled
 * domino/segment with only 2 edges (`left`/`right`), placed in a single row
 * under the same "touching labels must match" rule the square/hex/tri/cube
 * lattices use on each of their own axes.
 *
 * Deliberately a SEPARATE module from tile-model.ts and every other lattice
 * module, not a generalization of any of them -- matching this lab's own
 * "lattice descriptor" framing (each lattice is its own constraint
 * structure, not a parameterization of one shared structure). Only the CORE
 * solver ships here (mirroring solveWang's/solveHex's own simplest-
 * correct-form precedent): tile editing + solving + rendering only, no
 * symmetry/diffraction, no step-by-step animation (see `LinearSolveStep`'s
 * own doc comment on why the step shape still exists despite that).
 */
import { linalg } from "mallory-adapter-math";

export interface LinearTile {
  id: string;
  left: string;
  right: string;
}

export interface LinearTileSet {
  tiles: readonly LinearTile[];
}

/** A single filled row: an array of tile ids, left to right. */
export type LinearGrid = readonly string[];

/**
 * Kept for API parity with the other lattices' step shape (`HexSolveStep`,
 * `TriSolveStep`, `CubeSolveStep`) even though `TilesPanel` drains this
 * solver straight to its final grid and never animates it step by step
 * (matching hex/tri/corner's own scope-down -- see those modules' own doc
 * comments) -- `grid` is `null` whenever `options.trackSteps` is `false`,
 * for the same "skip an O(length) clone nobody reads" reason those other
 * step types do.
 */
export interface LinearSolveStep {
  grid: (string | null)[] | null;
  index: number;
  contradiction: boolean;
}

/** True when `b` may sit immediately to the right of `a` -- `a`'s right label matches `b`'s left label. */
export function linearTilesCompatible(a: LinearTile, b: LinearTile): boolean {
  return a.right === b.left;
}

function snapshot(row: (string | null)[], trackSteps: boolean): (string | null)[] | null {
  return trackSteps ? [...row] : null;
}

/**
 * Fills a length-`length` row with tiles from `tileSet` via plain
 * backtracking, checking each new tile only against its already-placed left
 * neighbor -- the 1D counterpart to `solveWang`'s "only check already-
 * placed neighbors" shape, simpler here since a row has only ever one
 * neighbor-direction (left) already decided when filling left to right.
 *
 * An async generator for the same "streamed so long searches stay
 * pausable" reasoning as `solveWang`/`solveHex`; yields a `LinearSolveStep`
 * after every placement and every backtrack. `options.trackSteps` (default
 * `true`) controls whether each step carries a full-row snapshot -- see
 * `LinearSolveStep`'s own doc comment.
 */
export async function* solveLinear(
  tileSet: LinearTileSet,
  length: number,
  options: { trackSteps?: boolean } = {},
): AsyncGenerator<LinearSolveStep, LinearGrid | null> {
  if (length < 1) throw new RangeError(`solveLinear: length must be >= 1, got ${length}`);
  const trackSteps = options.trackSteps ?? true;
  const tiles = tileSet.tiles;
  const row: (string | null)[] = new Array(length).fill(null);

  function candidatesAt(index: number): LinearTile[] {
    if (index === 0) return [...tiles];
    const leftId = row[index - 1] as string;
    const left = tiles.find((t) => t.id === leftId)!;
    return tiles.filter((t) => linearTilesCompatible(left, t));
  }

  async function* backtrack(index: number): AsyncGenerator<LinearSolveStep, boolean> {
    if (index === length) return true;
    for (const tile of candidatesAt(index)) {
      row[index] = tile.id;
      yield { grid: snapshot(row, trackSteps), index, contradiction: false };
      if (yield* backtrack(index + 1)) return true;
    }
    row[index] = null;
    yield { grid: snapshot(row, trackSteps), index, contradiction: true };
    return false;
  }

  const solved = yield* backtrack(0);
  return solved ? (row as LinearGrid) : null;
}

/**
 * Same backtracking as `solveLinear`, but additionally requires -- checked
 * exactly when placing the last index (`index === length - 1`) -- that the
 * just-placed tile's `right` matches the FIRST placed tile's `left`. This
 * is the 1D analogue of a torus wraparound: it makes the row close into a
 * ring, i.e. repeating it end to end forms a genuinely periodic bi-infinite
 * word (not merely a word that happens to admit SOME bi-infinite
 * continuation).
 */
export async function* solveLinearPeriodic(
  tileSet: LinearTileSet,
  length: number,
  options: { trackSteps?: boolean } = {},
): AsyncGenerator<LinearSolveStep, LinearGrid | null> {
  if (length < 1) throw new RangeError(`solveLinearPeriodic: length must be >= 1, got ${length}`);
  const trackSteps = options.trackSteps ?? true;
  const tiles = tileSet.tiles;
  const row: (string | null)[] = new Array(length).fill(null);

  function candidatesAt(index: number): LinearTile[] {
    let candidates: LinearTile[];
    if (index === 0) {
      candidates = [...tiles];
    } else {
      const leftId = row[index - 1] as string;
      const left = tiles.find((t) => t.id === leftId)!;
      candidates = tiles.filter((t) => linearTilesCompatible(left, t));
    }
    if (index === length - 1) {
      const firstId = row[0] as string;
      const first = tiles.find((t) => t.id === firstId)!;
      candidates = candidates.filter((t) => linearTilesCompatible(t, first));
    }
    return candidates;
  }

  async function* backtrack(index: number): AsyncGenerator<LinearSolveStep, boolean> {
    if (index === length) return true;
    for (const tile of candidatesAt(index)) {
      row[index] = tile.id;
      yield { grid: snapshot(row, trackSteps), index, contradiction: false };
      if (yield* backtrack(index + 1)) return true;
    }
    row[index] = null;
    yield { grid: snapshot(row, trackSteps), index, contradiction: true };
    return false;
  }

  const solved = yield* backtrack(0);
  return solved ? (row as LinearGrid) : null;
}

export interface LinearEntropyResult {
  /** Exact topological entropy of the 1D subshift this tile set defines: `log(dominantEigenvalue)`. */
  entropy: number;
  /** The tile-to-tile transfer relation's dominant (Perron) eigenvalue. */
  dominantEigenvalue: number;
  /** Number of tiles -- the transfer matrix's dimension. */
  numTiles: number;
  iterations: number;
  converged: boolean;
}

/**
 * Exact topological entropy of the 1D subshift of finite type this tile set
 * defines -- no strip-height approximation needed, unlike the square
 * lattice's `stripEntropy`. A 1D tile chain's own tile-to-tile adjacency
 * (`linearTilesCompatible`) already IS the full transfer relation: there's
 * no "column" to build first the way a 2D strip needs one per extra unit of
 * height, because a linear tile's own "row" is a single cell. By the same
 * subshift-of-finite-type theory `entropy.ts` cites (Lind-Marcus, "An
 * Introduction to Symbolic Dynamics and Coding"), the topological entropy
 * of the edge shift defined by an adjacency relation is exactly
 * `log(dominant eigenvalue of the adjacency matrix)` -- this is that
 * theorem applied to the simplest possible case (transfer matrix already
 * the tile adjacency matrix, no need to raise anything to a strip-height
 * power first). `entropy = Math.log(dominantEigenvalue)`, with no
 * `/height` division: height is conceptually 1 here, i.e. entropy per tile
 * IS the whole answer, not a per-cell rate that still needs normalizing the
 * way a taller strip's would.
 *
 * Implementation mirrors `entropy.ts`'s `stripEntropy` exactly: builds an
 * adjacency list (tile `i`'s successors are every `j` with
 * `linearTilesCompatible(tiles[i], tiles[j])`) and hands
 * `mallory-adapter-math`'s matrix-free `linalg.powerIteration` a `matvec`
 * closure over it, rather than materializing a dense matrix.
 *
 * Throws if `tileSet.tiles.length === 0` (no transfer relation at all), and
 * re-throws `powerIteration`'s "zero vector" failure with a domain-specific
 * explanation, exactly like `stripEntropy`: that failure means the
 * adjacency relation is nilpotent on every vector tried -- no cycle exists
 * among these tiles, so no bi-infinite tiling exists at all (a finite chain
 * may still exist; only the periodic/infinite case needs a cycle).
 */
export function linearEntropy(tileSet: LinearTileSet, options: { maxIterations?: number; tolerance?: number } = {}): LinearEntropyResult {
  const tiles = tileSet.tiles;
  const numTiles = tiles.length;
  if (numTiles === 0) throw new Error("linearEntropy: tile set is empty -- entropy is undefined.");

  const adjacency: number[][] = tiles.map((a) => {
    const successors: number[] = [];
    for (let j = 0; j < tiles.length; j++) {
      if (linearTilesCompatible(a, tiles[j] as LinearTile)) successors.push(j);
    }
    return successors;
  });

  const matvec = (v: readonly number[]): number[] => {
    const result = new Array<number>(numTiles).fill(0);
    for (let i = 0; i < numTiles; i++) {
      let sum = 0;
      for (const j of adjacency[i] as number[]) sum += v[j] as number;
      result[i] = sum;
    }
    return result;
  };

  let eigenvalue: number;
  let iterations: number;
  let converged: boolean;
  try {
    ({ eigenvalue, iterations, converged } = linalg.powerIteration(matvec, numTiles, options));
  } catch (e) {
    throw new Error(
      `linearEntropy: the tile-to-tile transfer relation has no cycle (dominant eigenvalue is 0) -- ` +
        `this tile set admits no bi-infinite tiling. ` +
        `(underlying: ${e instanceof Error ? e.message : String(e)})`,
    );
  }
  return {
    entropy: Math.log(eigenvalue),
    dominantEigenvalue: eigenvalue,
    numTiles,
    iterations,
    converged,
  };
}
