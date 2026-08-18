import assert from "node:assert/strict";
import { test } from "node:test";
import { Rng } from "mallory-tensor-core";
import {
  initialRow,
  NAMED_ELEMENTARY_RULES,
  randomRow,
  ruleTable,
  singleCellRow,
  spacetimeElementary,
  stepElementary,
  toggleRuleBit,
  type Cell,
} from "./elementary.ts";

test("ruleTable(30): hand-computed against the published Rule 30 truth table (111->0, 110->0, 101->0, 100->1, 011->1, 010->1, 001->1, 000->0)", () => {
  const table = ruleTable(30);
  assert.deepEqual([...table], [0, 1, 1, 1, 1, 0, 0, 0]);
});

test("ruleTable(90): hand-computed -- XOR(left, right), center ignored", () => {
  const table = ruleTable(90);
  for (let left = 0; left <= 1; left++) {
    for (let center = 0; center <= 1; center++) {
      for (let right = 0; right <= 1; right++) {
        const index = (left << 2) | (center << 1) | right;
        assert.equal(table[index], left ^ right, `left=${left} center=${center} right=${right}`);
      }
    }
  }
});

test("ruleTable: rejects out-of-range or non-integer rule numbers", () => {
  assert.throws(() => ruleTable(-1), /ruleNumber/);
  assert.throws(() => ruleTable(256), /ruleNumber/);
  assert.throws(() => ruleTable(1.5), /ruleNumber/);
});

test("stepElementary: Rule 90 on a single-cell width-5 row (zero boundary), hand-traced cell by cell", () => {
  const row = singleCellRow(5);
  assert.deepEqual(row, [0, 0, 1, 0, 0]);
  const next = stepElementary(row, 90, "zero");
  assert.deepEqual(next, [0, 1, 0, 1, 0], "the classic 'two dots' expansion, first step of the Sierpinski pattern");
});

test("stepElementary: zero boundary treats off-grid neighbors as 0, hand-verified at the left edge", () => {
  // Rule 1 = only 000 -> 1, every other neighborhood -> 0.
  const row = [0, 0, 0] as const;
  const next = stepElementary(row, 1, "zero");
  assert.deepEqual(next, [1, 1, 1], "every cell sees an all-0 neighborhood (including the zero-padded edges)");
});

test("stepElementary: wrap boundary treats the row as periodic, hand-verified at both edges", () => {
  // A single 1 at the left edge; Rule 90 (XOR of left/right neighbor).
  const row: Cell[] = [1, 0, 0, 0, 0];
  const next = stepElementary(row, 90, "wrap");
  // i=0: left wraps to row[4]=0, right=row[1]=0 -> 0^0=0
  // i=1: left=row[0]=1, right=row[2]=0 -> 1^0=1
  // i=4: left=row[3]=0, right wraps to row[0]=1 -> 0^1=1
  assert.deepEqual(next, [0, 1, 0, 0, 1]);
});

test("singleCellRow: a single 1 at the center column, 0 elsewhere", () => {
  assert.deepEqual(singleCellRow(1), [1]);
  assert.deepEqual(singleCellRow(4), [0, 0, 1, 0]);
});

test("randomRow: same seed produces the same row (deterministic, via mallory-tensor-core's Rng)", () => {
  const a = randomRow(50, new Rng(42));
  const b = randomRow(50, new Rng(42));
  assert.deepEqual(a, b);
  assert.ok(a.some((c) => c === 1) && a.some((c) => c === 0), "a 50-cell random row should have both 0s and 1s");
});

test("initialRow: dispatches to singleCellRow/randomRow by the initial condition, and requires an rng for random", () => {
  assert.deepEqual(initialRow(4, "single-cell"), [0, 0, 1, 0]);
  assert.deepEqual(initialRow(4, "random", new Rng(1)), randomRow(4, new Rng(1)));
  assert.throws(() => initialRow(4, "random"), /requires an rng/);
});

test("initialRow: 'custom' decodes the given bitstring, and requires customBits", () => {
  assert.deepEqual(initialRow(5, "custom", undefined, "10100"), [1, 0, 1, 0, 0]);
  assert.throws(() => initialRow(5, "custom"), /requires customBits/);
});

test("initialRow: 'custom' pads a short bitstring with 0s, same as custom-grid.ts's own decodeBits", () => {
  assert.deepEqual(initialRow(5, "custom", undefined, "1"), [1, 0, 0, 0, 0]);
});

test("toggleRuleBit: flips exactly one bit of the rule number, matching ruleTable before/after", () => {
  const before = ruleTable(30);
  const after = ruleTable(toggleRuleBit(30, 0));
  for (let i = 0; i < 8; i++) {
    if (i === 0) assert.notEqual(after[i], before[i]);
    else assert.equal(after[i], before[i]);
  }
});

test("toggleRuleBit: toggling twice returns to the original rule number", () => {
  assert.equal(toggleRuleBit(toggleRuleBit(30, 3), 3), 30);
});

test("toggleRuleBit: rejects an out-of-range index", () => {
  assert.throws(() => toggleRuleBit(30, -1), /index/);
  assert.throws(() => toggleRuleBit(30, 8), /index/);
});

test("spacetimeElementary: 'custom' initial condition uses the decoded bitstring as row 0", () => {
  const st = spacetimeElementary(30, 5, 3, "custom", "zero", undefined, "10100");
  assert.deepEqual(st[0], [1, 0, 1, 0, 0]);
});

test("spacetimeElementary: rejects non-positive width/generations", () => {
  assert.throws(() => spacetimeElementary(30, 0, 5, "single-cell"), /width/);
  assert.throws(() => spacetimeElementary(30, 5, 0, "single-cell"), /generations/);
});

test("spacetimeElementary: row 0 is the initial condition, each later row is the previous row stepped -- hand-verified against stepElementary directly", () => {
  const width = 9;
  const generations = 4;
  const st = spacetimeElementary(30, width, generations, "single-cell", "zero");
  assert.equal(st.length, generations);
  assert.deepEqual(st[0], singleCellRow(width));
  for (let g = 1; g < generations; g++) {
    assert.deepEqual(st[g], stepElementary(st[g - 1]!, 30, "zero"));
  }
});

test("NAMED_ELEMENTARY_RULES: every entry has a valid rule number and non-empty name/description", () => {
  assert.ok(NAMED_ELEMENTARY_RULES.length > 0);
  for (const rule of NAMED_ELEMENTARY_RULES) {
    assert.ok(Number.isInteger(rule.ruleNumber) && rule.ruleNumber >= 0 && rule.ruleNumber <= 255);
    assert.ok(rule.name.length > 0);
    assert.ok(rule.description.length > 0);
  }
  const ruleNumbers = NAMED_ELEMENTARY_RULES.map((r) => r.ruleNumber);
  assert.equal(new Set(ruleNumbers).size, ruleNumbers.length, "no duplicate rule numbers in the curated list");
});
