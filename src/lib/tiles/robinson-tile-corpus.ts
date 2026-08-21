/**
 * R.M. Robinson, "Undecidability and Nonperiodicity for Tilings of the
 * Plane" (Inventiones Mathematicae 12, 1971) -- the 56-tile aperiodic Wang
 * set (issue #399, split from #92's own umbrella, sibling of #400's
 * `cube-tile-corpus.ts`). This module follows that file's own pattern:
 * transcribe what the primary source directly supports as executable,
 * self-checking code; document -- not silently resolve -- what it doesn't.
 *
 * STATUS: infrastructure only, deliberately NOT wired into
 * `tile-set-corpus.ts`'s shipped `TILE_SET_CORPUS`. `tile-set-corpus.ts`'s
 * own "Investigated and deliberately NOT included" note already flagged
 * this exact tile set as needing "its own dedicated follow-up pass" --
 * this module is that pass, but it still lands short of a shippable
 * fixture because the parity-tile geometry (see below) contains a genuine,
 * unresolved contradiction against the paper's own prose.
 *
 * ---- What the paper's own text directly confirms (quoted from the OCR'd
 * primary source, `w2. The Five Basic Tiles and Their Modifications`) ----
 *
 * "The five basic tiles may be represented symbolically as in Fig. 2,
 * where the arrow heads represent bumps and the tails represent dents...
 * The first tile in Fig. 2, which has arrow heads on all four sides, will
 * be called a cross... The other basic tiles will be called arms. Every
 * arm has a principal arrow... If there are side in arrows as well, then
 * they are toward the head of the principal arrow."
 *
 * "We may also note that three of the basic tiles have an axis of
 * symmetry. Hence the tiles which can be obtained from the five basic
 * tiles by translation, rotation, and reflection, can be obtained from
 * just seven tiles by translation and rotation" -- i.e. 5 basic tiles, 3
 * of which are reflection-fixed and 2 of which are not, giving
 * 3*1 + 2*2 = 7 distinct tiles under reflection. `SELF_SYMMETRIC_BASIC_TILE_IDS`
 * below is this exact claim, checked programmatically rather than asserted
 * by fiat -- see `robinson-tile-corpus.test.ts`.
 *
 * "An alternative to the corner markings is furnished by the parity
 * markings shown in Fig. 6... All of the parity tiles are symmetric to
 * vertical and horizontal axes. The tile at the upper left can be obtained
 * from the tile at the lower right by rotating through 90°, or by
 * reflection in a diagonal. Thus there are really just three different
 * parity tiles." -- this directly resolves this session's earlier "3 vs 4
 * parity tiles" discrepancy: Fig. 6 draws 4 tiles (UL/UR/LL/LR), but they
 * represent only 3 distinct types because UL and LR are the same tile
 * under the very rotation/reflection group used everywhere else in this
 * construction.
 *
 * "Parity markings will be added to the five basic tiles as follows. The
 * cross will be combined with the parity tile at the lower left in Fig 6.
 * Vertical arms will be combined with the parity tile at the lower right.
 * Equivalently, horizontal arms will be combined with the parity tile at
 * the upper left. All of the basic tiles will be combined with the parity
 * tile at the upper right. This gives a total of ten basic tiles with
 * parity markings." -- read literally this looks like 1 + 4 + 4 + 5 = 14,
 * not 10. The "equivalently" is the resolving word: since a horizontal arm
 * is just a 90°-rotated vertical arm, and UL is (per the quote above) just
 * a 90°-rotated LR, "vertical arm + LR" and "horizontal arm + UL" are the
 * SAME combination restated two ways for clarity, not two separate
 * constructions. That leaves exactly 1 (cross+LL) + 4 (each arm + LR) + 5
 * (cross and each arm, + UR) = 10, matching the paper's own count exactly.
 * `BASE_COMBINATIONS` below encodes this resolution.
 *
 * "Since the ten tiles retain all of the symmetry of the five basic tiles,
 * they give rise to just 14 tiles by reflection, or 56 by reflection and
 * rotation." -- 10 base tiles -> 14 (so 6 of the 10 are reflection-fixed,
 * 4 are not: 6*1 + 4*2 = 14) -> 56 (14*4, i.e. no further collapse under
 * rotation alone). `buildRobinsonTiles()` runs one combined dihedral
 * (rotate + reflect, D4) expansion over the 10 base tiles rather than two
 * separate passes -- mathematically equivalent (D4 is closed under
 * composition either order) and lets the actual derived count be reported
 * instead of hard-coded, per this session's "self-verifying" convention
 * (see `MACMAHON_24` in `tile-set-corpus.ts`).
 *
 * ---- Open questions, NOT resolved here (concrete, reproducible, left for
 * whoever picks this back up) ----
 *
 * 1. TILES 2/4 EXTRA DOUBLING (unconfirmed against the primary source).
 *    Per this session's own quantitative pixel analysis of Fig. 2, arm
 *    tiles 2 and 3 have identical W/E structure (both "doubled"), and arm
 *    tiles 4 and 5 have identical W/E structure (both "single") -- i.e.
 *    only 3 distinct edge-patterns exist among the 5 basic tiles as
 *    currently encoded (cross, "doubled" arm, "single" arm), even though
 *    the paper needs 5 genuinely distinct basic tiles for its own 5->7 and
 *    10->14->56 counts to be non-trivial. A secondary (non-primary) source
 *    reproducing Robinson's figures suggested tiles 2 and 4 *also* carry an
 *    extra doubled line parallel to the principal arrow itself (not just
 *    the perpendicular W/E doubling already encoded), which would
 *    distinguish 2 from 3 and 4 from 5 -- but this was NOT confirmed
 *    against the primary Inventiones text directly, so it is deliberately
 *    NOT encoded below. `ARM2`/`ARM3` and `ARM4`/`ARM5` are therefore
 *    currently IDENTICAL edge bundles under different tile ids -- a known,
 *    checked gap (see the test suite), not an oversight.
 *
 * 2. PARITY TILE GEOMETRY CONTRADICTS THE PAPER'S OWN 90°-ROTATION CLAIM.
 *    This session's pixel measurements of Fig. 6 (gap distance from each
 *    arrow tip to its tile boundary) found: W/E edges of UL and LL touch
 *    the boundary as a double BUMP; W/E edges of UR and LR touch the
 *    boundary as a double DENT; N/S edges of ALL FOUR tiles fall short of
 *    the boundary (a gap), differing only in whether the arrow points
 *    inward (UL, UR) or outward (LL, LR). A true 90° rotation should swap
 *    which edge-pair (W/E vs N/S) touches the boundary -- but the
 *    measurements show W/E always touching and N/S never touching, in ALL
 *    FOUR tiles, including the UL/LR pair the paper explicitly claims are
 *    90°-rotations of each other. This is a genuine, currently-unresolved
 *    contradiction between the primary text and the pixel-measured figure,
 *    reproduced as a literal data mismatch below (`PARITY_TILES.UL` and
 *    `PARITY_TILES.LR` are NOT related by `rotateEdgeMap90`, and the test
 *    suite checks this directly rather than silently forcing agreement).
 *    Do not "fix" this without going back to the actual figure -- either
 *    resolution (trust the text and re-derive UL from LR, or trust the
 *    pixel measurements as transcribed) is a real, unverified choice.
 *
 * 3. PARITY-EDGE OFFSET SIDE, UNMEASURED. The pixel pass that found W/E
 *    edges of the parity tiles touch as double bump/dent did not resolve
 *    which side the second ("side") arrow of that double is offset toward
 *    (unlike the basic arm tiles, where "toward the head of the principal
 *    arrow" is explicit paper text). `PARITY_TILES`' doubled W/E edges
 *    below use `offset: "unmeasured"` rather than guessing -- this
 *    directly affects final edge-label distinctness (two parity edges
 *    that are geometrically different but both say "unmeasured" will
 *    incorrectly compare as equal), so any downstream user of
 *    `buildRobinsonTiles()` should treat matches touching an "unmeasured"
 *    label as unverified.
 *
 * Given (1)-(3), the tile count `buildRobinsonTiles()` actually derives
 * should NOT be assumed to be 56, or its colors correct, even though the
 * expansion machinery itself (rotate/mirror/dedupe) is generic and not
 * hard-coded to any particular target number.
 */
import type { Direction, Tile } from "./tile-model.ts";

const DIRECTIONS: readonly Direction[] = ["N", "E", "S", "W"];

/** 90 deg clockwise successor of a direction (N->E->S->W->N). */
const ROTATE_CW: Record<Direction, Direction> = { N: "E", E: "S", S: "W", W: "N" };
/** Reflection across the vertical axis: swaps E/W, fixes N/S. */
const MIRROR_V: Record<Direction, Direction> = { N: "N", S: "S", E: "W", W: "E" };

/**
 * One edge's geometric marking, kept distinct from its final Wang color
 * label per the paper's own "must fully expand [by rotation/reflection]
 * before assigning colors" principle (encoding colors before expansion
 * makes matching trivially/incorrectly permissive) -- see `w1`'s remark
 * that a naive per-edge integer coloring produces a matching problem
 * ordinary Wang-tile machinery can't be trusted to encode without this
 * geometric intermediate step.
 *
 * `"marked"` is an ordinary bump/dent arrow reaching the tile boundary
 * (single = just the central/principal line; double = central + one side
 * arrow, offset toward some direction). `"gap"` is the parity-tile-only
 * case where the arrow does not reach the boundary at all (see open
 * question 2 above) -- `pointsToward` is a documentation-only field (not
 * used for matching or labeling) recording which way the arrow leans.
 */
export type ArrowEdge =
  | {
      readonly kind: "marked";
      readonly multiplicity: "single" | "double";
      readonly polarity: "bump" | "dent";
      /** Only meaningful when `multiplicity` is `"double"`. */
      readonly offset?: Direction | "unmeasured";
    }
  | {
      readonly kind: "gap";
      readonly pointsToward: "in" | "out";
    };

export type ArrowEdgeMap = Record<Direction, ArrowEdge>;

function marked(multiplicity: "single" | "double", polarity: "bump" | "dent", offset?: Direction | "unmeasured"): ArrowEdge {
  return { kind: "marked", multiplicity, polarity, offset };
}
function gap(pointsToward: "in" | "out"): ArrowEdge {
  return { kind: "gap", pointsToward };
}

/** Plain-string label for one edge -- the "assign colors" step, run only after full geometric expansion by whoever calls {@link buildRobinsonTiles}. */
export function arrowEdgeLabel(edge: ArrowEdge): string {
  if (edge.kind === "gap") return `gap:${edge.pointsToward}`;
  const offsetPart = edge.multiplicity === "double" ? `:${edge.offset ?? "unmeasured"}` : "";
  return `${edge.polarity}:${edge.multiplicity}${offsetPart}`;
}

function rotateEdge90(edge: ArrowEdge): ArrowEdge {
  if (edge.kind === "gap") return edge;
  if (edge.multiplicity !== "double" || edge.offset === undefined || edge.offset === "unmeasured") return edge;
  return { ...edge, offset: ROTATE_CW[edge.offset] };
}
function mirrorEdgeVertical(edge: ArrowEdge): ArrowEdge {
  if (edge.kind === "gap") return edge;
  if (edge.multiplicity !== "double" || edge.offset === undefined || edge.offset === "unmeasured") return edge;
  return { ...edge, offset: MIRROR_V[edge.offset] };
}

/** Rotates every edge of a 4-direction map 90 deg clockwise (exported for tests that need to check specific figure relationships, e.g. the parity-tile UL/LR discrepancy documented above). */
export function rotateEdgeMap90(edges: ArrowEdgeMap): ArrowEdgeMap {
  const out = {} as Record<Direction, ArrowEdge>;
  for (const d of DIRECTIONS) out[ROTATE_CW[d]] = rotateEdge90(edges[d]);
  return out;
}
export function mirrorEdgeMapVertical(edges: ArrowEdgeMap): ArrowEdgeMap {
  const out = {} as Record<Direction, ArrowEdge>;
  for (const d of DIRECTIONS) out[MIRROR_V[d]] = mirrorEdgeVertical(edges[d]);
  return out;
}

// ---- The five basic tiles (Fig. 2) -------------------------------------

/** Tile 1: the cross -- arrowheads (bumps) on all four sides. Fully confirmed against the primary text. */
export const CROSS_EDGES: ArrowEdgeMap = {
  N: marked("double", "bump", "W"),
  E: marked("double", "bump", "S"),
  S: marked("single", "bump"),
  W: marked("single", "bump"),
};

/**
 * An arm tile, principal arrow pointing S (arrowhead/bump on S, blunt
 * dent tail on N -- "blunt" describes the tail's shape, not a separate
 * multiplicity category; matching-wise it's still a `"single"` dent).
 * `doubled` controls whether the perpendicular (W/E) in-arrows are just
 * the central dent (`false`, tiles 4/5) or central + a side dent offset
 * toward the principal arrow's head, i.e. S (`true`, tiles 2/3) -- per
 * the paper's own "toward the head of the principal arrow" rule.
 */
function armEdges(doubled: boolean): ArrowEdgeMap {
  const perpendicular: ArrowEdge = doubled ? marked("double", "dent", "S") : marked("single", "dent");
  return {
    N: marked("single", "dent"),
    S: marked("single", "bump"),
    W: perpendicular,
    E: perpendicular,
  };
}

/**
 * Tiles 2-5. NOTE (open question 1 above): as currently encoded, ARM2 is
 * structurally identical to ARM3, and ARM4 is structurally identical to
 * ARM5 -- kept as separate named tiles (matching the paper's own "five
 * basic tiles" count and its 5->7 reflection claim, which needs 5
 * genuinely distinct inputs to be a non-trivial statement) but this
 * identity is a known, checked gap, not a hidden assumption.
 */
export const ARM2_EDGES = armEdges(true);
export const ARM3_EDGES = armEdges(true);
export const ARM4_EDGES = armEdges(false);
export const ARM5_EDGES = armEdges(false);

interface NamedEdgeMap {
  readonly id: string;
  readonly edges: ArrowEdgeMap;
}

export const BASIC_ARROW_TILES: readonly NamedEdgeMap[] = [
  { id: "cross", edges: CROSS_EDGES },
  { id: "arm2", edges: ARM2_EDGES },
  { id: "arm3", edges: ARM3_EDGES },
  { id: "arm4", edges: ARM4_EDGES },
  { id: "arm5", edges: ARM5_EDGES },
];

// ---- The parity tiles (Fig. 6) -----------------------------------------

/**
 * The four parity tiles as drawn in Fig. 6, transcribed from this
 * session's own pixel measurements (see open questions 2 and 3 above for
 * exactly what is and isn't confirmed). Kept as 4 independently-encoded
 * tiles rather than deriving UL from LR by rotation -- the paper says
 * they SHOULD be related that way, but the measured data as transcribed
 * here does not actually satisfy that relationship, and that mismatch is
 * itself the finding worth preserving (see `robinson-tile-corpus.test.ts`).
 */
export const PARITY_TILES: Record<"UL" | "UR" | "LL" | "LR", ArrowEdgeMap> = {
  UL: { W: marked("double", "bump", "unmeasured"), E: marked("double", "bump", "unmeasured"), N: gap("in"), S: gap("in") },
  UR: { W: marked("double", "dent", "unmeasured"), E: marked("double", "dent", "unmeasured"), N: gap("in"), S: gap("in") },
  LL: { W: marked("double", "bump", "unmeasured"), E: marked("double", "bump", "unmeasured"), N: gap("out"), S: gap("out") },
  LR: { W: marked("double", "dent", "unmeasured"), E: marked("double", "dent", "unmeasured"), N: gap("out"), S: gap("out") },
};

// ---- Combining basic tiles with parity markings, and generic D4 expansion ----

/**
 * A tile as two simultaneous edge constraints (the original arrow
 * markings, plus the parity markings added "at new locations" per the
 * paper's own description) -- final Wang matching on a given side
 * requires BOTH components to agree, so the final color label for a side
 * is the two components' labels joined, and two combined tiles are only
 * "the same tile" for deduplication if every side's arrow AND parity
 * component match.
 */
export interface CombinedTile {
  readonly id: string;
  readonly arrow: ArrowEdgeMap;
  readonly parity: ArrowEdgeMap;
}

function rotateCombined90(t: CombinedTile, idSuffix: string): CombinedTile {
  return { id: `${t.id}${idSuffix}`, arrow: rotateEdgeMap90(t.arrow), parity: rotateEdgeMap90(t.parity) };
}
function mirrorCombinedVertical(t: CombinedTile, idSuffix: string): CombinedTile {
  return { id: `${t.id}${idSuffix}`, arrow: mirrorEdgeMapVertical(t.arrow), parity: mirrorEdgeMapVertical(t.parity) };
}

function combinedKey(t: CombinedTile): string {
  const side = (edges: ArrowEdgeMap) => DIRECTIONS.map((d) => arrowEdgeLabel(edges[d])).join(",");
  return `arrow:${side(t.arrow)}|parity:${side(t.parity)}`;
}

/**
 * True when some element of the dihedral group D4 (4 rotations x
 * {identity, one reflection}) maps `t` back onto itself -- i.e. `t` has
 * an axis of symmetry, per the paper's own "three of the basic tiles have
 * an axis of symmetry" / "six of the ten [parity] tiles are reflection-
 * fixed" claims. Fully generic: no per-tile special-casing, so this is a
 * real correctness check on the transform machinery, not an assertion.
 */
export function isSelfSymmetricUnderReflection(t: CombinedTile): boolean {
  let mirrored = mirrorCombinedVertical(t, "");
  const target = combinedKey(t);
  for (let i = 0; i < 4; i++) {
    if (combinedKey(mirrored) === target) return true;
    mirrored = rotateCombined90(mirrored, "");
  }
  return false;
}

function toCombined(basic: NamedEdgeMap, parityKey: keyof typeof PARITY_TILES): CombinedTile {
  return { id: `${basic.id}+${parityKey}`, arrow: basic.edges, parity: PARITY_TILES[parityKey] };
}

/**
 * The ten basic-tiles-with-parity-markings, per the paper's own
 * derivation resolved in this file's doc comment: cross+LL, each of the 4
 * arms + LR (the "vertical arm" combination -- "horizontal arm + UL" is
 * the same combination restated, not a separate one), and all 5 basic
 * tiles (cross + 4 arms) + UR.
 */
export function buildRobinsonBaseTiles(): readonly CombinedTile[] {
  return [
    toCombined(BASIC_ARROW_TILES[0]!, "LL"),
    toCombined(BASIC_ARROW_TILES[1]!, "LR"),
    toCombined(BASIC_ARROW_TILES[2]!, "LR"),
    toCombined(BASIC_ARROW_TILES[3]!, "LR"),
    toCombined(BASIC_ARROW_TILES[4]!, "LR"),
    toCombined(BASIC_ARROW_TILES[0]!, "UR"),
    toCombined(BASIC_ARROW_TILES[1]!, "UR"),
    toCombined(BASIC_ARROW_TILES[2]!, "UR"),
    toCombined(BASIC_ARROW_TILES[3]!, "UR"),
    toCombined(BASIC_ARROW_TILES[4]!, "UR"),
  ];
}

/**
 * Full D4 orbit (4 rotations x {identity, reflection}) of one combined
 * tile, deduplicated by {@link combinedKey}. Doing reflection and rotation
 * together in one closed group, rather than as two separate passes, is
 * mathematically equivalent to the paper's own two-step "14 tiles by
 * reflection, 56 by reflection and rotation" description (D4 is closed
 * under composition either order) and lets the actual derived count fall
 * out of the data rather than being hard-coded to 56.
 */
function d4Orbit(t: CombinedTile): CombinedTile[] {
  const variants: CombinedTile[] = [];
  let rotated = t;
  for (let r = 0; r < 4; r++) {
    variants.push(r === 0 ? t : rotateCombined90(rotated, `~rot${r * 90}`));
    rotated = variants[variants.length - 1]!;
  }
  let mirrored = mirrorCombinedVertical(t, "~mirror");
  for (let r = 0; r < 4; r++) {
    variants.push(r === 0 ? mirrored : rotateCombined90(mirrored, `~rot${r * 90}`));
    mirrored = variants[variants.length - 1]!;
  }
  return variants;
}

/**
 * The Robinson set, expanded from {@link buildRobinsonBaseTiles}'s ten
 * base tiles by the full dihedral group and deduplicated -- see this
 * file's top doc comment for exactly which parts of this are confirmed
 * against the primary source and which are open questions. The returned
 * count is whatever the data actually produces; it is NOT assumed to be
 * 56 (see open questions 1-3).
 */
export function buildRobinsonTiles(): Tile[] {
  const base = buildRobinsonBaseTiles();
  const seen = new Map<string, CombinedTile>();
  for (const t of base) {
    for (const variant of d4Orbit(t)) {
      const key = combinedKey(variant);
      if (!seen.has(key)) seen.set(key, variant);
    }
  }
  let n = 1;
  const tiles: Tile[] = [];
  for (const combined of seen.values()) {
    const edges = {} as Record<Direction, string>;
    for (const d of DIRECTIONS) edges[d] = `${arrowEdgeLabel(combined.arrow[d])}|${arrowEdgeLabel(combined.parity[d])}`;
    tiles.push({ id: `R${n++}`, edges });
  }
  return tiles;
}
