/**
 * Elementary (1D, radius-1, binary) cellular automata (issue #229 M1) --
 * Wolfram's own encoding: a "rule number" 0-255 is the 8-bit truth table
 * for every possible 3-cell neighborhood (left, center, right), read off
 * the rule number's binary expansion. Index `i` (0-7) corresponds to the
 * neighborhood whose bits are `i`'s own binary digits in (left, center,
 * right) order -- e.g. neighborhood `1,1,1` is index `0b111 = 7`, and
 * Rule 30's bit 7 is `0` (`30 = 0b00011110`, bit 7 counting from the LSB
 * is the top/8th bit, which is 0), so `1,1,1 -> 0` under Rule 30 --
 * matching every published Rule-30 truth table (Wolfram, MathWorld).
 */
import { Rng } from "@johnhenry/math-plus-tensor-core";
import { decodeCustomRow } from "./custom-grid.ts";

export type Cell = 0 | 1;
export type Boundary = "zero" | "wrap";
export type InitialCondition = "single-cell" | "random" | "custom";

/** The 8-entry lookup table for `ruleNumber`, indexed by `(left << 2) | (center << 1) | right`. */
export function ruleTable(ruleNumber: number): readonly Cell[] {
  if (!Number.isInteger(ruleNumber) || ruleNumber < 0 || ruleNumber > 255) {
    throw new Error("ruleNumber must be an integer in [0, 255].");
  }
  const table: Cell[] = [];
  for (let i = 0; i < 8; i++) table.push(((ruleNumber >> i) & 1) as Cell);
  return table;
}

/** Advances `row` one generation under `ruleNumber`. `boundary: "zero"` treats off-grid neighbors as 0; `"wrap"` is periodic (the row's own torus). */
export function stepElementary(row: readonly Cell[], ruleNumber: number, boundary: Boundary = "zero"): Cell[] {
  const table = ruleTable(ruleNumber);
  const n = row.length;
  const next: Cell[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const left = i > 0 ? row[i - 1]! : boundary === "wrap" ? row[n - 1]! : 0;
    const center = row[i]!;
    const right = i < n - 1 ? row[i + 1]! : boundary === "wrap" ? row[0]! : 0;
    const index = (left << 2) | (center << 1) | right;
    next[i] = table[index]!;
  }
  return next;
}

/** A single 1 at the center column, 0 elsewhere -- the classic elementary-CA starting condition. */
export function singleCellRow(width: number): Cell[] {
  const row = new Array<Cell>(width).fill(0);
  row[Math.floor(width / 2)] = 1;
  return row;
}

/** Each cell independently 0 or 1 with probability 0.5, via `rng`. */
export function randomRow(width: number, rng: Rng): Cell[] {
  return Array.from({ length: width }, () => (rng.nextFloat() < 0.5 ? 1 : 0));
}

/** `customBits` is the '0'/'1' bitstring a custom initial-state editor (issue #260 item 1) painted -- see custom-grid.ts's own doc comment for the encoding. */
export function initialRow(width: number, initial: InitialCondition, rng?: Rng, customBits?: string): Cell[] {
  if (initial === "single-cell") return singleCellRow(width);
  if (initial === "custom") {
    if (customBits === undefined) throw new Error('initialRow("custom", ...) requires customBits.');
    return decodeCustomRow(customBits, width);
  }
  if (!rng) throw new Error('initialRow("random", ...) requires an rng.');
  return randomRow(width, rng);
}

/**
 * Flips whether neighborhood `index` (0-7, encoding `(left << 2) | (center
 * << 1) | right` as `ruleTable` itself does) maps to "alive" under
 * `ruleNumber`, returning the resulting rule number -- the primitive the 1D
 * visual rule picker (issue #260 item 2) toggles on each diagram click.
 */
export function toggleRuleBit(ruleNumber: number, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > 7) throw new Error("index must be an integer in [0, 7].");
  return ruleNumber ^ (1 << index);
}

export type Spacetime = ReadonlyArray<ReadonlyArray<Cell>>;

/**
 * The full space-time history: `generations` rows (including the initial
 * row as row 0), each `width` cells wide -- issue #229's own "1D rule's
 * history is naturally a 2D image" framing, computed eagerly (cheap enough
 * even at a few hundred generations x a few hundred columns -- no async
 * generator needed the way the Wang tile solvers' combinatorial
 * backtracking search does).
 */
export function spacetimeElementary(
  ruleNumber: number,
  width: number,
  generations: number,
  initial: InitialCondition,
  boundary: Boundary = "zero",
  rng?: Rng,
  customBits?: string,
): Spacetime {
  if (!Number.isInteger(width) || width < 1) throw new Error("width must be a positive integer.");
  if (!Number.isInteger(generations) || generations < 1) throw new Error("generations must be a positive integer.");
  const rows: Cell[][] = [initialRow(width, initial, rng, customBits)];
  for (let g = 1; g < generations; g++) rows.push(stepElementary(rows[g - 1]!, ruleNumber, boundary));
  return rows;
}

export interface NamedElementaryRule {
  ruleNumber: number;
  name: string;
  description: string;
}

/**
 * A curated set of well-known elementary rules (issue #229's own "a
 * dropdown of NAMED rules, not just a raw number" requirement) -- spans
 * Wolfram's own class I-IV taxonomy so the dropdown demonstrates the full
 * range of behavior, not just the famous chaotic ones.
 */
export const NAMED_ELEMENTARY_RULES: readonly NamedElementaryRule[] = [
  { ruleNumber: 30, name: "Rule 30", description: "Chaotic (class III) -- used as a pseudorandom-number source; Wolfram's own CA-based RNG." },
  { ruleNumber: 90, name: "Rule 90", description: "XOR of the two neighbors -- draws the Sierpinski triangle from a single-cell start." },
  { ruleNumber: 110, name: "Rule 110", description: "Turing-complete (Cook, 2004) -- the only elementary rule proven capable of universal computation." },
  { ruleNumber: 184, name: "Rule 184", description: "Traffic-flow model -- 1s move right when possible, the standard toy model for single-lane traffic jams." },
  { ruleNumber: 54, name: "Rule 54", description: "Class IV (complex, localized structures) -- persistent gliders against a periodic background." },
  { ruleNumber: 60, name: "Rule 60", description: "XOR of left neighbor and self -- Pascal's triangle mod 2." },
  { ruleNumber: 150, name: "Rule 150", description: "XOR of all three cells -- another Pascal's-triangle-mod-2 variant, denser than Rule 60." },
  { ruleNumber: 250, name: "Rule 250", description: "Class I (simple/fixed) -- rapidly settles into a static pattern." },
];
