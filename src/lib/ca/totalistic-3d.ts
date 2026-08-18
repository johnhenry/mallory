/**
 * 3D totalistic cellular automata (issue #229 M3 -- the "if possible...
 * will get trippy" tier of the original request). A 3D Moore neighborhood
 * has 26 neighbors, so 2^26 possible neighborhoods -- an elementary-CA-
 * style full lookup table is intractable at this size (unlike 1D's 8-entry
 * table). This module stays totalistic from the start: a rule depends only
 * on the COUNT of live neighbors (0-26).
 *
 * Rule notation is deliberately its OWN comma-separated format
 * (`"B6/S5,6,7"`), not life-like.ts's digit-per-count `"B36/S23"` --
 * 2D's B/S notation packs each count into a single digit because the
 * 8-neighbor Moore range never exceeds 9; 3D's 26-neighbor range needs
 * two-digit counts, which digit-concatenation can't represent unambiguously
 * (is "12" the single count twelve, or the two counts one and two?).
 */
import { Rng } from "mallory-tensor-core";

export type Cell = 0 | 1;
export type Boundary = "dead" | "wrap";
/** `grid[z][y][x]`, matching the Wang tile lab's own CubeGrid indexing convention (#92 M4). */
export type Grid3D = ReadonlyArray<ReadonlyArray<ReadonlyArray<Cell>>>;

export interface Totalistic3DRule {
  birth: ReadonlySet<number>;
  survival: ReadonlySet<number>;
}

const MAX_NEIGHBORS_3D = 26;

/** Parses `"B<comma-separated counts>/S<comma-separated counts>"`, counts in [0, 26] -- e.g. `"B6/S5,6,7"`. Either half may be empty (no births, or no survival). */
export function parseTotalisticRule3D(text: string): Totalistic3DRule {
  const match = /^B([0-9,]*)\/S([0-9,]*)$/i.exec(text.trim());
  if (!match) {
    throw new Error(`Invalid 3D rule "${text}" -- expected "B<counts>/S<counts>" with comma-separated counts 0-${MAX_NEIGHBORS_3D}, e.g. "B6/S5,6,7".`);
  }
  const parseCounts = (segment: string): Set<number> => {
    if (segment === "") return new Set();
    return new Set(
      segment.split(",").map((token) => {
        const n = Number(token);
        if (!Number.isInteger(n) || n < 0 || n > MAX_NEIGHBORS_3D) {
          throw new Error(`Invalid neighbor count "${token}" in "${text}" -- must be an integer 0-${MAX_NEIGHBORS_3D}.`);
        }
        return n;
      }),
    );
  };
  return { birth: parseCounts(match[1]!), survival: parseCounts(match[2]!) };
}

export function totalisticRule3DToString(rule: Totalistic3DRule): string {
  const b = [...rule.birth].sort((a, c) => a - c).join(",");
  const s = [...rule.survival].sort((a, c) => a - c).join(",");
  return `B${b}/S${s}`;
}

/**
 * Flips whether `count` live neighbors triggers birth, returning the
 * resulting rule -- issue #260 item 3's minimal 3D extension of the
 * birth/survival checkbox picker (item 2), reusing the same
 * toggle-a-Set-membership shape as life-like.ts's own `toggleBirth`, just
 * over 3D's wider 0-26 neighbor range instead of 2D's 0-8.
 */
export function toggleBirth3D(rule: Totalistic3DRule, count: number): Totalistic3DRule {
  const birth = new Set(rule.birth);
  if (birth.has(count)) birth.delete(count);
  else birth.add(count);
  return { birth, survival: rule.survival };
}

/** Flips whether `count` live neighbors lets a live cell survive, returning the resulting rule -- the "survival" checkbox counterpart of `toggleBirth3D`. */
export function toggleSurvival3D(rule: Totalistic3DRule, count: number): Totalistic3DRule {
  const survival = new Set(rule.survival);
  if (survival.has(count)) survival.delete(count);
  else survival.add(count);
  return { birth: rule.birth, survival };
}

const NEIGHBOR_OFFSETS_3D: readonly (readonly [number, number, number])[] = (() => {
  const offsets: [number, number, number][] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        offsets.push([dx, dy, dz]);
      }
    }
  }
  return offsets;
})();

function countLiveNeighbors3D(grid: Grid3D, x: number, y: number, z: number, boundary: Boundary): number {
  const depth = grid.length;
  const height = grid[0]!.length;
  const width = grid[0]![0]!.length;
  let count = 0;
  for (const [dx, dy, dz] of NEIGHBOR_OFFSETS_3D) {
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;
    if (boundary === "wrap") {
      nx = ((nx % width) + width) % width;
      ny = ((ny % height) + height) % height;
      nz = ((nz % depth) + depth) % depth;
    } else if (nx < 0 || nx >= width || ny < 0 || ny >= height || nz < 0 || nz >= depth) {
      continue;
    }
    count += grid[nz]![ny]![nx]!;
  }
  return count;
}

/** Advances `grid` one generation under `rule`. */
export function stepTotalistic3D(grid: Grid3D, rule: Totalistic3DRule, boundary: Boundary = "dead"): Cell[][][] {
  const depth = grid.length;
  const height = grid[0]!.length;
  const width = grid[0]![0]!.length;
  const next: Cell[][][] = Array.from({ length: depth }, () => Array.from({ length: height }, () => new Array<Cell>(width)));
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const liveNeighbors = countLiveNeighbors3D(grid, x, y, z, boundary);
        const alive = grid[z]![y]![x] === 1;
        next[z]![y]![x] = (alive ? rule.survival.has(liveNeighbors) : rule.birth.has(liveNeighbors)) ? 1 : 0;
      }
    }
  }
  return next;
}

/** Each cell independently alive with probability `density`, via `rng`. */
export function randomGrid3D(width: number, height: number, depth: number, rng: Rng, density = 0.2): Cell[][][] {
  return Array.from({ length: depth }, () =>
    Array.from({ length: height }, () => Array.from({ length: width }, () => (rng.nextFloat() < density ? 1 : 0))),
  );
}

export type Spacetime3D = ReadonlyArray<Grid3D>;

/**
 * `generations` 3D grids (index 0 = initial condition) -- issue #229's own
 * "a 3D rule's history is naturally a 4D hypervolume" framing. Unlike the
 * 1D/2D cases, this can't be rendered as a single static image or even a
 * one-shot voxel volume (that would need a 4th spatial axis); the intended
 * consumer scrubs through the returned array as a time axis instead,
 * animating a 3D voxel scene one frame at a time -- deferred to its own
 * panel-wiring follow-up (M3's panel half), matching M1/M2's own "core
 * machinery first" ordering.
 */
export function spacetimeTotalistic3D(initial: Grid3D, rule: Totalistic3DRule, generations: number, boundary: Boundary = "dead"): Spacetime3D {
  if (!Number.isInteger(generations) || generations < 1) throw new Error("generations must be a positive integer.");
  const frames: Grid3D[] = [initial];
  for (let g = 1; g < generations; g++) frames.push(stepTotalistic3D(frames[g - 1]!, rule, boundary));
  return frames;
}

export interface NamedTotalistic3DRule {
  rule: string;
  name: string;
  description: string;
}

/**
 * A small curated set of known-interesting 3D totalistic rules, sourced
 * from the Softology/Visions of Chaos and Larry Faucette 3D CA catalogs
 * (issue #229's own annotated references), translated into this module's
 * own comma-separated B/S notation.
 */
export const NAMED_TOTALISTIC_3D_RULES: readonly NamedTotalistic3DRule[] = [
  { rule: "B6/S5,6,7", name: "Pyroclastic-like (6,5-7)", description: "Grows dense, fire-like blob structures -- a 3D analogue of Diamoeba's amoeba-like growth." },
  { rule: "B4/S6,7,8", name: "Crystal growth (4,6-8)", description: "Sparse birth, wide survival -- forms slow-growing crystalline lattices from a small seed." },
  { rule: "B5,6,7,8/S4,5,6,7,8", name: "Dense stabilizer", description: "Wide birth and survival bands -- large random seeds quickly settle into stable dense clusters." },
];
