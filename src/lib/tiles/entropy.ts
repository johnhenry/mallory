/**
 * Entropy via the transfer-matrix method (issue #92, M2 slice 2 of 2): for
 * a strip of height `h`, the "states" are the valid vertical columns (h
 * tiles, top to bottom, each internally N/S-compatible with its neighbor),
 * and the transfer relation is "column A can sit immediately west of column
 * B" (every row's east/west edges match). The dominant eigenvalue of that
 * transition relation is, by the standard subshift-of-finite-type theory
 * (Lind-Marcus), exactly `exp(entropy_of_the_height-h_strip)` -- so
 * `log(dominantEigenvalue) / h` is the strip's per-cell entropy, and the
 * sequence of these values as `h` grows converges (from above) to the true
 * 2D entropy of the tile set's subshift. Height 1 is exactly the existing
 * `buildCompatibilityDigraph("E")` relation from tile-model.ts.
 *
 * The transition relation is typically sparse (most column pairs conflict
 * somewhere), so this never materializes a dense transition matrix -- it
 * builds a column adjacency LIST once, then hands mallory-adapter-math's
 * matrix-free `linalg.powerIteration` a `matvec` closure over that list,
 * per the issue's own "small: eigGeneral; large: matrix-free power
 * iteration" split (this always takes the matrix-free path, since it's
 * strictly more general and the adjacency-list matvec costs no more than
 * a dense one would at the small-tile-set scale this lab targets).
 */
import { linalg } from "mallory-adapter-math";
import { tilesCompatible, type Tile, type TileSet } from "./tile-model.ts";

export interface StripEntropyResult {
  /** Per-cell entropy of the height-`h` strip: `log(dominantEigenvalue) / h`. */
  entropy: number;
  /** The transfer matrix's dominant (Perron) eigenvalue. */
  dominantEigenvalue: number;
  /** Number of valid height-`h` columns found -- the transfer matrix's dimension. */
  numColumns: number;
  /** Power-iteration diagnostics, surfaced for the analysis view / debugging non-convergence. */
  iterations: number;
  converged: boolean;
}

/**
 * Every valid height-`h` column: sequences of `h` tiles (top to bottom)
 * where consecutive tiles are N/S-compatible. Brute-force product filtered
 * as it's built (prunes early rather than generating `numTiles^h` and
 * filtering after) -- fine at this lab's scale (small tile sets, small
 * strip heights); this is a research/demo tool, not a solver expected to
 * scale to Berger-sized tile sets.
 */
export function buildValidColumns(tileSet: TileSet, height: number): Tile[][] {
  if (height < 1) throw new RangeError(`buildValidColumns: height must be >= 1, got ${height}`);
  let columns: Tile[][] = tileSet.tiles.map((t) => [t]);
  for (let row = 1; row < height; row++) {
    const next: Tile[][] = [];
    for (const column of columns) {
      const above = column[row - 1] as Tile;
      for (const candidate of tileSet.tiles) {
        if (tilesCompatible(above, candidate, "S")) next.push([...column, candidate]);
      }
    }
    columns = next;
  }
  return columns;
}

/** True when every row of `a` is E/W-compatible with the same row of `b` (`b` may sit immediately east of `a`). */
function columnsCompatible(a: readonly Tile[], b: readonly Tile[]): boolean {
  for (let row = 0; row < a.length; row++) {
    if (!tilesCompatible(a[row] as Tile, b[row] as Tile, "E")) return false;
  }
  return true;
}

/**
 * Strip entropy for `tileSet` at strip height `height`, via power iteration
 * on the (adjacency-list, matrix-free) column transition relation. Throws
 * if there are no valid height-`height` columns at all (the strip -- and
 * therefore any tiling containing it -- is impossible; entropy is
 * undefined, not 0, for an empty state space).
 */
export function stripEntropy(
  tileSet: TileSet,
  height: number,
  options: { maxIterations?: number; tolerance?: number } = {},
): StripEntropyResult {
  const columns = buildValidColumns(tileSet, height);
  const numColumns = columns.length;
  if (numColumns === 0) {
    throw new Error(`stripEntropy: tile set admits no valid height-${height} column -- entropy is undefined.`);
  }

  const adjacency: number[][] = columns.map((a) => {
    const successors: number[] = [];
    for (let j = 0; j < columns.length; j++) {
      if (columnsCompatible(a, columns[j] as Tile[])) successors.push(j);
    }
    return successors;
  });

  const matvec = (v: readonly number[]): number[] => {
    const result = new Array<number>(numColumns).fill(0);
    for (let i = 0; i < numColumns; i++) {
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
    ({ eigenvalue, iterations, converged } = linalg.powerIteration(matvec, numColumns, options));
  } catch (e) {
    // powerIteration's own "zero vector" failure means the transition
    // relation is nilpotent on every vector it tried -- no cycle exists
    // among these columns, so no bi-infinite tiling extends this strip
    // (a finite tiling may still exist; only the *periodic*/infinite case
    // needs a cycle). Re-thrown with the domain-specific explanation
    // rather than a numeric entropy, since log(0) = -Infinity isn't a
    // useful chart value and would silently poison a convergence plot.
    throw new Error(
      `stripEntropy: the height-${height} transfer relation has no cycle (dominant eigenvalue is 0) -- ` +
        `this tile set admits no bi-infinite tiling at this strip height. ` +
        `(underlying: ${e instanceof Error ? e.message : String(e)})`,
    );
  }
  return {
    entropy: Math.log(eigenvalue) / height,
    dominantEigenvalue: eigenvalue,
    numColumns,
    iterations,
    converged,
  };
}
