import assert from "node:assert/strict";
import { test } from "node:test";
import { patchCensus, patchCensusGrowth } from "./patch-census.ts";
import type { WangGrid } from "./tile-model.ts";

// Checkerboard 3x3: A B A / B A B / A B A.
const CHECKERBOARD: WangGrid = [
  ["A", "B", "A"],
  ["B", "A", "B"],
  ["A", "B", "A"],
];

test("patchCensus: 1x1 patches on the checkerboard -- 2 distinct patterns, A appears 5 times, B 4 times, hand-verified", () => {
  const { patches, totalWindows } = patchCensus(CHECKERBOARD, 1, 1);
  assert.equal(totalWindows, 9);
  const byPattern = new Map(patches.map((p) => [p.pattern, p.count]));
  assert.equal(byPattern.get("A"), 5);
  assert.equal(byPattern.get("B"), 4);
  assert.equal(patches.length, 2);
});

test("patchCensus: 2x2 patches on the checkerboard -- exactly 2 distinct patterns (AB/BA and BA/AB), each appearing twice, hand-verified", () => {
  const { patches, totalWindows } = patchCensus(CHECKERBOARD, 2, 2);
  assert.equal(totalWindows, 4, "(3-2+1)^2 = 4 window positions");
  assert.equal(patches.length, 2);
  for (const p of patches) assert.equal(p.count, 2);
});

test("patchCensus: patch size equal to the whole grid has exactly 1 window position and 1 distinct pattern", () => {
  const { patches, totalWindows } = patchCensus(CHECKERBOARD, 3, 3);
  assert.equal(totalWindows, 1);
  assert.equal(patches.length, 1);
  assert.equal(patches[0]!.count, 1);
});

test("patchCensus: a uniform grid (single tile id everywhere) has exactly 1 distinct patch at every size", () => {
  const uniform: WangGrid = [
    ["X", "X", "X"],
    ["X", "X", "X"],
  ];
  for (const [h, w] of [[1, 1], [1, 3], [2, 1], [2, 2], [2, 3]] as const) {
    const { patches } = patchCensus(uniform, h, w);
    assert.equal(patches.length, 1, `expected exactly 1 distinct ${h}x${w} patch in a uniform grid`);
  }
});

test("patchCensus: rejects a patch size larger than the grid", () => {
  assert.throws(() => patchCensus(CHECKERBOARD, 4, 1), /larger than the grid/);
  assert.throws(() => patchCensus(CHECKERBOARD, 1, 4), /larger than the grid/);
});

test("patchCensus: rejects a non-positive or non-integer patch size", () => {
  assert.throws(() => patchCensus(CHECKERBOARD, 0, 1), /positive integers/);
  assert.throws(() => patchCensus(CHECKERBOARD, 1.5, 1), /positive integers/);
});

test("patchCensusGrowth: on the checkerboard, reports 2/2/1 distinct patterns at sizes 1/2/3 -- a real (non-monotonic) example, per this module's own doc comment", () => {
  const growth = patchCensusGrowth(CHECKERBOARD, 3);
  assert.deepEqual(growth, [
    { size: 1, distinctPatches: 2 },
    { size: 2, distinctPatches: 2 },
    { size: 3, distinctPatches: 1 },
  ]);
});

test("patchCensusGrowth: caps at the grid's own smaller dimension even when maxSize asks for more", () => {
  const wide: WangGrid = [
    ["A", "B", "A", "B"],
  ];
  const growth = patchCensusGrowth(wide, 10);
  assert.deepEqual(
    growth.map((g) => g.size),
    [1],
    "a 1-row grid can only support size-1 patches",
  );
});
