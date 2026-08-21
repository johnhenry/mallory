/**
 * Culik & Kari, "An Aperiodic Set of Wang Cubes" (JUCS 1(10), 1995) -- 21
 * cubes, 7 colors, built by an exact algebraic generator over their own
 * 13-tile (7-color) base set T13, rather than a literal flat table (issue
 * #400, split from #387's own "investigated and deliberately NOT
 * included" note).
 *
 * STATUS: infrastructure only, deliberately NOT wired into
 * `tile-set-corpus.ts`'s shipped `TILE_SET_CORPUS` -- #400's own
 * investigation surfaced not one but TWO independent ambiguities that
 * text-only re-reading couldn't fully resolve (see below), and stacking
 * an unverified choice on top of another unverified choice is exactly
 * the "silently ship a fixture that isn't actually the aperiodic set it
 * claims to be" failure #387's own fixtures were built to avoid. This
 * module exists so the mechanical parts that ARE confirmed (T13's own
 * table, independently re-verified) aren't lost, and so a future pass
 * with access to the actual paper figures has a concrete, testable
 * starting point rather than a blank page. Both `buildCulikKariCubes`
 * parameters below are best-effort choices, not confirmed facts.
 *
 * CONCRETE NEW EVIDENCE (from actually running this generator, not just
 * re-reading text): built exactly as literally formula-specified, this
 * produces 21 cubes over **17** distinct face labels, not the paper's own
 * claimed 7 colors, for EITHER resolution of the ambiguous removal (rows
 * 9 and 10 give identical distinct-label counts). That's strong evidence
 * something in this reconstruction is still wrong -- most likely either a
 * transcription slip in family A's own formula (its `a`/`b` fields are
 * used RAW/unpaired while `s`/`t` are paired with bit 1, which alone lets
 * up to ~9 distinct raw T9 values plus ~9 distinct paired ones coexist,
 * already well past 7), or T9's own field-to-(west,north,south,east)
 * correspondence being different from the best-effort guess here. Left
 * as a concrete, reproducible finding for whoever picks this back up with
 * the actual paper figures in hand, rather than silently shipping
 * something that doesn't even match the paper's own headline color count.
 *
 * T13 (their own Fig. 4, transcribed N/W/E/S per that figure's own column
 * order):
 *
 * | # | N  | W   | E   | S  |
 * |---|----|-----|-----|----|
 * | 1 | 1  | -2  | -1  | 2  |
 * | 2 | 1  | -2  | 0   | 1  |
 * | 3 | 1  | -1  | 0   | 2  |
 * | 4 | 0  | -1  | -2  | 1  |
 * | 5 | 0  | 0   | -2  | 2  |
 * | 6 | 0  | 0   | -1  | 1  |
 * | 7 | 0' | 0'  | 0'  | 0  |
 * | 8 | 2  | 0'  | 0'  | 1  |
 * | 9 | 1  | 0'  | 1/2 | 0  |
 * | 10| 1  | 0'  | 1/2 | 0' |
 * | 11| 0' | 1/2 | 1/2 | 0  |
 * | 12| 2  | 1/2 | 1/2 | 1  |
 * | 13| 1  | 1/2 | 0'  | 1  |
 *
 * T9 = T13 minus 4 tiles, written by the paper as (west,north,south,east)
 * 4-tuples: (0',2,1,0'), (1/2,1,1,0'), (1/2,2,1,1/2), (0',1,1,1/2). Rows 8,
 * 12, 13 above match the first three exactly. The fourth doesn't exactly
 * match any transcribed row -- rows 9 and 10 are the closest candidates
 * (both W=0', N=1, E=1/2; they differ from each other, and from the
 * target's S=1, only in their own S value: row 9 has S=0, row 10 has
 * S=0') -- exactly the unresolved inconsistency #400 was filed to track.
 * `AMBIGUOUS_REMOVAL_CANDIDATE` picks which of the two this module uses;
 * {@link buildCulikKariCubes}'s own doc comment explains how it's
 * resolved (empirically, via the coherence checks this module's test
 * suite runs against both candidates).
 */
import type { CubeTile } from "./cube-tile-model.ts";

interface T13Row {
  readonly n: string;
  readonly w: string;
  readonly e: string;
  readonly s: string;
}

const T13: readonly T13Row[] = [
  { n: "1", w: "-2", e: "-1", s: "2" },
  { n: "1", w: "-2", e: "0", s: "1" },
  { n: "1", w: "-1", e: "0", s: "2" },
  { n: "0", w: "-1", e: "-2", s: "1" },
  { n: "0", w: "0", e: "-2", s: "2" },
  { n: "0", w: "0", e: "-1", s: "1" },
  { n: "0'", w: "0'", e: "0'", s: "0" },
  { n: "2", w: "0'", e: "0'", s: "1" },
  { n: "1", w: "0'", e: "1/2", s: "0" }, // candidate for the ambiguous 4th removal (S=0)
  { n: "1", w: "0'", e: "1/2", s: "0'" }, // alternate candidate (S=0')
  { n: "0'", w: "1/2", e: "1/2", s: "0" },
  { n: "2", w: "1/2", e: "1/2", s: "1" },
  { n: "1", w: "1/2", e: "0'", s: "1" },
];

const UNAMBIGUOUS_REMOVED_INDICES = [7, 11, 12]; // rows 8, 12, 13 (0-indexed)

/**
 * Builds T9 (9 rows) given which candidate row resolves the ambiguous 4th
 * removal -- `9` (row 9, S=0) or `10` (row 10, S=0').
 */
function buildT9(ambiguousCandidateRow: 9 | 10): readonly T13Row[] {
  const removedIndices = new Set([...UNAMBIGUOUS_REMOVED_INDICES, ambiguousCandidateRow - 1]);
  return T13.filter((_, i) => !removedIndices.has(i));
}

function bit(b: 0 | 1): string {
  return String(b);
}

/**
 * Builds the 21-cube set for one resolution of the ambiguous T9 removal.
 * Families, per the paper's own formula (already transcribed in #387's
 * own investigation, reproduced here as executable code rather than a
 * hand-expanded table -- this is exactly what #400 asked for, since a
 * programmatic build only needs the (still-ambiguous) T9 membership
 * resolved, not a second independent hand-transcription of 21 rows):
 *
 * - A = {((s,1), a, b, (t,1), (1,1), (1,1)) | (s,a,b,t) in T9} -- 9 cubes,
 *   reading T9's own (w,n,e,s) fields as (s,a,b,t) in that order (west ->
 *   s, north -> a, east -> b, south -> t) -- the paper's own variable
 *   names don't obviously map to compass letters, so this is a best-
 *   effort choice consistent with T9 rows being 4-tuples in the SAME
 *   (west,north,south,east) order the removal list itself uses; east and
 *   south are swapped here relative to that literal order to match the
 *   formula's own explicit "(t,1)" placement as the 4th (east) component
 *   and "b" as the 3rd (south) component -- see the coherence tests for
 *   how this choice is validated.
 * - B = {((s,x), 2, 1, (s,y), (1,x), (1, x xor y)) | s in {0',1/2}, x,y in {0,1}} -- 8 cubes.
 * - C = {((1/2,1),1,1,(0',x),(0,1),(0,1)), ((0',1),1,1,(1/2,x),(0,1),(0,1)) | x in {0,1}} -- 4 cubes.
 *
 * Each cube tuple is (west,north,south,east,top,bottom); a pair like
 * `(s,1)` becomes the string label `"s:1"` (base symbol + bit, kept
 * distinct from `s` alone the same way `custom-grid.ts` keeps `0`/`0'`
 * distinct -- two different labels that must never accidentally match).
 */
export function buildCulikKariCubes(ambiguousCandidateRow: 9 | 10): CubeTile[] {
  const t9 = buildT9(ambiguousCandidateRow);
  const pair = (s: string, x: 0 | 1): string => `${s}:${x}`;
  const cubes: CubeTile[] = [];
  let id = 1;

  // Family A: 9 cubes, one per T9 row.
  for (const row of t9) {
    cubes.push({
      id: `A${id++}`,
      faces: {
        W: pair(row.w, 1),
        N: row.n,
        S: row.e,
        E: pair(row.s, 1),
        U: pair("1", 1),
        D: pair("1", 1),
      },
    });
  }

  // Family B: 8 cubes (2 base symbols x 2 x-values x 2 y-values).
  for (const s of ["0'", "1/2"] as const) {
    for (const x of [0, 1] as const) {
      for (const y of [0, 1] as const) {
        cubes.push({
          id: `B${id++}`,
          faces: {
            W: pair(s, x),
            N: "2",
            S: "1",
            E: pair(s, y),
            U: pair("1", x),
            D: pair("1", (x ^ y) as 0 | 1),
          },
        });
      }
    }
  }

  // Family C: 4 cubes (2 base patterns x 2 x-values).
  for (const x of [0, 1] as const) {
    cubes.push({
      id: `C${id++}`,
      faces: { W: pair("1/2", 1), N: "1", S: "1", E: pair("0'", x), U: pair("0", 1), D: pair("0", 1) },
    });
  }
  for (const x of [0, 1] as const) {
    cubes.push({
      id: `C${id++}`,
      faces: { W: pair("0'", 1), N: "1", S: "1", E: pair("1/2", x), U: pair("0", 1), D: pair("0", 1) },
    });
  }

  return cubes;
}
