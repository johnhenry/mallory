export type CaDimension = "1d" | "2d" | "3d";
export type Boundary1D = "zero" | "wrap";
export type Boundary2D = "dead" | "wrap";
export type Boundary3D = "dead" | "wrap";
/** "custom" (issue #260 item 1) pairs with `customGrid1d`/`customGrid2d` below -- a '0'/'1' bitstring a `CustomGridEditor` painted (see src/lib/ca/custom-grid.ts's own doc comment for the encoding). */
export type InitialCondition1D = "single-cell" | "random" | "custom";
export type InitialCondition2D = "random" | "custom";

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
  /** '0'/'1' bitstring (see src/lib/ca/custom-grid.ts) painted by the 1D `CustomGridEditor` -- only meaningful when `initial1d === "custom"`, but always present (default: the empty string, which decodes to an all-dead row) so the field round-trips cleanly through encode/decode regardless of the active initial condition. */
  customGrid1d: string;
  // 2D (life-like) params
  bsRule: string;
  width2d: number;
  height2d: number;
  generations2d: number;
  boundary2d: Boundary2D;
  /** "random" (the only option before issue #260) or "custom" -- 2D's own `InitialCondition1D`-shaped toggle for the editor below. */
  initial2d: InitialCondition2D;
  seed2d: number;
  density2d: number;
  /** '0'/'1' row-major bitstring (see src/lib/ca/custom-grid.ts) painted by the 2D `CustomGridEditor` -- only meaningful when `initial2d === "custom"`, same always-present-default-empty convention as `customGrid1d`. */
  customGrid2d: string;
  /** Whether the 3D voxel spacetime-stack view is showing (issue #229's own "2D rule's history is naturally a 3D volume" framing) -- off by default since it's the heavier render. */
  showVoxelView: boolean;
  // 3D (totalistic) params -- see src/lib/ca/totalistic-3d.ts. The grid is
  // always randomly seeded (there's no "single cell" analogue that's
  // interesting in 3D the way 1D's is), so it needs its own density/seed
  // rather than reusing 2D's initial1d-style toggle.
  rule3d: string;
  width3d: number;
  height3d: number;
  depth3d: number;
  generations3d: number;
  boundary3d: Boundary3D;
  seed3d: number;
  density3d: number;
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
  customGrid1d: "",
  bsRule: "B3/S23",
  width2d: 40,
  height2d: 40,
  generations2d: 30,
  boundary2d: "dead",
  initial2d: "random",
  seed2d: 1,
  density2d: 0.3,
  customGrid2d: "",
  showVoxelView: false,
  rule3d: "B6/S5,6,7",
  width3d: 10,
  height3d: 10,
  depth3d: 10,
  generations3d: 20,
  boundary3d: "dead",
  seed3d: 1,
  density3d: 0.15,
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

const DIMENSIONS: CaDimension[] = ["1d", "2d", "3d"];
const BOUNDARIES_1D: Boundary1D[] = ["zero", "wrap"];
const BOUNDARIES_2D: Boundary2D[] = ["dead", "wrap"];
const BOUNDARIES_3D: Boundary3D[] = ["dead", "wrap"];
const INITIAL_CONDITIONS_1D: InitialCondition1D[] = ["single-cell", "random", "custom"];
const INITIAL_CONDITIONS_2D: InitialCondition2D[] = ["random", "custom"];

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
    typeof v.customGrid1d === "string" &&
    typeof v.bsRule === "string" &&
    typeof v.width2d === "number" &&
    typeof v.height2d === "number" &&
    typeof v.generations2d === "number" &&
    typeof v.boundary2d === "string" &&
    BOUNDARIES_2D.includes(v.boundary2d as Boundary2D) &&
    typeof v.initial2d === "string" &&
    INITIAL_CONDITIONS_2D.includes(v.initial2d as InitialCondition2D) &&
    typeof v.seed2d === "number" &&
    typeof v.density2d === "number" &&
    typeof v.customGrid2d === "string" &&
    typeof v.showVoxelView === "boolean" &&
    typeof v.rule3d === "string" &&
    typeof v.width3d === "number" &&
    typeof v.height3d === "number" &&
    typeof v.depth3d === "number" &&
    typeof v.generations3d === "number" &&
    typeof v.boundary3d === "string" &&
    BOUNDARIES_3D.includes(v.boundary3d as Boundary3D) &&
    typeof v.seed3d === "number" &&
    typeof v.density3d === "number"
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
