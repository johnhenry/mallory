import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
export type CaDimension = "1d" | "2d" | "3d";
export type Boundary1D = "zero" | "wrap";
export type Boundary2D = "dead" | "wrap";
export type Boundary3D = "dead" | "wrap";
/** "custom" (issue #260 item 1) pairs with `customGrid1d`/`customGrid2d` below -- a '0'/'1' bitstring a `CustomGridEditor` painted (see src/lib/ca/custom-grid.ts's own doc comment for the encoding). */
export type InitialCondition1D = "single-cell" | "random" | "custom";
export type InitialCondition2D = "random" | "custom";
export type InitialCondition3D = "random" | "custom";

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
  // 3D (totalistic) params -- see src/lib/ca/totalistic-3d.ts. Density/seed
  // feed `randomGrid3D`; there's no "single cell" analogue that's
  // interesting in 3D the way 1D's is, so this reuses 2D's initial2d-style
  // random/custom toggle instead (added in V2, see `initial3d` below).
  rule3d: string;
  width3d: number;
  height3d: number;
  depth3d: number;
  generations3d: number;
  boundary3d: Boundary3D;
  seed3d: number;
  density3d: number;
}

/**
 * V2 (issue #389): adds the 3D custom-initial-state painter -- the panel's
 * own "the custom initial-state editor isn't available for 3D yet" note
 * this issue asked to close. `initial3d` mirrors `initial2d`'s
 * random/custom toggle; `customGrid3d` is a flat '0'/'1' bitstring over the
 * whole `width3d`x`height3d`x`depth3d` volume, z-major (see
 * `custom-grid.ts`'s `decodeCustomGrid3D`), painted one layer at a time via
 * the same `CustomGridEditor` the 1D/2D editors already use.
 */
export interface CaStateV2 extends Omit<CaStateV1, "v"> {
  v: 2;
  initial3d: InitialCondition3D;
  customGrid3d: string;
}

export type CaState = CaStateV2;

export const DEFAULT_CA_STATE: CaState = {
  v: 2,
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
  initial3d: "random",
  customGrid3d: "",
};

function upgradeV1ToV2(v1: CaStateV1): CaStateV2 {
  return { ...v1, v: 2, initial3d: "random", customGrid3d: "" };
}

export function encodeCaState(state: CaState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeCaState(fragment: string): CaState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isCaStateV2(parsed)) return parsed;
    if (isCaStateV1(parsed)) return upgradeV1ToV2(parsed);
    return null;
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
const INITIAL_CONDITIONS_3D: InitialCondition3D[] = ["random", "custom"];

function hasCaStateV1Fields(v: Record<string, unknown>): boolean {
  return (
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

export function isCaStateV1(value: unknown): value is CaStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && hasCaStateV1Fields(v);
}

export function isCaStateV2(value: unknown): value is CaStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 2 &&
    hasCaStateV1Fields(v) &&
    typeof v.initial3d === "string" &&
    INITIAL_CONDITIONS_3D.includes(v.initial3d as InitialCondition3D) &&
    typeof v.customGrid3d === "string"
  );
}

