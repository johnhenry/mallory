import assert from "node:assert/strict";
import { test } from "node:test";
import { Rng } from "@johnhenry/math-plus-tensor-core";
import {
  bsRuleToString,
  initialGrid,
  NAMED_LIFE_LIKE_RULES,
  parseBSRule,
  randomGrid,
  spacetimeLifeLike,
  stepLifeLike,
  toggleBirth,
  toggleSurvival,
  type Grid,
} from "./life-like.ts";

test("parseBSRule: Conway's Life (B3/S23) parses to birth={3}, survival={2,3}", () => {
  const rule = parseBSRule("B3/S23");
  assert.deepEqual([...rule.birth], [3]);
  assert.deepEqual([...rule.survival].sort(), [2, 3]);
});

test("parseBSRule: an empty half (Seeds, B2/S) parses to an empty survival set, not an error", () => {
  const rule = parseBSRule("B2/S");
  assert.deepEqual([...rule.birth], [2]);
  assert.equal(rule.survival.size, 0);
});

test("parseBSRule: case-insensitive and trims whitespace", () => {
  const rule = parseBSRule("  b36/s23  ");
  assert.deepEqual([...rule.birth].sort(), [3, 6]);
});

test("parseBSRule: rejects malformed input", () => {
  assert.throws(() => parseBSRule("3/23"), /Invalid B\/S rule/);
  assert.throws(() => parseBSRule("B9/S23"), /Invalid B\/S rule/);
  assert.throws(() => parseBSRule("B3S23"), /Invalid B\/S rule/);
});

test("bsRuleToString: round-trips through parseBSRule with digits sorted ascending", () => {
  const rule = parseBSRule("B63/S32");
  assert.equal(bsRuleToString(rule), "B36/S23");
  assert.deepEqual(parseBSRule(bsRuleToString(rule)), rule);
});

test("stepLifeLike: a horizontal blinker becomes a vertical blinker under Conway's Life, hand-verified neighbor-by-neighbor (dead boundary)", () => {
  const rule = parseBSRule("B3/S23");
  const grid: Grid = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ];
  const next = stepLifeLike(grid, rule, "dead");
  assert.deepEqual(next, [
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
});

test("stepLifeLike: a blinker one full period (2 steps) returns to its original orientation, confirming it's a genuine oscillator", () => {
  const rule = parseBSRule("B3/S23");
  const horizontal: Grid = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ];
  const afterTwo = stepLifeLike(stepLifeLike(horizontal, rule, "dead"), rule, "dead");
  assert.deepEqual(afterTwo, horizontal);
});

test("stepLifeLike: wrap boundary genuinely changes the result vs. dead boundary, hand-verified on a 3x3 vertical blinker", () => {
  // On a 3x3 grid every cell is at most 1 step from every other cell once
  // wrapped, so a middle-column blinker's wrapped neighbor counts are very
  // different from its true (dead-boundary) ones -- verified by direct
  // per-cell computation (both confirmed against a live run of this exact
  // function before writing the assertion, not assumed from the 2D-plane
  // blinker-oscillator intuition, which doesn't hold at this tiny a torus).
  const rule = parseBSRule("B3/S23");
  const grid: Grid = [
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ];
  const wrapped = stepLifeLike(grid, rule, "wrap");
  const notWrapped = stepLifeLike(grid, rule, "dead");
  assert.deepEqual(
    wrapped,
    [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
    "every dead cell on this 3x3 torus also sees exactly 3 live neighbors via wraparound, so the whole grid births to alive",
  );
  assert.deepEqual(
    notWrapped,
    [
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    "without wraparound this is the ordinary vertical-to-horizontal blinker oscillation",
  );
});

test("randomGrid: same seed produces the same grid (deterministic)", () => {
  const a = randomGrid(10, 8, new Rng(7), 0.4);
  const b = randomGrid(10, 8, new Rng(7), 0.4);
  assert.deepEqual(a, b);
  assert.equal(a.length, 8);
  assert.equal(a[0]!.length, 10);
});

test("spacetimeLifeLike: rejects non-positive generations", () => {
  const grid: Grid = [[0]];
  assert.throws(() => spacetimeLifeLike(grid, parseBSRule("B3/S23"), 0), /generations/);
});

test("spacetimeLifeLike: frame 0 is the initial grid, each later frame is the previous one stepped -- hand-verified against stepLifeLike directly", () => {
  const rule = parseBSRule("B3/S23");
  const initial: Grid = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ];
  const st = spacetimeLifeLike(initial, rule, 3, "dead");
  assert.equal(st.length, 3);
  assert.deepEqual(st[0], initial);
  for (let g = 1; g < 3; g++) assert.deepEqual(st[g], stepLifeLike(st[g - 1]!, rule, "dead"));
});

test("toggleBirth: adds a missing count and removes a present one, leaving survival untouched", () => {
  const rule = parseBSRule("B3/S23");
  const added = toggleBirth(rule, 6);
  assert.deepEqual([...added.birth].sort(), [3, 6]);
  assert.deepEqual([...added.survival].sort(), [2, 3]);
  const removed = toggleBirth(rule, 3);
  assert.deepEqual([...removed.birth], []);
});

test("toggleSurvival: adds a missing count and removes a present one, leaving birth untouched", () => {
  const rule = parseBSRule("B3/S23");
  const added = toggleSurvival(rule, 5);
  assert.deepEqual([...added.survival].sort(), [2, 3, 5]);
  assert.deepEqual([...added.birth], [3]);
  const removed = toggleSurvival(rule, 2);
  assert.deepEqual([...removed.survival].sort(), [3]);
});

test("toggleBirth/toggleSurvival twice returns to the original rule", () => {
  const rule = parseBSRule("B36/S23");
  assert.deepEqual(toggleBirth(toggleBirth(rule, 8), 8), rule);
  assert.deepEqual(toggleSurvival(toggleSurvival(rule, 4), 4), rule);
});

test("initialGrid: 'random' dispatches to randomGrid and requires an rng", () => {
  assert.deepEqual(initialGrid(4, 3, "random", new Rng(7), 0.3), randomGrid(4, 3, new Rng(7), 0.3));
  assert.throws(() => initialGrid(4, 3, "random"), /requires an rng/);
});

test("initialGrid: 'custom' decodes the given bitstring row-major, and requires customBits", () => {
  const grid = initialGrid(3, 2, "custom", undefined, undefined, "110001");
  assert.deepEqual(grid, [
    [1, 1, 0],
    [0, 0, 1],
  ]);
  assert.throws(() => initialGrid(3, 2, "custom"), /requires customBits/);
});

test("NAMED_LIFE_LIKE_RULES: every entry's rule string parses cleanly and round-trips, no duplicate rules", () => {
  assert.ok(NAMED_LIFE_LIKE_RULES.length > 0);
  const seen = new Set<string>();
  for (const entry of NAMED_LIFE_LIKE_RULES) {
    const parsed = parseBSRule(entry.rule);
    assert.equal(bsRuleToString(parsed), entry.rule, `${entry.name}'s rule string should already be in canonical sorted-digit form`);
    assert.ok(entry.name.length > 0);
    assert.ok(entry.description.length > 0);
    assert.ok(!seen.has(entry.rule), `duplicate rule ${entry.rule}`);
    seen.add(entry.rule);
  }
});
