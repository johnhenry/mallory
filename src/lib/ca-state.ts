export type CaDimension = "1d" | "2d";
export type Boundary1D = "zero" | "wrap";
export type Boundary2D = "dead" | "wrap";
export type InitialCondition1D = "single-cell" | "random";

export interface CaStateV1 {
  v: 1;
  dimension: CaDimension;
  // 1D (elementary) params
  ruleNumber: number;
  width1d: number;
  generations1d: number;
  boundary1d: Boundary1D;
  initial1d: InitialCondition1D;
  seed1d: number;
  // 2D (life-like) params
  bsRule: string;
  width2d: number;
  height2d: number;
  generations2d: number;
  boundary2d: Boundary2D;
  seed2d: number;
  density2d: number;
  /** Whether the 3D voxel spacetime-stack view is showing (issue #229's own "2D rule's history is naturally a 3D volume" framing) -- off by default since it's the heavier render. */
  showVoxelView: boolean;
}

export type CaState = CaStateV1;

export const DEFAULT_CA_STATE: CaState = {
  v: 1,
  dimension: "1d",
  ruleNumber: 30,
  width1d: 101,
  generations1d: 60,
  boundary1d: "zero",
  initial1d: "single-cell",
  seed1d: 1,
  bsRule: "B3/S23",
  width2d: 40,
  height2d: 40,
  generations2d: 30,
  boundary2d: "dead",
  seed2d: 1,
  density2d: 0.3,
  showVoxelView: false,
};

export function encodeCaState(state: CaState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeCaState(fragment: string): CaState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isCaStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const DIMENSIONS: CaDimension[] = ["1d", "2d"];
const BOUNDARIES_1D: Boundary1D[] = ["zero", "wrap"];
const BOUNDARIES_2D: Boundary2D[] = ["dead", "wrap"];
const INITIAL_CONDITIONS_1D: InitialCondition1D[] = ["single-cell", "random"];

export function isCaStateV1(value: unknown): value is CaStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.dimension === "string" &&
    DIMENSIONS.includes(v.dimension as CaDimension) &&
    typeof v.ruleNumber === "number" &&
    typeof v.width1d === "number" &&
    typeof v.generations1d === "number" &&
    typeof v.boundary1d === "string" &&
    BOUNDARIES_1D.includes(v.boundary1d as Boundary1D) &&
    typeof v.initial1d === "string" &&
    INITIAL_CONDITIONS_1D.includes(v.initial1d as InitialCondition1D) &&
    typeof v.seed1d === "number" &&
    typeof v.bsRule === "string" &&
    typeof v.width2d === "number" &&
    typeof v.height2d === "number" &&
    typeof v.generations2d === "number" &&
    typeof v.boundary2d === "string" &&
    BOUNDARIES_2D.includes(v.boundary2d as Boundary2D) &&
    typeof v.seed2d === "number" &&
    typeof v.density2d === "number" &&
    typeof v.showVoxelView === "boolean"
  );
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
