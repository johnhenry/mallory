/**
 * Patch census (subshift language growth) for a solved tiling -- issue
 * #396, split from #92's own "Analysis" section item 5. Counts how many
 * DISTINCT patchHeight x patchWidth patches actually occur in a solved
 * grid, as a function of patch size -- the subshift's own finite-size
 * "language," the data entropy (entropy.ts) is itself derived from as a
 * growth-rate limit. Built on `Tensor.unfold` (@johnhenry/math-plus-tensor-core), whose
 * own doc comment names this exact use case ("issue #84, upstream for the
 * generalized Wang tile laboratory's patch census / subshift-language
 * machinery").
 *
 * Square lattice only, matching every other analysis feature (entropy,
 * diffraction) in this lab.
 */
import { Tensor } from "@johnhenry/math-plus-tensor-core";
import type { WangGrid } from "./tile-model.ts";

export interface PatchCensusResult {
  /** One entry per distinct patch pattern, in first-seen order (raster order over the unfolded grid). */
  patches: Array<{ pattern: string; count: number }>;
  /** How many (patchHeight, patchWidth)-sized windows exist in the grid total -- sum of every `count` above. */
  totalWindows: number;
}

/** Encodes a grid's tile ids as a numeric Tensor (`Tensor.unfold` needs numeric data) -- one integer per distinct id, in first-seen order. Returns the tensor plus the index-to-id lookup. */
function encodeGridAsTensor(grid: WangGrid): { tensor: Tensor; idByIndex: string[] } {
  const height = grid.length;
  const width = height > 0 ? grid[0]!.length : 0;
  const idByIndex: string[] = [];
  const indexById = new Map<string, number>();
  const data: number[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const id = grid[row]![col]!;
      let index = indexById.get(id);
      if (index === undefined) {
        index = idByIndex.length;
        indexById.set(id, index);
        idByIndex.push(id);
      }
      data.push(index);
    }
  }
  return { tensor: Tensor.from(data, { dtype: "f64" }).reshape([height, width]), idByIndex };
}

/**
 * Counts every distinct `patchHeight`x`patchWidth` patch that occurs in
 * `grid`, via `Tensor.unfold`. `grid` must be at least `patchHeight` rows
 * and `patchWidth` columns (otherwise there are zero window positions --
 * throws, since a caller asking for a patch size bigger than the grid is
 * almost certainly a mistake, not a meaningful "zero patches" answer).
 */
export function patchCensus(grid: WangGrid, patchHeight: number, patchWidth: number): PatchCensusResult {
  if (!Number.isInteger(patchHeight) || !Number.isInteger(patchWidth) || patchHeight < 1 || patchWidth < 1) {
    throw new Error("patchHeight and patchWidth must be positive integers.");
  }
  const height = grid.length;
  const width = height > 0 ? grid[0]!.length : 0;
  if (patchHeight > height || patchWidth > width) {
    throw new Error(`Patch size ${patchHeight}x${patchWidth} is larger than the grid (${height}x${width}).`);
  }
  const { tensor, idByIndex } = encodeGridAsTensor(grid);
  const windows = tensor.unfold([patchHeight, patchWidth]); // shape: [outH, outW, patchHeight, patchWidth]
  const [outH, outW] = windows.shape as [number, number, number, number];

  const countByPattern = new Map<string, number>();
  const order: string[] = [];
  for (let wr = 0; wr < outH; wr++) {
    for (let wc = 0; wc < outW; wc++) {
      const cells: string[] = [];
      for (let pr = 0; pr < patchHeight; pr++) {
        for (let pc = 0; pc < patchWidth; pc++) {
          cells.push(idByIndex[Number(windows.at(wr, wc, pr, pc))]!);
        }
      }
      const pattern = cells.join(",");
      if (!countByPattern.has(pattern)) order.push(pattern);
      countByPattern.set(pattern, (countByPattern.get(pattern) ?? 0) + 1);
    }
  }

  return {
    patches: order.map((pattern) => ({ pattern, count: countByPattern.get(pattern)! })),
    totalWindows: outH * outW,
  };
}

/**
 * The census's own "language growth" reading: distinct-pattern count as a
 * function of patch size, from `1x1` up to `maxSize`x`maxSize` (or the
 * grid's own smaller dimension, whichever is less). NOT guaranteed
 * monotonic, even on a fixed finite grid -- e.g. a 2x2 grid tiled as a
 * checkerboard (A/B, B/A) has 2 distinct 1x1 patches but only 1 distinct
 * 2x2 patch (there's only one window position once the patch size reaches
 * the grid's own size). The number of available WINDOW POSITIONS
 * (`(height-size+1)*(width-size+1)`) shrinks as size grows, which caps how
 * many distinct patterns can possibly appear regardless of how "rich" the
 * tiling is -- true subshift language-growth asymptotics are about large
 * patches on an effectively-infinite tiling, which a small finite grid can
 * only approximate loosely. Useful as a diagnostic even so (a language
 * that saturates quickly at a low count, well before hitting the grid's
 * own size cap, is a genuine low-complexity signal); just don't read a dip
 * near the grid's own size as a bug.
 */
export function patchCensusGrowth(grid: WangGrid, maxSize: number): Array<{ size: number; distinctPatches: number }> {
  const height = grid.length;
  const width = height > 0 ? grid[0]!.length : 0;
  const cap = Math.min(maxSize, height, width);
  const growth: Array<{ size: number; distinctPatches: number }> = [];
  for (let size = 1; size <= cap; size++) {
    growth.push({ size, distinctPatches: patchCensus(grid, size, size).patches.length });
  }
  return growth;
}
