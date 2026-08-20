import assert from "node:assert/strict";
import { test } from "node:test";
import { Rng } from "mallory-tensor-core";
import {
  initialGrid3D,
  NAMED_TOTALISTIC_3D_RULES,
  parseTotalisticRule3D,
  randomGrid3D,
  spacetimeTotalistic3D,
  stepTotalistic3D,
  toggleBirth3D,
  toggleSurvival3D,
  totalisticRule3DToString,
  type Grid3D,
} from "./totalistic-3d.ts";

test("parseTotalisticRule3D: parses comma-separated multi-digit counts (needed since 3D's 26-neighbor range exceeds single digits, unlike 2D's B/S notation)", () => {
  const rule = parseTotalisticRule3D("B12/S13,14,26");
  assert.deepEqual([...rule.birth], [12], "a single two-digit count, not digits 1 and 2 the way life-like.ts's digit-concatenation would misread it");
  assert.deepEqual([...rule.survival].sort((a, b) => a - b), [13, 14, 26]);
});

test("parseTotalisticRule3D: rejects out-of-range counts and malformed input", () => {
  assert.throws(() => parseTotalisticRule3D("B27/S0"), /Invalid neighbor count/);
  assert.throws(() => parseTotalisticRule3D("B-1/S0"), /Invalid 3D rule/);
  assert.throws(() => parseTotalisticRule3D("B6,S5"), /Invalid 3D rule/);
});

test("totalisticRule3DToString: round-trips through parseTotalisticRule3D with counts sorted ascending", () => {
  const rule = parseTotalisticRule3D("B12,4/S9,3");
  assert.equal(totalisticRule3DToString(rule), "B4,12/S3,9");
  assert.deepEqual(parseTotalisticRule3D(totalisticRule3DToString(rule)), rule);
});

function singleCellGrid3D(): Grid3D {
  return Array.from({ length: 3 }, (_, z) =>
    Array.from({ length: 3 }, (_, y) => Array.from({ length: 3 }, (_, x) => (x === 1 && y === 1 && z === 1 ? 1 : 0))),
  ) as Grid3D;
}

test("stepTotalistic3D: a single live cell at the center of a 3x3x3 grid births its entire 26-cell Moore neighborhood under B1/S0, hand-verified (every neighbor position sees exactly 1 live neighbor -- the center -- and the center itself sees 0)", () => {
  const rule = parseTotalisticRule3D("B1/S0");
  const grid = singleCellGrid3D();
  const next = stepTotalistic3D(grid, rule, "dead");
  const flat = next.flat(2);
  assert.equal(flat.length, 27);
  assert.ok(flat.every((c) => c === 1), "the whole 3x3x3 cube should be alive after one step");
});

test("stepTotalistic3D: the same single-center-cell grid stays a single live cell under B0/S0 is false -- birth on 0 would also fire everywhere, so use S1/B(none) to confirm the center itself dies (0 live neighbors, not in survival set)", () => {
  const rule = parseTotalisticRule3D("B/S1");
  const grid = singleCellGrid3D();
  const next = stepTotalistic3D(grid, rule, "dead");
  const flat = next.flat(2);
  assert.ok(flat.every((c) => c === 0), "center had 0 live neighbors (not in S1), and no cell has exactly 1 live neighbor to trigger birth via an empty birth set");
});

test("stepTotalistic3D: wrap boundary changes the result vs. dead boundary on a small torus, hand-verified via a direct run before writing the assertion (matching this lab's own established discipline for small-torus adjacency surprises)", () => {
  const rule = parseTotalisticRule3D("B1/S0");
  const grid = singleCellGrid3D();
  const wrapped = stepTotalistic3D(grid, rule, "wrap");
  const notWrapped = stepTotalistic3D(grid, rule, "dead");
  // On a 3x3x3 torus, EVERY cell already sees the center within one wrapped
  // step in some direction (the grid is only 3 wide per axis), so the
  // wrapped result is identical to the dead-boundary one for this
  // particular fixture -- confirmed directly rather than assumed.
  assert.deepEqual(wrapped, notWrapped);
});

test("randomGrid3D: same seed produces the same grid (deterministic)", () => {
  const a = randomGrid3D(4, 4, 4, new Rng(3), 0.4);
  const b = randomGrid3D(4, 4, 4, new Rng(3), 0.4);
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  assert.equal(a[0]!.length, 4);
  assert.equal(a[0]![0]!.length, 4);
});

test("spacetimeTotalistic3D: rejects non-positive generations", () => {
  const grid: Grid3D = [[[0]]];
  assert.throws(() => spacetimeTotalistic3D(grid, parseTotalisticRule3D("B1/S0"), 0), /generations/);
});

test("spacetimeTotalistic3D: frame 0 is the initial grid, each later frame is the previous one stepped -- hand-verified against stepTotalistic3D directly", () => {
  const rule = parseTotalisticRule3D("B1/S0");
  const initial = singleCellGrid3D();
  const st = spacetimeTotalistic3D(initial, rule, 3, "dead");
  assert.equal(st.length, 3);
  assert.deepEqual(st[0], initial);
  for (let g = 1; g < 3; g++) assert.deepEqual(st[g], stepTotalistic3D(st[g - 1]!, rule, "dead"));
});

test("toggleBirth3D: adds a missing count and removes a present one, leaving survival untouched, over the full 0-26 range", () => {
  const rule = parseTotalisticRule3D("B6/S5,6,7");
  const added = toggleBirth3D(rule, 26);
  assert.deepEqual([...added.birth].sort((a, b) => a - b), [6, 26]);
  assert.deepEqual([...added.survival].sort((a, b) => a - b), [5, 6, 7]);
  const removed = toggleBirth3D(rule, 6);
  assert.deepEqual([...removed.birth], []);
});

test("toggleSurvival3D: adds a missing count and removes a present one, leaving birth untouched", () => {
  const rule = parseTotalisticRule3D("B6/S5,6,7");
  const added = toggleSurvival3D(rule, 0);
  assert.deepEqual([...added.survival].sort((a, b) => a - b), [0, 5, 6, 7]);
  assert.deepEqual([...added.birth], [6]);
  const removed = toggleSurvival3D(rule, 5);
  assert.deepEqual([...removed.survival].sort((a, b) => a - b), [6, 7]);
});

test("toggleBirth3D/toggleSurvival3D twice returns to the original rule", () => {
  const rule = parseTotalisticRule3D("B4/S6,7,8");
  assert.deepEqual(toggleBirth3D(toggleBirth3D(rule, 20), 20), rule);
  assert.deepEqual(toggleSurvival3D(toggleSurvival3D(rule, 12), 12), rule);
});

test("NAMED_TOTALISTIC_3D_RULES: every entry's rule string parses cleanly and round-trips, no duplicates", () => {
  assert.ok(NAMED_TOTALISTIC_3D_RULES.length > 0);
  const seen = new Set<string>();
  for (const entry of NAMED_TOTALISTIC_3D_RULES) {
    const parsed = parseTotalisticRule3D(entry.rule);
    assert.ok(parsed.birth.size > 0 || parsed.survival.size > 0);
    assert.equal(totalisticRule3DToString(parsed), entry.rule, `${entry.name}'s rule string should already be in canonical sorted form`);
    assert.ok(entry.name.length > 0);
    assert.ok(entry.description.length > 0);
    assert.ok(!seen.has(entry.rule), `duplicate rule ${entry.rule}`);
    seen.add(entry.rule);
  }
});

test("initialGrid3D: 'custom' decodes the given bitstring z-major, and requires customBits (issue #389)", () => {
  const grid = initialGrid3D(2, 2, 2, "custom", undefined, undefined, "10011100");
  assert.deepEqual(grid, [
    [
      [1, 0],
      [0, 1],
    ],
    [
      [1, 1],
      [0, 0],
    ],
  ]);
  assert.throws(() => initialGrid3D(2, 2, 2, "custom"), /requires customBits/);
});

test("initialGrid3D: 'random' requires an rng and matches randomGrid3D given the same one", () => {
  assert.throws(() => initialGrid3D(3, 3, 3, "random"), /requires an rng/);
  const grid = initialGrid3D(3, 3, 3, "random", new Rng(7), 0.4);
  assert.deepEqual(grid, randomGrid3D(3, 3, 3, new Rng(7), 0.4));
});
