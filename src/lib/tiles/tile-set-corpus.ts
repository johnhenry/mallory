/**
 * Canonical tile-set corpus (issue #387, split from #92's own "Storage"
 * section item 6: "canonical tile-set corpus as a JSON fixture"). Every
 * fixture here was verified against a primary source before being
 * transcribed -- see each one's own doc comment for the citation and
 * exactly how confident the transcription is. Getting a label wrong would
 * silently ship a fixture that LOOKS like it's demonstrating aperiodicity
 * but isn't, so a fixture is only included here when its source was
 * directly readable (not just a tile-count summary) and internally
 * consistent; anything short of that is deliberately left out rather than
 * guessed at -- see the bottom of this file for what was investigated and
 * excluded, and why.
 */
import type { Tile, TileSet } from "./tile-model.ts";
import type { CubeTile, CubeTileSet } from "./cube-tile-model.ts";
import type { SymmetryGroup } from "./symmetry.ts";

export interface CorpusEntry {
  id: string;
  name: string;
  description: string;
  lattice: "square" | "cube";
  /** The symmetry setting this fixture is meant to be loaded with -- most classical sets are defined as translations-only (aperiodic *without* needing rotation/reflection to be added), so "none" unless noted otherwise. */
  recommendedSymmetry: SymmetryGroup;
  tileSet: TileSet | CubeTileSet;
}

function squareTiles(rows: ReadonlyArray<readonly [string, string, string, string, string]>): Tile[] {
  return rows.map(([id, n, e, s, w]) => ({ id, edges: { N: n, E: e, S: s, W: w } }));
}

/**
 * Jeandel & Rao, "An aperiodic set of 11 Wang tiles" (arXiv:1506.06492,
 * 2015; published in Advances in Combinatorics 2021) -- the minimal
 * aperiodic Wang tile set, both bounds (11 tiles, 4 colors) proven
 * optimal by the paper's own exhaustive search. Transcribed directly from
 * Figure 4 ("Wang set 𝒯′, obtained from 𝒯 by collapsing the colors 4 and
 * 0"), page 13 -- this is the 4-color-minimal variant; the paper also
 * gives a 5-color variant 𝒯 (Figure 3) one step earlier in its own
 * construction, not included here since 𝒯′ is what "the Jeandel-Rao
 * tileset" normally refers to.
 */
export const JEANDEL_RAO_11: TileSet = {
  tiles: squareTiles([
    ["1", "1", "1", "1", "3"],
    ["2", "2", "1", "2", "3"],
    ["3", "1", "3", "3", "3"],
    ["4", "0", "2", "1", "2"],
    ["5", "2", "2", "0", "2"],
    ["6", "0", "0", "1", "0"],
    ["7", "1", "3", "2", "0"],
    ["8", "2", "0", "2", "1"],
    ["9", "2", "1", "0", "1"],
    ["10", "3", "3", "2", "1"],
    ["11", "1", "0", "1", "3"],
  ]),
};

/**
 * Kari, "A small aperiodic set of Wang tiles" (Discrete Mathematics 160,
 * 1996), Figure 1, p. 260 -- 14 tiles built from a Mealy machine
 * multiplying Beatty sequences by 2 (group T2, 4 tiles) and by 2/3 (group
 * T2/3, 10 tiles). Transcribed directly from the original scan, in Kari's
 * own column order (N, W, S, E -- NOT this corpus's usual N/E/S/W, since
 * that's the order his own figure lays the tiles out in and re-deriving
 * which physical edge is which was safer done against his own layout).
 * Colors are the rational numbers his construction produces; `0` and `0'`
 * are numerically equal but must stay distinct labels (the paper marks
 * one with a prime specifically to keep them from matching each other) --
 * plain string labels handle this correctly with no special-casing.
 */
export const KARI_14: TileSet = {
  tiles: [
    // T2 group (multiplies by 2): N, S in {0,1,2}; W, E in {-1,0}.
    { id: "1", edges: { N: "1", W: "-1", S: "2", E: "-1" } },
    { id: "2", edges: { N: "1", W: "-1", S: "1", E: "0" } },
    { id: "3", edges: { N: "0", W: "0", S: "1", E: "-1" } },
    { id: "4", edges: { N: "1", W: "0", S: "2", E: "0" } },
    // T2/3 group (multiplies by 2/3): N, S in {0,1,2}; W, E in {0', -1/3, 1/3, 2/3}.
    { id: "5", edges: { N: "2", W: "-1/3", S: "1", E: "0'" } },
    { id: "6", edges: { N: "2", W: "0'", S: "1", E: "1/3" } },
    { id: "7", edges: { N: "2", W: "1/3", S: "1", E: "2/3" } },
    { id: "8", edges: { N: "2", W: "1/3", S: "2", E: "-1/3" } },
    { id: "9", edges: { N: "2", W: "2/3", S: "2", E: "0'" } },
    { id: "10", edges: { N: "1", W: "0'", S: "1", E: "-1/3" } },
    { id: "11", edges: { N: "1", W: "1/3", S: "1", E: "0'" } },
    { id: "12", edges: { N: "1", W: "2/3", S: "1", E: "1/3" } },
    { id: "13", edges: { N: "1", W: "-1/3", S: "0", E: "1/3" } },
    { id: "14", edges: { N: "1", W: "0'", S: "0", E: "2/3" } },
  ],
};

/**
 * Culik, "An aperiodic set of 13 Wang tiles" (Discrete Mathematics 160,
 * 1996) -- 13 tiles, 5 colors, built from an idea by Kari. Culik's own
 * paper was inaccessible directly (paywalled); transcribed instead from
 * Jeandel & Rao's own faithful reproduction (arXiv:1506.06492, Figure 1,
 * p. 5, explicitly captioned "The aperiodic set of 13 tiles obtained by
 * Culik from an idea by Kari"), read directly from the arXiv PDF. Note:
 * Culik & Kari's separate 1995 Wang-CUBES paper reproduces what it calls
 * the same 13-tile set with a DIFFERENT 7-symbol color alphabet -- almost
 * certainly an earlier/unoptimized draft of the same construction,
 * combinatorially equivalent but not the same literal labels. This
 * fixture uses the 5-color version (matches every "13 tiles, 5 colors"
 * secondary description, and is reproduced inside a peer-published,
 * heavily-cited paper) -- do not mix the two color alphabets.
 */
export const CULIK_13: TileSet = {
  tiles: squareTiles([
    ["1", "0", "0'", "0'", "0'"],
    ["2", "1", "0'", "2", "0'"],
    ["3", "0", "1/2", "1", "0'"],
    ["4", "0'", "1/2", "1", "0'"],
    ["5", "0", "1/2", "0'", "1/2"],
    ["6", "1", "1/2", "2", "1/2"],
    ["7", "1", "0'", "1", "1/2"],
    ["8", "2", "1", "1", "0"],
    ["9", "1", "2", "1", "0"],
    ["10", "2", "2", "1", "1"],
    ["11", "1", "0", "0", "1"],
    ["12", "2", "0", "0", "2"],
    ["13", "1", "1", "0", "2"],
  ]),
};

/**
 * MacMahon's three-colored squares ("New Mathematical Pastimes", 1921) --
 * NOT an aperiodicity fixture (a bounded edge-matching puzzle: his own
 * 4x6-board version has 12,261 solutions, first computed by machine in
 * 1964), included as a small, always-solvable demo distinct in kind from
 * the aperiodic sets above. No literal century-old table was sourced or
 * needed -- the set is exactly "every distinct 3-coloring of a square's 4
 * edges, up to rotation (not reflection -- his tiles can be turned but not
 * flipped)", which is fully and unambiguously reconstructible: Burnside's
 * lemma over the rotation group C4 acting on 3^4 colorings gives
 * (81 + 3 + 9 + 3) / 4 = 24 exactly, matching the historically-known count,
 * so this is generated combinatorially rather than transcribed, and
 * self-verifies its own tile count via the assertion below.
 */
export const MACMAHON_24: TileSet = (() => {
  const seen = new Set<string>();
  const tiles: Tile[] = [];
  const colors = ["1", "2", "3"];
  const rotate = (e: [string, string, string, string]): [string, string, string, string] => [e[3], e[0], e[1], e[2]];
  let id = 1;
  for (const n of colors) {
    for (const e of colors) {
      for (const s of colors) {
        for (const w of colors) {
          const edges: [string, string, string, string] = [n, e, s, w];
          const key = edges.join(",");
          if (seen.has(key)) continue;
          let rotated = edges;
          for (let i = 0; i < 4; i++) {
            seen.add(rotated.join(","));
            rotated = rotate(rotated);
          }
          tiles.push({ id: String(id++), edges: { N: edges[0], E: edges[1], S: edges[2], W: edges[3] } });
        }
      }
    }
  }
  if (tiles.length !== 24) throw new Error(`MacMahon generation bug: expected 24 tiles, got ${tiles.length}`);
  return { tiles };
})();

export const TILE_SET_CORPUS: readonly CorpusEntry[] = [
  {
    id: "jeandel-rao-11",
    name: "Jeandel-Rao (11 tiles, 4 colors)",
    description: "The minimal known aperiodic Wang tile set -- both bounds proven optimal (arXiv:1506.06492).",
    lattice: "square",
    recommendedSymmetry: "none",
    tileSet: JEANDEL_RAO_11,
  },
  {
    id: "kari-14",
    name: "Kari (14 tiles, 8 color labels)",
    description: "Aperiodic set built from a Mealy machine multiplying Beatty sequences (Discrete Mathematics 160, 1996) -- the first aperiodicity mechanism not based on self-similar hierarchy.",
    lattice: "square",
    recommendedSymmetry: "none",
    tileSet: KARI_14,
  },
  {
    id: "culik-13",
    name: "Culik (13 tiles, 5 colors)",
    description: "Aperiodic set pushing Kari's own mechanism one tile further (Discrete Mathematics 160, 1996).",
    lattice: "square",
    recommendedSymmetry: "none",
    tileSet: CULIK_13,
  },
  {
    id: "macmahon-24",
    name: "MacMahon's 24 three-colored squares",
    description: 'Not aperiodic -- a classical bounded edge-matching puzzle (1921): every distinct 3-coloring of a square\'s 4 edges up to rotation. A small, always-solvable demo, unlike the aperiodic sets above.',
    lattice: "square",
    recommendedSymmetry: "none",
    tileSet: MACMAHON_24,
  },
];

// ---- Investigated and deliberately NOT included -----------------------
//
// Robinson's 6-tile aperiodic set (Inventiones Mathematicae 12, 1971):
// investigated directly against the original paper. His actual 6 tiles
// are jagged polygons with bump/notch edge profiles AND independent
// corner bump/dent markings -- the paper itself states plainly that this
// "makes a transformation into tiles with colored edges difficult." The
// corner markings in particular are a real extra constraint beyond
// N/E/S/W edge matching that this lab's `Tile` model has no way to
// represent (interestingly, they're much closer in spirit to issue
// #388/#394's corner-tile matching locus than to ordinary Wang edges) --
// encoding them as 4 plain edge colors would silently drop that
// constraint and ship a fixture that isn't actually the aperiodic set it
// claims to be. Robinson's own paper gives a proper reduction to
// genuine colored-edge Wang tiles (10 base tiles, expanded by the full
// dihedral group to 56 tiles) -- a real fixture worth having, but
// transcribing it accurately needs its own dedicated follow-up pass, not
// a guess here.
//
// Culik-Kari's 21 Wang cubes (7 colors, JUCS 1(10), 1995): the paper
// gives an exact algebraic generator (T9 = a 9-tile subset of a 13-tile
// base set, plus two further families A/B/C built by formula) rather
// than a flat table, and cross-checking the paper's own "remove these 4
// tiles" list against the transcribed 13-tile base set surfaced an
// unresolved inconsistency (one of the 4 tiles specified for removal
// doesn't exactly match any transcribed row) -- signal of either a
// transcription slip in the base 13-tile table or a subtlety in how the
// generator's tuples map onto it. Rather than ship a cube fixture built
// on top of an unresolved discrepancy, this is left out until that's
// pinned down -- likely needs the generator implemented and cross-checked
// programmatically rather than hand-expanded.
