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

import { Graph } from "@johnhenry/math";

export type Direction = "N" | "E" | "S" | "W";

/** The direction you'd travel to look back at the tile you came from. */
const OPPOSITE: Record<Direction, Direction> = { N: "S", S: "N", E: "W", W: "E" };

export interface Tile {
  id: string;
  edges: Record<Direction, string>;
  /**
   * Opt-in orientation lock (issue #414): when `true`, `expandTileSetSymmetry`
   * (symmetry.ts) leaves this tile as its single literal orientation even
   * when the tile set's chosen symmetry group would otherwise expand it
   * into its rotated/reflected orbit. Absent/`false` for every tile that
   * doesn't opt in -- purely additive, matches this lab's existing "extra
   * optional field, no change for tiles that don't use it" convention
   * (e.g. compound tiles' own footprint field).
   */
  locked?: boolean;
}

export interface TileSet {
  tiles: Tile[];
}

/**
 * A label's optional trailing `!` (provides/produces) or `?` (requires/
 * consumes) polarity marker (issue #415's directed/polarized matching),
 * split from its base label. `null` when the label has neither suffix --
 * the classical, unmarked case.
 */
type Polarity = "!" | "?" | null;

function splitPolarity(label: string): { base: string; polarity: Polarity } {
  if (label.endsWith("!")) return { base: label.slice(0, -1), polarity: "!" };
  if (label.endsWith("?")) return { base: label.slice(0, -1), polarity: "?" };
  return { base: label, polarity: null };
}

/**
 * True when `a` and `b` can sit side by side with `b` in `direction` from
 * `a` -- i.e. the label `a` shows on its `direction` edge matches the label
 * `b` shows on the edge facing back at `a`.
 *
 * Two matching rules, chosen per-edge-pair by whether either label carries
 * a polarity suffix (issue #415, split from #412's own "typed edge
 * matching" research thread; the doc that thread traces back to,
 * docs/wang-tiles-functional-programming.md, calls this producer/consumer
 * port matching -- `Plan!` matches `Plan?`, not `Plan!` matching another
 * `Plan!`):
 *
 * - Neither side has a `!`/`?` suffix: the classical Wang-tile rule,
 *   PLAIN STRING EQUALITY, completely unchanged from before this feature
 *   existed -- every tile set that never uses the suffix syntax behaves
 *   byte-for-byte identically to the original `a.edges[direction] ===
 *   b.edges[OPPOSITE[direction]]` this function used to be.
 * - BOTH sides have a suffix: they match only when their base labels
 *   (suffix stripped) are equal AND their polarities are OPPOSITE (`!`
 *   meets `?`, never `!` meets `!` or `?` meets `?`) -- a producer edge
 *   can only attach to a consumer edge, matching the doc's own directed
 *   port framing (Robinson's bump/dent arrows, already in this codebase
 *   at `robinson-tile-corpus.ts`, are exactly this pattern -- "arrow
 *   heads must meet arrow tails" -- generalized here into an opt-in
 *   feature of the ordinary square lattice's own `Tile` type, not a
 *   separate infrastructure-only module).
 * - Exactly ONE side has a suffix: never compatible (fails closed) --
 *   mixing directed and undirected authoring on what's meant to be the
 *   same shared edge is far more likely a typo than an intentional rule,
 *   and this function has no way to guess which one is meant.
 *
 * This is the ONLY place any tile-set consumer in this lab compares edge
 * labels -- every solver (`solveWang`/`solveTorus`/`solveWangViaSat`
 * below), `entropy.ts`, `diffraction.ts`, `weighted-tiling.ts`,
 * `differentiable-relax.ts`, and `pruneToSccSustainable` below all call
 * this function rather than re-deriving compatibility themselves, so none
 * of them needed any change to support directed matching -- confirmed by
 * auditing every one of their own edge-comparison call sites before
 * implementing this (see #415's own design-question list, now resolved).
 * `symmetry.ts`'s rotation/reflection also needs no change: a polarity
 * suffix is baked into the label STRING itself, so it travels with the
 * label to whichever side a rotation/reflection moves it to, exactly like
 * any other character in the label already did.
 */
export function tilesCompatible(a: Tile, b: Tile, direction: Direction): boolean {
  const x = splitPolarity(a.edges[direction]);
  const y = splitPolarity(b.edges[OPPOSITE[direction]]);
  if (x.polarity === null && y.polarity === null) return x.base === y.base;
  if (x.polarity === null || y.polarity === null) return false;
  return x.base === y.base && x.polarity !== y.polarity;
}

/**
 * Per-direction compatibility digraph: for each tile, the set of tile ids
 * that may legally sit in `direction` from it. One of issue #92's own
 * listed "Analysis" artifacts (feeds the deferred SCC-pruning solver, which
 * needs Graph SCC from johnhenry/math#30) -- exposed here as a small
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

/**
 * The subset of `digraph`'s vertices that can appear in a bi-infinite
 * tiling in this ONE direction -- issue #386's "SCC-based pruning" solver,
 * finally unblocked by `mallory-math`'s `Graph.stronglyConnectedComponents`
 * (Tarjan's algorithm). A tile survives when it either sits in a
 * nontrivial SCC (size >= 2 -- it can be left and re-entered via some
 * cycle through other tiles) or has a direct self-loop (compatible with
 * itself in this direction, a trivial 1-cycle) -- every other tile is a
 * dead end: reachable, perhaps, but with no way back, so an infinite
 * sequence can pass through it at most once.
 */
function sccSustainableIds(digraph: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const graph = new Graph<string>(true);
  for (const id of digraph.keys()) graph.addVertex(id);
  for (const [from, tos] of digraph) for (const to of tos) graph.addEdge(from, to);
  const sustainable = new Set<string>();
  for (const component of graph.stronglyConnectedComponents()) {
    if (component.length > 1) {
      for (const id of component) sustainable.add(id);
    } else if (digraph.get(component[0]!)?.has(component[0]!)) {
      sustainable.add(component[0]!);
    }
  }
  return sustainable;
}

/**
 * `tileSet` pruned down to only the tiles that can sustain a bi-infinite
 * tiling -- issue #386. Only 2 of the 4 per-direction digraphs need their
 * own SCC pass: `tilesCompatible(a,b,E) === tilesCompatible(b,a,W)` (E's
 * digraph and W's digraph are exact reverses of each other), and reversing
 * every edge of a directed graph never changes its strongly connected
 * components -- so E and W always agree on which tiles survive, and
 * likewise N and S. A pruned tile set never changes whether a FINITE grid
 * is solvable (a pruned tile could still legally appear once, at a
 * boundary) -- this is specifically for periodicity search
 * ({@link solveTorus}) and as a pre-analysis "can this tile set even
 * sustain an infinite tiling" verdict, not a replacement for
 * {@link solveWang}'s own per-cell candidate filtering.
 */
export function pruneToSccSustainable(tileSet: TileSet): TileSet {
  const tiles = tileSet.tiles;
  const horizontallySustainable = sccSustainableIds(buildCompatibilityDigraph(tiles, "E"));
  const verticallySustainable = sccSustainableIds(buildCompatibilityDigraph(tiles, "S"));
  return { tiles: tiles.filter((t) => horizontallySustainable.has(t.id) && verticallySustainable.has(t.id)) };
}

export type WangGrid = ReadonlyArray<ReadonlyArray<string>>;

export interface SolveStep {
  /**
   * The grid so far, row-major, `null` for not-yet-decided cells -- or
   * `null` itself when `options.trackSteps` is `false` (see `solveWang`'s
   * own doc comment): a full-grid deep clone costs O(width * height), and
   * `TilesPanel` only needs it when step-by-step animation is actually on
   * (`showAnimation`) -- otherwise every placement AND every backtrack pays
   * that cost for a value nobody displays.
   */
  grid: ReadonlyArray<ReadonlyArray<string | null>> | null;
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
 *
 * `options.trackSteps` (default `true`) controls whether each yielded step
 * carries a full grid snapshot; `TilesPanel` passes `trackSteps:
 * showAnimation` since a solve run with the step-by-step animation toggle
 * off never reads `.grid` on any intermediate step.
 */
export async function* solveWang(
  tileSet: TileSet,
  width: number,
  height: number,
  options: { trackSteps?: boolean } = {},
): AsyncGenerator<SolveStep, WangGrid | null> {
  const trackSteps = options.trackSteps ?? true;
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

  function snapshot(): (string | null)[][] | null {
    return trackSteps ? grid.map((r) => [...r]) : null;
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

/**
 * True when the completed `width`x`height` grid ALSO satisfies torus
 * (periodic) boundary conditions -- column `width-1`'s east edge matches
 * column `0`'s west edge in every row, and row `height-1`'s south edge
 * matches row `0`'s north edge in every column. A grid a plain
 * {@link solveWang} accepts (interior edges only) may still fail this.
 */
function isPeriodic(byId: ReadonlyMap<string, Tile>, grid: WangGrid, width: number, height: number): boolean {
  for (let row = 0; row < height; row++) {
    const east = byId.get(grid[row]![width - 1] as string) as Tile;
    const west = byId.get(grid[row]![0] as string) as Tile;
    if (!tilesCompatible(east, west, "E")) return false;
  }
  for (let col = 0; col < width; col++) {
    const south = byId.get(grid[height - 1]![col] as string) as Tile;
    const north = byId.get(grid[0]![col] as string) as Tile;
    if (!tilesCompatible(south, north, "S")) return false;
  }
  return true;
}

/**
 * Torus/periodicity search (issue #92 M1's own listed "torus/periodicity
 * search" solver variant): does `tileSet` admit a `width`x`height` tiling
 * that also wraps correctly on BOTH axes -- the standard test for whether
 * a tile set admits a bi-infinite PERIODIC tiling of the plane (tile the
 * plane by translating the solved torus tile in both directions).
 *
 * Same row-major backtracking shape as {@link solveWang} -- the wrapped
 * neighbor of a row-0 or column-0 cell is always a LATER cell in row-major
 * order (not yet placed when that cell is first tried), so periodicity
 * can't be enforced incrementally at placement time the way the interior
 * west/north checks are; it's instead checked once as an extra condition
 * at the "grid fully placed" base case -- a filled-but-non-periodic grid
 * is treated exactly like a dead end, so the search backtracks and tries
 * other candidates for the cells nearest the wrap boundary.
 *
 * `options.trackSteps` (default `true`), same escape hatch as `solveWang`'s
 * own. `options.pruneUnsustainable` (default `false`, issue #386) runs
 * {@link pruneToSccSustainable} first -- safe here specifically (unlike
 * for {@link solveWang}) because periodicity requires every tile in the
 * solved grid to already be part of a sustainable cycle; a smaller
 * candidate set can only shrink the search, never change whether a
 * periodic tiling exists.
 */
export async function* solveTorus(
  tileSet: TileSet,
  width: number,
  height: number,
  options: { trackSteps?: boolean; pruneUnsustainable?: boolean } = {},
): AsyncGenerator<SolveStep, WangGrid | null> {
  const trackSteps = options.trackSteps ?? true;
  const tiles = (options.pruneUnsustainable ? pruneToSccSustainable(tileSet) : tileSet).tiles;
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const grid: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null));

  function candidatesAt(row: number, col: number): Tile[] {
    return tiles.filter((t) => {
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
  }

  function snapshot(): (string | null)[][] | null {
    return trackSteps ? grid.map((r) => [...r]) : null;
  }

  async function* backtrack(index: number): AsyncGenerator<SolveStep, boolean> {
    if (index === width * height) {
      return isPeriodic(byId, grid as WangGrid, width, height);
    }
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

// ---- SAT cross-check solver (issue #92 M1's own listed "SAT encoding of
// finite-patch tilability... as a cross-check solver") -----------------------
//
// A minimal DPLL solver (unit propagation + branching over an immutable
// per-branch assignment, no external SAT library -- matching the family's
// zero-external-dependency convention for its own reference algorithms)
// plus a CNF encoder for "does tileSet tile this width x height grid,"
// deliberately independent of solveWang's own backtracking implementation
// -- the whole point of a cross-check is that a bug in one algorithm is
// very unlikely to also be present, in the same way, in the other.

/** A CNF literal: a positive or negative 1-indexed variable number (`-v` means "variable v is false"). */
export type Literal = number;
export type Clause = readonly Literal[];
export type Cnf = readonly Clause[];

function litValue(lit: Literal, assignment: ReadonlyMap<number, boolean>): boolean | undefined {
  const v = assignment.get(Math.abs(lit));
  if (v === undefined) return undefined;
  return lit > 0 ? v : !v;
}

/**
 * Minimal DPLL SAT solver: unit propagation to a fixed point, then branch
 * on the first unassigned variable (true, then false), recursing on an
 * immutable per-branch copy of the assignment (simpler to reason about
 * correctly than mutate-and-undo backtracking, at some memory cost --
 * acceptable at the small instance sizes this cross-check targets).
 * Returns a satisfying assignment (1-indexed variable -> boolean) or
 * `null` if `cnf` is unsatisfiable.
 */
export function solveSat(cnf: Cnf, numVars: number): Map<number, boolean> | null {
  return dpll(new Map());

  function propagate(assignment: ReadonlyMap<number, boolean>): Map<number, boolean> | null {
    let current = new Map(assignment);
    let changed = true;
    while (changed) {
      changed = false;
      for (const clause of cnf) {
        let satisfied = false;
        let unassignedCount = 0;
        let lastUnassigned = 0;
        for (const lit of clause) {
          const v = litValue(lit, current);
          if (v === true) {
            satisfied = true;
            break;
          }
          if (v === undefined) {
            unassignedCount++;
            lastUnassigned = lit;
          }
        }
        if (satisfied) continue;
        if (unassignedCount === 0) return null; // every literal false -> clause falsified
        if (unassignedCount === 1) {
          current.set(Math.abs(lastUnassigned), lastUnassigned > 0);
          changed = true;
        }
      }
    }
    return current;
  }

  function isFullySatisfied(assignment: ReadonlyMap<number, boolean>): boolean {
    return cnf.every((clause) => clause.some((lit) => litValue(lit, assignment) === true));
  }

  function dpll(assignment: ReadonlyMap<number, boolean>): Map<number, boolean> | null {
    const propagated = propagate(assignment);
    if (propagated === null) return null;
    if (isFullySatisfied(propagated)) return propagated;

    let chosen = -1;
    for (let v = 1; v <= numVars; v++) {
      if (!propagated.has(v)) {
        chosen = v;
        break;
      }
    }
    if (chosen === -1) return null; // every variable assigned, still not satisfied

    for (const value of [true, false]) {
      const branch = new Map(propagated);
      branch.set(chosen, value);
      const result = dpll(branch);
      if (result) return result;
    }
    return null;
  }
}

/**
 * Encode "does `tileSet` tile a `width`x`height` grid" as CNF: one boolean
 * variable per (cell, tile) pair (`var(row, col, tileIndex)`), an
 * exactly-one clause set per cell (at least one tile + pairwise mutual
 * exclusion), and a forbidding clause for every east/south-adjacent pair
 * of tile choices that would violate edge matching.
 */
export function encodeWangSat(tileSet: TileSet, width: number, height: number): { cnf: Cnf; numVars: number; varOf: (row: number, col: number, tileIndex: number) => number } {
  const tiles = tileSet.tiles;
  const n = tiles.length;
  const varOf = (row: number, col: number, tileIndex: number): number => (row * width + col) * n + tileIndex + 1;
  const numVars = width * height * n;
  const clauses: Clause[] = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      // At least one tile at this cell.
      clauses.push(Array.from({ length: n }, (_, i) => varOf(row, col, i)));
      // At most one tile at this cell (pairwise mutual exclusion).
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          clauses.push([-varOf(row, col, i), -varOf(row, col, j)]);
        }
      }
      // Forbid incompatible east-adjacent pairs.
      if (col + 1 < width) {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (!tilesCompatible(tiles[i]!, tiles[j]!, "E")) {
              clauses.push([-varOf(row, col, i), -varOf(row, col + 1, j)]);
            }
          }
        }
      }
      // Forbid incompatible south-adjacent pairs.
      if (row + 1 < height) {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (!tilesCompatible(tiles[i]!, tiles[j]!, "S")) {
              clauses.push([-varOf(row, col, i), -varOf(row + 1, col, j)]);
            }
          }
        }
      }
    }
  }

  return { cnf: clauses, numVars, varOf };
}

/**
 * SAT cross-check for {@link solveWang}: independently answers "does
 * `tileSet` tile a `width`x`height` grid" via CNF encoding + DPLL, rather
 * than backtracking placement. Returns the tiling (or `null` if none
 * exists) -- callers wanting just a yes/no can check `!== null`.
 */
export function solveWangViaSat(tileSet: TileSet, width: number, height: number): WangGrid | null {
  const { cnf, numVars, varOf } = encodeWangSat(tileSet, width, height);
  const assignment = solveSat(cnf, numVars);
  if (assignment === null) return null;
  const tiles = tileSet.tiles;
  const grid: string[][] = Array.from({ length: height }, () => Array<string>(width).fill(""));
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      for (let i = 0; i < tiles.length; i++) {
        if (assignment.get(varOf(row, col, i)) === true) {
          grid[row]![col] = tiles[i]!.id;
          break;
        }
      }
    }
  }
  return grid;
}
