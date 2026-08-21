import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCulikKariCubes } from "./cube-tile-corpus.ts";

/**
 * These tests document CURRENT (unverified) behavior of the generator --
 * see cube-tile-corpus.ts's own doc comment for why this module is
 * infrastructure, not a confirmed fixture. They exist to catch accidental
 * regressions in the mechanical parts (cube count, id uniqueness) and to
 * keep the "17 colors, not 7" finding a checked, reproducible fact rather
 * than a claim that could silently drift as the code changes.
 */

test("buildCulikKariCubes: always produces exactly 21 cubes with unique ids, for either ambiguous-removal resolution", () => {
  for (const row of [9, 10] as const) {
    const cubes = buildCulikKariCubes(row);
    assert.equal(cubes.length, 21);
    assert.equal(new Set(cubes.map((c) => c.id)).size, 21);
  }
});

test("buildCulikKariCubes: currently produces 17 distinct face labels (not the paper's own claimed 7) for either resolution -- the concrete inconsistency #400 is tracking, checked so it doesn't silently change unnoticed", () => {
  for (const row of [9, 10] as const) {
    const cubes = buildCulikKariCubes(row);
    const colors = new Set<string>();
    for (const c of cubes) for (const label of Object.values(c.faces)) colors.add(label);
    assert.equal(colors.size, 17, `row ${row}: expected 17 distinct labels with the current (unverified) field mapping`);
  }
});

test("buildCulikKariCubes: the two ambiguous-removal resolutions produce genuinely different cube sets (not accidentally identical)", () => {
  const viaRow9 = buildCulikKariCubes(9);
  const viaRow10 = buildCulikKariCubes(10);
  // The ambiguous row differs only in its own S value, feeding into
  // exactly one family-A cube's S face (mapped from row.e per the current
  // best-effort mapping) -- confirm the two builds actually diverge
  // somewhere, not that they happen to coincide.
  const serialize = (cubes: ReturnType<typeof buildCulikKariCubes>) => cubes.map((c) => JSON.stringify(c.faces)).join("|");
  assert.notEqual(serialize(viaRow9), serialize(viaRow10));
});
