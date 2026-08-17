/**
 * Life-like (2D, Moore-neighborhood, binary, B/S-totalistic) cellular
 * automata (issue #229 M2). "B/S" notation (Conway's Life is `B3/S23`):
 * a dead cell with exactly one of the `birth` neighbor counts becomes
 * alive; a live cell with one of the `survival` counts stays alive;
 * everything else dies or stays dead. Standard notation from the
 * LifeWiki's own "List of Life-like cellular automata rules".
 */
import { Rng } from "mallory-tensor-core";

export type Cell = 0 | 1;
export type Boundary = "dead" | "wrap";
export type Grid = ReadonlyArray<ReadonlyArray<Cell>>;

export interface LifeLikeRule {
  birth: ReadonlySet<number>;
  survival: ReadonlySet<number>;
}

/** Parses `"B<digits>/S<digits>"` (case-insensitive, digits 0-8, either half may be empty -- e.g. `"B2/S"` for Seeds). */
export function parseBSRule(text: string): LifeLikeRule {
  const match = /^B([0-8]*)\/S([0-8]*)$/i.exec(text.trim());
  if (!match) throw new Error(`Invalid B/S rule "${text}" -- expected "B<digits>/S<digits>", e.g. "B3/S23".`);
  const birth = new Set([...match[1]!].map(Number));
  const survival = new Set([...match[2]!].map(Number));
  return { birth, survival };
}

export function bsRuleToString(rule: LifeLikeRule): string {
  const b = [...rule.birth].sort((a, c) => a - c).join("");
  const s = [...rule.survival].sort((a, c) => a - c).join("");
  return `B${b}/S${s}`;
}

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

function countLiveNeighbors(grid: Grid, row: number, col: number, boundary: Boundary): number {
  const height = grid.length;
  const width = grid[0]!.length;
  let count = 0;
  for (const [dr, dc] of NEIGHBOR_OFFSETS) {
    let nr = row + dr;
    let nc = col + dc;
    if (boundary === "wrap") {
      nr = ((nr % height) + height) % height;
      nc = ((nc % width) + width) % width;
    } else if (nr < 0 || nr >= height || nc < 0 || nc >= width) {
      continue;
    }
    count += grid[nr]![nc]!;
  }
  return count;
}

/** Advances `grid` one generation under `rule`. `boundary: "dead"` treats off-grid neighbors as dead; `"wrap"` is the traditional Life-on-a-torus periodic convention. */
export function stepLifeLike(grid: Grid, rule: LifeLikeRule, boundary: Boundary = "dead"): Cell[][] {
  const height = grid.length;
  const width = grid[0]!.length;
  const next: Cell[][] = Array.from({ length: height }, () => new Array<Cell>(width));
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const liveNeighbors = countLiveNeighbors(grid, row, col, boundary);
      const alive = grid[row]![col] === 1;
      next[row]![col] = (alive ? rule.survival.has(liveNeighbors) : rule.birth.has(liveNeighbors)) ? 1 : 0;
    }
  }
  return next;
}

/** Each cell independently alive with probability `density` (default 0.3, a visually sparse-but-active start), via `rng`. */
export function randomGrid(width: number, height: number, rng: Rng, density = 0.3): Cell[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => (rng.nextFloat() < density ? 1 : 0)));
}

export type Spacetime2D = ReadonlyArray<Grid>;

/**
 * The full space-time history: `generations` grids (including the initial
 * grid as index 0) -- issue #229's own "a 2D rule's history is naturally a
 * 3D voxel volume" framing, one `Grid` layer per generation.
 */
export function spacetimeLifeLike(initial: Grid, rule: LifeLikeRule, generations: number, boundary: Boundary = "dead"): Spacetime2D {
  if (!Number.isInteger(generations) || generations < 1) throw new Error("generations must be a positive integer.");
  const frames: Grid[] = [initial];
  for (let g = 1; g < generations; g++) frames.push(stepLifeLike(frames[g - 1]!, rule, boundary));
  return frames;
}

export interface NamedLifeLikeRule {
  rule: string;
  name: string;
  description: string;
}

export const NAMED_LIFE_LIKE_RULES: readonly NamedLifeLikeRule[] = [
  { rule: "B3/S23", name: "Conway's Life", description: "The original: birth on 3 neighbors, survival on 2 or 3." },
  { rule: "B36/S23", name: "HighLife", description: "Life plus birth on 6 neighbors -- famous for spontaneously-appearing replicators." },
  { rule: "B2/S", name: "Seeds", description: "Birth on 2 neighbors, no survival at all -- every live cell dies next step, producing explosive short-lived growth." },
  { rule: "B3678/S34678", name: "Day & Night", description: "Symmetric under alive/dead inversion -- dense fields behave like sparse ones with colors swapped." },
  { rule: "B3/S12345", name: "Maze", description: "Life's own birth rule with much more permissive survival -- grows sprawling corridor-like structures." },
  { rule: "B1357/S1357", name: "Replicator", description: "Birth and survival on every odd count -- any starting pattern replicates itself repeatedly." },
  { rule: "B35678/S5678", name: "Diamoeba", description: "Forms large blob-like 'amoeba' regions with fractal boundaries." },
];
