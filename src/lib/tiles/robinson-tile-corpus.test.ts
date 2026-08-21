import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARM2_EDGES,
  ARM3_EDGES,
  ARM4_EDGES,
  ARM5_EDGES,
  BASIC_ARROW_TILES,
  CROSS_EDGES,
  PARITY_TILES,
  arrowEdgeLabel,
  buildRobinsonBaseTiles,
  buildRobinsonTiles,
  isSelfSymmetricUnderReflection,
  rotateEdgeMap90,
  type ArrowEdgeMap,
  type CombinedTile,
} from "./robinson-tile-corpus.ts";

/**
 * These tests document CURRENT (explicitly caveated, not verified-correct)
 * behavior of this generator -- see robinson-tile-corpus.ts's own top doc
 * comment for the open questions. They pin the mechanical parts (counts,
 * id uniqueness) and give real correctness checks on the expansion logic
 * itself (self-symmetry detection), independent of whether the final
 * color assignment matches Robinson's true 1971 tile set -- it isn't
 * confirmed to, yet.
 */

// A parity component that is unchanged by every rotation/reflection (all
// four sides identical), used to isolate the ARROW map's own symmetry
// from the combined (arrow + parity) symmetry check.
const NEUTRAL_PARITY: ArrowEdgeMap = {
  N: { kind: "gap", pointsToward: "in" },
  E: { kind: "gap", pointsToward: "in" },
  S: { kind: "gap", pointsToward: "in" },
  W: { kind: "gap", pointsToward: "in" },
};

function asCombined(id: string, arrow: ArrowEdgeMap): CombinedTile {
  return { id, arrow, parity: NEUTRAL_PARITY };
}

test("buildRobinsonBaseTiles: produces exactly the paper's own claimed 10 basic-tiles-with-parity-markings, with unique ids", () => {
  const base = buildRobinsonBaseTiles();
  assert.equal(base.length, 10);
  assert.equal(new Set(base.map((t) => t.id)).size, 10);
});

test("buildRobinsonTiles: produces a set with unique ids, one per deduplicated combined tile", () => {
  const tiles = buildRobinsonTiles();
  assert.equal(new Set(tiles.map((t) => t.id)).size, tiles.length);
  assert.ok(tiles.length > 0);
});

test("buildRobinsonTiles: current best-effort data produces 48 tiles, NOT the paper's own claimed 56 -- pinned so this doesn't silently drift, and so the gap is visible to whoever picks up the open questions", () => {
  const tiles = buildRobinsonTiles();
  // NOTE: this is a snapshot of CURRENT (known-incomplete) output, not a
  // claim that 48 is correct. Distinguishing all 4 arm tiles (formerly
  // arm2==arm3, arm4==arm5) raised this from a prior 32 -- confirming that
  // WAS suppressing real distinct tiles -- but 48 still falls short of 56.
  // The remaining shortfall is explained by the "5 of 5 self-symmetric"
  // test below: the paper claims only 3 of the 5 basic tiles have an axis
  // of symmetry, but all 5 still come out symmetric under this encoding
  // even after the arm-tile fix, since W and E are still modeled as
  // literally the same value on every arm tile -- trivially left-right
  // symmetric regardless of principal-axis doubling. That's a SEPARATE,
  // still-open detail (not the same gap the arm-tile fix addressed) --
  // most likely some genuine W-vs-E difference on 2 of the 4 arms remains
  // unencoded. If a future fix changes this number, update the assertion
  // and explain why.
  assert.equal(tiles.length, 48);
});

test("buildRobinsonTiles: is deterministic across repeated calls", () => {
  const a = buildRobinsonTiles();
  const b = buildRobinsonTiles();
  assert.deepEqual(
    a.map((t) => t.edges),
    b.map((t) => t.edges),
  );
});

test("isSelfSymmetricUnderReflection: current encoding STILL finds ALL 5 basic arrow tiles reflection-fixed, NOT the 3 the paper's own text claims -- unaffected by the arm-tile doubling fix, so this is a genuinely SEPARATE open detail", () => {
  const results = BASIC_ARROW_TILES.map((t) => ({ id: t.id, symmetric: isSelfSymmetricUnderReflection(asCombined(t.id, t.edges)) }));
  const symmetricCount = results.filter((r) => r.symmetric).length;
  // Every arm tile's perpendicular (W/E) in-arrows are still modeled as
  // the literal SAME `ArrowEdge` value on both sides (see `armEdges`),
  // which is inherently left-right symmetric regardless of how the
  // principal (S) axis is doubled -- so distinguishing the 4 arm tiles
  // via principal-doubling (the fix this file's doc comment describes as
  // "resolved") did NOT change this count, confirming it's a genuinely
  // different, still-unencoded W-vs-E asymmetry on 2 of the 4 arms, not a
  // second symptom of the same doubling gap. This test pins the CURRENT,
  // known-incomplete count rather than the paper's claimed one, per this
  // session's convention of not silently forcing agreement with
  // unconfirmed data.
  assert.equal(symmetricCount, 5, `expected all 5 basic tiles self-symmetric under the current (incomplete) encoding, got: ${JSON.stringify(results)}`);
});

test("isSelfSymmetricUnderReflection: is a real check, not a tautology -- a deliberately asymmetric hand-built tile is correctly detected as NOT self-symmetric", () => {
  const lopsided: ArrowEdgeMap = {
    N: { kind: "marked", multiplicity: "double", polarity: "bump", offset: "E" },
    E: { kind: "marked", multiplicity: "single", polarity: "dent" },
    S: { kind: "marked", multiplicity: "single", polarity: "bump" },
    W: { kind: "marked", multiplicity: "single", polarity: "dent" },
  };
  assert.equal(isSelfSymmetricUnderReflection(asCombined("lopsided", lopsided)), false);
});

test("isSelfSymmetricUnderReflection: a fully uniform tile (identical marking on all four sides) is trivially self-symmetric", () => {
  const uniform: ArrowEdgeMap = {
    N: { kind: "marked", multiplicity: "single", polarity: "bump" },
    E: { kind: "marked", multiplicity: "single", polarity: "bump" },
    S: { kind: "marked", multiplicity: "single", polarity: "bump" },
    W: { kind: "marked", multiplicity: "single", polarity: "bump" },
  };
  assert.equal(isSelfSymmetricUnderReflection(asCombined("uniform", uniform)), true);
});

test("resolved (formerly open question 1): all 4 arm tiles are now structurally distinct, per the confirmed {perpendicular, principal} doubling matrix", () => {
  const arms = [ARM2_EDGES, ARM3_EDGES, ARM4_EDGES, ARM5_EDGES];
  const keys = arms.map((a) => JSON.stringify(a));
  assert.equal(new Set(keys).size, 4, "expected all 4 arm tiles to be pairwise distinct");
  // Spot-check the specific matrix cells rather than just "all different":
  // ARM2/ARM4 share principal-doubling (S), ARM3/ARM5 don't.
  assert.deepEqual(ARM2_EDGES.S, { kind: "marked", multiplicity: "double", polarity: "bump", offset: "parallel" });
  assert.deepEqual(ARM4_EDGES.S, { kind: "marked", multiplicity: "double", polarity: "bump", offset: "parallel" });
  assert.deepEqual(ARM3_EDGES.S, { kind: "marked", multiplicity: "single", polarity: "bump", offset: undefined });
  assert.deepEqual(ARM5_EDGES.S, { kind: "marked", multiplicity: "single", polarity: "bump", offset: undefined });
});

test("known contradiction (open question 1): PARITY_TILES.UL is NOT a 90-degree rotation of PARITY_TILES.LR in the current transcription, even though the paper's own text says it should be", () => {
  const rotatedLR = rotateEdgeMap90(rotateEdgeMap90(PARITY_TILES.LR));
  // Two 90-degree rotations = 180 degrees; even allowing for a possible
  // orientation mismatch between "our" rotation direction and the
  // paper's own, UL and LR should agree on *something* structural (which
  // edge-pair touches the boundary) if they were truly related by a
  // symmetry of the square. They don't: both this rotation AND the raw
  // LR value have W/E touching (marked) and N/S as a gap, same as UL --
  // so the mismatch isn't a simple direction-convention bug, it's a
  // genuine content difference (bump vs dent) documented in the file's
  // own doc comment.
  assert.equal(PARITY_TILES.UL.W.kind, "marked");
  assert.equal(rotatedLR.W.kind, "marked");
  if (PARITY_TILES.UL.W.kind === "marked" && rotatedLR.W.kind === "marked") {
    assert.notEqual(
      PARITY_TILES.UL.W.polarity,
      rotatedLR.W.polarity,
      "expected UL and a 180-rotated LR to still disagree in polarity, pinning the currently-unresolved contradiction",
    );
  }
});

test("CROSS_EDGES: label round-trips through arrowEdgeLabel without throwing, for every direction", () => {
  for (const edge of Object.values(CROSS_EDGES)) {
    assert.equal(typeof arrowEdgeLabel(edge), "string");
  }
});
