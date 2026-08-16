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

export type TilesState = TilesStateV1;

export const DEFAULT_TILES_STATE: TilesState = {
  v: 1,
  tilesText: DEFAULT_TILES_TEXT,
  width: 4,
  height: 3,
  solver: "wang",
  showAnimation: true,
};

export function encodeTilesState(state: TilesState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeTilesState(fragment: string): TilesState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isTilesStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const SOLVER_KINDS: TilesSolverKind[] = ["wang", "torus", "sat"];

export function isTilesStateV1(value: unknown): value is TilesStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  if (typeof v.tilesText !== "string") return false;
  if (typeof v.width !== "number" || typeof v.height !== "number") return false;
  if (typeof v.solver !== "string" || !SOLVER_KINDS.includes(v.solver as TilesSolverKind)) return false;
  if (typeof v.showAnimation !== "boolean") return false;
  return true;
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
