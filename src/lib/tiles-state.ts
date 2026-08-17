import type { SymmetryGroup } from "./tiles/symmetry.ts";
import { DEFAULT_TILES_TEXT } from "./tile-set-text.ts";

export type TilesSolverKind = "wang" | "torus" | "sat";

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

export type TilesState = TilesStateV2;

export const DEFAULT_TILES_STATE: TilesState = {
  v: 2,
  tilesText: DEFAULT_TILES_TEXT,
  width: 4,
  height: 3,
  solver: "wang",
  showAnimation: true,
  symmetry: "none",
};

export function encodeTilesState(state: TilesState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. Upgrades a v1 payload to v2 with symmetry defaulted to "none". */
export function decodeTilesState(fragment: string): TilesState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    if (isTilesStateV2(parsed)) return parsed;
    if (isTilesStateV1(parsed)) return { ...parsed, v: 2, symmetry: "none" };
    return null;
  } catch {
    return null;
  }
}

const SOLVER_KINDS: TilesSolverKind[] = ["wang", "torus", "sat"];
const SYMMETRY_GROUPS: SymmetryGroup[] = ["none", "rotations", "rotations-reflections"];

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

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
