/**
 * Illustrative dataflow-pattern tile sets (issue #416, split from #412's
 * research thread traced to docs/wang-tiles-functional-programming.md) --
 * hand-authored examples showing how #415's directed/polarized edge
 * matching (`!` produces, `?` requires) can express simple composition
 * patterns, not just abstract color-matching puzzles.
 *
 * DELIBERATELY SEPARATE from `tile-set-corpus.ts`: that file's own doc
 * comment is explicit that every entry there is verified against a
 * primary source as a genuine APERIODIC tile set -- "getting a label
 * wrong would silently ship a fixture that LOOKS like it's demonstrating
 * aperiodicity but isn't." These examples aren't aperiodic and aren't
 * trying to be; they demonstrate directed composition instead, so mixing
 * them into that array would blur a distinction that file works hard to
 * keep clear. Nothing here makes any aperiodicity claim.
 *
 * Each entry's own solvability is checked by this module's test suite
 * (not just asserted) -- see tile-set-examples.test.ts's own doc comment
 * for why that matters: a subtly wrong hand-authored edge label would
 * silently produce either no solution, or a "valid but not the intended
 * story" solution, defeating the whole pedagogical point.
 */
import type { Tile, TileSet } from "./tile-model.ts";

export interface TileSetExampleEntry {
  id: string;
  name: string;
  description: string;
  tileSet: TileSet;
  /** Unlike `tile-set-corpus.ts`'s entries, these examples are only meaningful at ONE specific grid size -- the exact size that demonstrates the intended pipeline/composition, not "any size works." */
  recommendedWidth: number;
  recommendedHeight: number;
}

/**
 * A linear "pipeline" of 4 tiles chained purely by #415's directed
 * matching: Intake produces a Task, Planner consumes a Task and produces a
 * Plan, Coder consumes a Plan and produces a Patch, Sink consumes a Patch.
 * `Intake.W` and `Sink.E` use distinct sentinel strings ("start"/"end")
 * that don't match anything else in the set (not even each other), so the
 * 4-tile row can only ever complete in exactly this order -- verified by
 * this module's own test, not just asserted by the story above (every
 * OTHER starting tile provably dead-ends after at most 2 more cells, so
 * backtracking search always converges on the intended chain regardless
 * of array order).
 *
 * N/S edges are all the plain wildcard `"x"` (no polarity), so this only
 * needs a single row (`recommendedHeight: 1`) to tell its whole story --
 * any taller grid just repeats the row trivially, adding no pedagogical
 * value, which is why the row height isn't left open the way the
 * aperiodic corpus's own tile sets are.
 */
const WIRE_CHAIN: TileSet = {
  tiles: [
    { id: "Intake", edges: { N: "x", E: "Task!", S: "x", W: "start" } },
    { id: "Planner", edges: { N: "x", E: "Plan!", S: "x", W: "Task?" } },
    { id: "Coder", edges: { N: "x", E: "Patch!", S: "x", W: "Plan?" } },
    { id: "Sink", edges: { N: "x", E: "end", S: "x", W: "Patch?" } },
  ] satisfies Tile[],
};

export const TILE_SET_EXAMPLES: readonly TileSetExampleEntry[] = [
  {
    id: "wire-chain",
    name: "Wire chain (Task -> Plan -> Patch)",
    description:
      "Four tiles chained by directed producer/consumer edges (#415): Intake produces a Task, Planner turns it into a Plan, Coder turns that into a Patch, Sink consumes it. Only solves as this exact 4-wide row -- illustrative of composition, not an aperiodic tile set.",
    tileSet: WIRE_CHAIN,
    recommendedWidth: 4,
    recommendedHeight: 1,
  },
];
