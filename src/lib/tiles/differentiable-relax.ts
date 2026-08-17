/**
 * Differentiable-relaxation Wang tiling (issue #92 M5, "Experiment
 * track"): a softmax tile-assignment distribution per cell, a
 * differentiable expected-mismatch energy summed over grid edges,
 * minimized with the existing autograd `Variable` + `optim.Adam` -- the
 * deepest composition of the family's ML stack this lab reaches, and per
 * the issue's own framing a genuinely open question whether it finds
 * valid tilings faster than backtracking on hard sets. Square-lattice
 * only, matching every other milestone's own "square is the always-
 * available fixture" precedent -- hex/tri/cube stay backtracking-only.
 *
 * Energy construction: for every horizontal (E) and vertical (S) edge
 * between adjacent cells i and j, `P_i @ M_d @ P_j^T` is the expected
 * mismatch mass under the two cells' independent tile distributions,
 * where `M_d[t1,t2] = 1` iff tiles `t1`/`t2` are INCOMPATIBLE in
 * direction `d` (0 otherwise). Only E/S edges are summed -- not N/W too --
 * because every edge is already covered once from its earlier cell's own
 * E or S neighbor in row-major order, matching this lab's own repeatedly-
 * applied "compatible(a,b,d) and compatible(b,a,opposite(d)) are the same
 * equation" symmetric-relation fact (checking a strict subset of
 * directions is already exhaustive). `Variable.matmul` requires 2-D
 * operands, so each cell's `P_i` (`[1, numTiles]`) is extracted from the
 * shared `[numCells, numTiles]` softmax output via `matmul` against a
 * constant one-hot row-selector -- there's no direct row-indexing op on
 * `Variable`, but a constant selector matmul is differentiable through
 * the tracked side for free.
 */
import { optim, variable, constant, type Variable } from "mallory-tensor-autograd";
import { random, Tensor } from "mallory-tensor-core";
import { tilesCompatible, type Direction, type Tile, type TileSet, type WangGrid } from "./tile-model.ts";

export interface RelaxOptions {
  /** Optimization steps to run. Default 300. */
  steps?: number;
  /** Adam learning rate. Default 0.3. */
  lr?: number;
  /** Seeds the initial logits for deterministic output (tests, replay). Omit for a fresh random init each call. */
  seed?: number;
}

export interface RelaxResult {
  /** The argmax tile id per cell after optimization -- a "best guess" grid that may still contain mismatches (see `valid`), not a guaranteed-correct tiling the way `solveWang`'s result is. */
  grid: WangGrid;
  /** Energy (expected mismatch mass) at the END of every step, for a convergence chart. Monotonically-decreasing is NOT guaranteed (Adam, not plain gradient descent). */
  energyHistory: number[];
  /** True iff `grid` is a genuinely valid tiling: recomputed from scratch via `tilesCompatible` over every adjacent pair, independent of the energy term the optimizer minimized (a discrete argmax can still land on a mismatch even at low energy). */
  valid: boolean;
}

function buildMismatchMatrix(tiles: readonly Tile[], direction: Direction): Tensor {
  const n = tiles.length;
  const flat = new Array<number>(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      flat[i * n + j] = tilesCompatible(tiles[i]!, tiles[j]!, direction) ? 0 : 1;
    }
  }
  return Tensor.from(flat, { dtype: "f64" }).reshape([n, n]);
}

function oneHotRow(index: number, total: number): Tensor {
  const flat = new Array<number>(total).fill(0);
  flat[index] = 1;
  return Tensor.from(flat, { dtype: "f64" }).reshape([1, total]);
}

/**
 * Runs the relaxation and returns the final discrete grid, the energy
 * trajectory, and whether that grid is actually valid. Synchronous (unlike
 * `solveWang`'s pausable async generator): a fixed `steps`-iteration Adam
 * loop over a small dense tensor graph is fast enough not to need
 * streaming, and there's no natural "one step = one placement" animation
 * unit the way backtracking has -- every cell's distribution updates every
 * step.
 */
export function relaxWangTiling(tileSet: TileSet, width: number, height: number, options: RelaxOptions = {}): RelaxResult {
  const { steps = 300, lr = 0.3, seed } = options;
  if (!Number.isInteger(width) || width < 1) throw new Error("width must be a positive integer.");
  if (!Number.isInteger(height) || height < 1) throw new Error("height must be a positive integer.");
  if (!Number.isInteger(steps) || steps < 1) throw new Error("steps must be a positive integer.");
  if (!Number.isFinite(lr) || lr <= 0) throw new Error("lr must be a positive number.");

  const tiles = tileSet.tiles;
  const numTiles = tiles.length;
  if (numTiles === 0) throw new Error("Tile set is empty.");
  const numCells = width * height;
  const cellIndex = (row: number, col: number): number => row * width + col;

  const rng = seed !== undefined ? random.seed(seed) : undefined;
  const logits = variable(random.normal([numCells, numTiles], { std: 0.1, dtype: "f64", rng }));
  const optimizer = new optim.Adam([logits], { lr });

  const mismatchE = constant(buildMismatchMatrix(tiles, "E"));
  const mismatchS = constant(buildMismatchMatrix(tiles, "S"));
  const selectors = Array.from({ length: numCells }, (_, i) => constant(oneHotRow(i, numCells)));

  const energyHistory: number[] = [];
  for (let step = 0; step < steps; step++) {
    optimizer.zeroGrad();
    const p = logits.softmax(-1); // [numCells, numTiles]
    let energy: Variable | null = null;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const pi = selectors[cellIndex(row, col)]!.matmul(p); // [1, numTiles]
        if (col + 1 < width) {
          const pj = selectors[cellIndex(row, col + 1)]!.matmul(p);
          const term = pi.matmul(mismatchE).mul(pj).sum();
          energy = energy ? energy.add(term) : term;
        }
        if (row + 1 < height) {
          const pj = selectors[cellIndex(row + 1, col)]!.matmul(p);
          const term = pi.matmul(mismatchS).mul(pj).sum();
          energy = energy ? energy.add(term) : term;
        }
      }
    }
    if (!energy) {
      // A 1x1 grid has no edges at all -- nothing to minimize.
      energyHistory.push(0);
      continue;
    }
    energy.backward();
    optimizer.step();
    energyHistory.push(energy.value.item() as number);
  }

  const finalP = logits.softmax(-1);
  const argmaxIds = finalP.value.argmax(1).toArray() as number[];
  const grid: string[][] = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => tiles[argmaxIds[cellIndex(row, col)]!]!.id),
  );

  const byId = new Map(tiles.map((t) => [t.id, t]));
  let valid = true;
  for (let row = 0; row < height && valid; row++) {
    for (let col = 0; col < width && valid; col++) {
      const a = byId.get(grid[row]![col]!)!;
      if (col + 1 < width && !tilesCompatible(a, byId.get(grid[row]![col + 1]!)!, "E")) valid = false;
      if (row + 1 < height && !tilesCompatible(a, byId.get(grid[row + 1]![col]!)!, "S")) valid = false;
    }
  }

  return { grid: grid as WangGrid, energyHistory, valid };
}
