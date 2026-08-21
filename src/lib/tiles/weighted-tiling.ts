/**
 * Weighted random tiling (issue #398, split from #92's own "Alphabet" axis:
 * "weighted/probabilistic variants later"). Of the 3 candidate framings
 * #398 itself lists (weighted random tiling, weighted edge-color
 * matching, a weighted entropy/diffraction reading), this implements the
 * first -- the concrete, buildable one, and the one with the clearest
 * precedent (Gumin's WaveFunctionCollapse, and its min-entropy heuristic,
 * are exactly this idea -- see #92's own citation).
 *
 * Deliberately does NOT change the matching rule (still strict edge-label
 * equality) or the backtracking algorithm's own completeness -- only which
 * ORDER compatible candidates are tried in at each cell. `solveWang`
 * already tries candidates in a fixed order (tile-array order); this
 * tries them in a WEIGHTED-RANDOM order instead, so the first successful
 * full solve found reflects tile weights (a tile weighted 10x another is
 * roughly 10x as likely to appear where both are legal), while backtracking
 * still guarantees the search is exhaustive over the exact same candidate
 * SET -- if a solution exists, this finds one, same as `solveWang`.
 */
import { Rng } from "mallory-tensor-core";
import { tilesCompatible, type SolveStep, type Tile, type TileSet, type WangGrid } from "./tile-model.ts";

/** Tile id -> non-negative weight. Missing ids default to weight 1 (uniform); a 0 weight never gets picked while any positive-weight candidate remains. */
export type TileWeights = ReadonlyMap<string, number>;

/**
 * A weighted-random permutation of `tiles` (weighted reservoir-free
 * sampling without replacement): repeatedly picks one remaining tile with
 * probability proportional to its weight, removes it, and repeats. If
 * every remaining tile has weight 0 (or `weights` is empty and some
 * override set every relevant weight to 0), the rest are appended in
 * their original order -- there's no more randomness to meaningfully
 * apply, and returning nothing would silently drop candidates.
 */
export function weightedShuffle(tiles: readonly Tile[], weights: TileWeights, rng: Rng): Tile[] {
  const pool = tiles.map((t) => ({ tile: t, weight: Math.max(0, weights.get(t.id) ?? 1) }));
  const result: Tile[] = [];
  while (pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    if (total <= 0) {
      for (const p of pool) result.push(p.tile);
      break;
    }
    let r = rng.nextFloat() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i]!.weight;
      if (r <= 0) {
        index = i;
        break;
      }
    }
    result.push(pool[index]!.tile);
    pool.splice(index, 1);
  }
  return result;
}

/**
 * `solveWang`'s own row-major backtracking, with one difference: at each
 * cell, compatible candidates are tried in a weighted-random order
 * ({@link weightedShuffle}) instead of tile-array order. Same
 * `SolveStep`/`trackSteps` shape, same completeness guarantee -- `rng` is
 * a required, explicit parameter (not seeded internally) so callers get
 * reproducible results for a given seed, matching this codebase's own
 * `Rng`-as-explicit-argument convention (`life-like.ts`'s `randomGrid`,
 * `totalistic-3d.ts`'s `randomGrid3D`, etc.).
 */
export async function* solveWangWeighted(
  tileSet: TileSet,
  width: number,
  height: number,
  weights: TileWeights,
  rng: Rng,
  options: { trackSteps?: boolean } = {},
): AsyncGenerator<SolveStep, WangGrid | null> {
  const trackSteps = options.trackSteps ?? true;
  const tiles = tileSet.tiles;
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const grid: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null));

  function candidatesAt(row: number, col: number): Tile[] {
    const compatible = tiles.filter((t) => {
      if (col > 0) {
        const westId = grid[row]![col - 1];
        if (westId !== null && !tilesCompatible(byId.get(westId)!, t, "E")) return false;
      }
      if (row > 0) {
        const northId = grid[row - 1]![col];
        if (northId !== null && !tilesCompatible(byId.get(northId)!, t, "S")) return false;
      }
      return true;
    });
    return weightedShuffle(compatible, weights, rng);
  }

  function snapshot(): (string | null)[][] | null {
    return trackSteps ? grid.map((r) => [...r]) : null;
  }

  async function* backtrack(index: number): AsyncGenerator<SolveStep, boolean> {
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
  return solved ? (grid as WangGrid) : null;
}
