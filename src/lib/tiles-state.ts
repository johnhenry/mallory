import { DEFAULT_CUBE_TILES_TEXT } from "./cube-tile-set-text.ts";
import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
import { DEFAULT_HEX_TILES_TEXT } from "./hex-tile-set-text.ts";
import { DEFAULT_TRI_TILES_TEXT } from "./tri-tile-set-text.ts";
import type { SymmetryGroup } from "./tiles/symmetry.ts";
import { DEFAULT_TILES_TEXT } from "./tile-set-text.ts";

export type TilesSolverKind = "wang" | "torus" | "sat";
export type TilesLattice = "square" | "hex" | "tri" | "cube";

export interface TilesStateV1 {
  v: 1;
  tilesText: string;
  width: number;
  height: number;
  solver: TilesSolverKind;
  showAnimation: boolean;
}

export interface TilesStateV2 {
  v: 2;
  tilesText: string;
  width: number;
  height: number;
  solver: TilesSolverKind;
  showAnimation: boolean;
  /** Symmetry group used to expand the tile set before solving (issue #92 M2). */
  symmetry: SymmetryGroup;
}

export interface TilesStateV3 {
  v: 3;
  tilesText: string;
  width: number;
  height: number;
  solver: TilesSolverKind;
  showAnimation: boolean;
  symmetry: SymmetryGroup;
  /** Which of the 3 tile models is active (issue #92 M3's hex/tri generalization). Symmetry/entropy/diffraction stay square-only. */
  lattice: TilesLattice;
  hexTilesText: string;
  triTilesText: string;
}

export interface TilesStateV4 {
  v: 4;
  tilesText: string;
  width: number;
  height: number;
  solver: TilesSolverKind;
  showAnimation: boolean;
  symmetry: SymmetryGroup;
  lattice: TilesLattice;
  hexTilesText: string;
  triTilesText: string;
  /** Cube lattice (issue #92 M4). `depth` is the cube-only 3rd grid dimension -- width/height cover the other two, matching the square/hex/tri lattices' own dimension naming. */
  cubeTilesText: string;
  depth: number;
}

export type TilesState = TilesStateV4;

export const DEFAULT_TILES_STATE: TilesState = {
  v: 4,
  tilesText: DEFAULT_TILES_TEXT,
  width: 4,
  height: 3,
  solver: "wang",
  showAnimation: true,
  symmetry: "none",
  lattice: "square",
  hexTilesText: DEFAULT_HEX_TILES_TEXT,
  triTilesText: DEFAULT_TRI_TILES_TEXT,
  cubeTilesText: DEFAULT_CUBE_TILES_TEXT,
  depth: 3,
};

export function encodeTilesState(state: TilesState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. Upgrades v1/v2/v3 payloads up to v4 with lattice defaulted to "square" and hex/tri/cube text and depth defaulted. */
export function decodeTilesState(fragment: string): TilesState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isTilesStateV4(parsed)) return parsed;
    if (isTilesStateV3(parsed)) return upgradeV3ToV4(parsed);
    if (isTilesStateV2(parsed)) return upgradeV3ToV4(upgradeV2ToV3(parsed));
    if (isTilesStateV1(parsed)) return upgradeV3ToV4(upgradeV2ToV3({ ...parsed, v: 2, symmetry: "none" }));
    return null;
  } catch {
    return null;
  }
}

function upgradeV2ToV3(v2: TilesStateV2): TilesStateV3 {
  return { ...v2, v: 3, lattice: "square", hexTilesText: DEFAULT_HEX_TILES_TEXT, triTilesText: DEFAULT_TRI_TILES_TEXT };
}

function upgradeV3ToV4(v3: TilesStateV3): TilesStateV4 {
  return { ...v3, v: 4, cubeTilesText: DEFAULT_CUBE_TILES_TEXT, depth: 3 };
}

const SOLVER_KINDS: TilesSolverKind[] = ["wang", "torus", "sat"];
const SYMMETRY_GROUPS: SymmetryGroup[] = ["none", "rotations", "rotations-reflections"];
const LATTICES: TilesLattice[] = ["square", "hex", "tri", "cube"];

function hasCommonFields(v: Record<string, unknown>): boolean {
  return (
    typeof v.tilesText === "string" &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    typeof v.solver === "string" &&
    SOLVER_KINDS.includes(v.solver as TilesSolverKind) &&
    typeof v.showAnimation === "boolean"
  );
}

export function isTilesStateV1(value: unknown): value is TilesStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && hasCommonFields(v);
}

export function isTilesStateV2(value: unknown): value is TilesStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !hasCommonFields(v)) return false;
  return typeof v.symmetry === "string" && SYMMETRY_GROUPS.includes(v.symmetry as SymmetryGroup);
}

export function isTilesStateV3(value: unknown): value is TilesStateV3 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 3 || !hasCommonFields(v)) return false;
  if (!(typeof v.symmetry === "string" && SYMMETRY_GROUPS.includes(v.symmetry as SymmetryGroup))) return false;
  return (
    typeof v.lattice === "string" &&
    LATTICES.includes(v.lattice as TilesLattice) &&
    typeof v.hexTilesText === "string" &&
    typeof v.triTilesText === "string"
  );
}

export function isTilesStateV4(value: unknown): value is TilesStateV4 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 4 || !hasCommonFields(v)) return false;
  if (!(typeof v.symmetry === "string" && SYMMETRY_GROUPS.includes(v.symmetry as SymmetryGroup))) return false;
  if (!(typeof v.lattice === "string" && LATTICES.includes(v.lattice as TilesLattice))) return false;
  return typeof v.hexTilesText === "string" && typeof v.triTilesText === "string" && typeof v.cubeTilesText === "string" && typeof v.depth === "number";
}

