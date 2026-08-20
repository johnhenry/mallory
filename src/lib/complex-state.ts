import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for ComplexPanel -- the raw inputs only (see
 * cell-ids.ts's cellIdsComplex); every result cell is purely derived.
 */
export interface ComplexStateV1 {
  v: 1;
  exprText: string;
  probeRe: string;
  probeIm: string;
  showRootsOfUnity: boolean;
  rootsN: string;
}

export type ConformalGridType = "rectangular" | "polar";

export interface ComplexStateV2 {
  v: 2;
  exprText: string;
  probeRe: string;
  probeIm: string;
  showRootsOfUnity: boolean;
  rootsN: string;
  showConformalGrid: boolean;
  conformalGridType: ConformalGridType;
  conformalGridSpacing: string;
}

export interface ComplexStateV3 {
  v: 3;
  exprText: string;
  probeRe: string;
  probeIm: string;
  showRootsOfUnity: boolean;
  rootsN: string;
  showConformalGrid: boolean;
  conformalGridType: ConformalGridType;
  conformalGridSpacing: string;
  showZeros: boolean;
  showPoles: boolean;
}

/**
 * One independent complex function (#336 item 7, unlimited functions):
 * exactly the v3 flat state's own 10 persisted fields, plus color/
 * visibility -- same convention as StatisticsRowState/RegressionRowState.
 * Unlike RegressionPanel/OdeSystemPanel, there's no shared canvas to
 * overlay N functions on here: domain coloring is a per-pixel raster of
 * ONE function, so every function gets its own complete pair of canvases
 * (z-plane + w-plane) rather than a shared viewport overlay -- see
 * cellIdsComplex's own doc comment and ComplexPanel.tsx's `ComplexFunction`
 * sub-component.
 */
export interface ComplexRowState {
  exprText: string;
  probeRe: string;
  probeIm: string;
  showRootsOfUnity: boolean;
  rootsN: string;
  showConformalGrid: boolean;
  conformalGridType: ConformalGridType;
  conformalGridSpacing: string;
  showZeros: boolean;
  showPoles: boolean;
  color: number;
  visible: boolean;
}

/**
 * v4: unlimited independent functions, each fully self-contained (#336
 * item 7) -- no container-level fields beyond the ordered row list itself
 * (tracked at the cell-graph level via cellIdsComplex's own `list`, not
 * part of this serialized shape, same convention as
 * StatisticsStateV2/RegressionStateV2).
 */
export interface ComplexStateV4 {
  v: 4;
  rows: ComplexRowState[];
}

export type ComplexState = ComplexStateV4;

const DEFAULT_ROW: ComplexRowState = {
  exprText: "z^2 + 1",
  probeRe: "1",
  probeIm: "1",
  showRootsOfUnity: true,
  rootsN: "5",
  showConformalGrid: false,
  conformalGridType: "rectangular",
  conformalGridSpacing: "0.5",
  showZeros: false,
  showPoles: false,
  // Matches ComplexGraph3DPanel's own default accent -- these are sibling
  // "complex function" panels.
  color: 0x9333ea,
  visible: true,
};

export const DEFAULT_COMPLEX_STATE: ComplexState = {
  v: 4,
  rows: [DEFAULT_ROW],
};

export function encodeComplexState(state: ComplexState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. Upgrades a v1/v2/v3 payload up to v4 with the newer fields defaulted off. */
export function decodeComplexState(fragment: string): ComplexState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isComplexStateV4(parsed)) return parsed;
    if (isComplexStateV3(parsed)) return upgradeComplexV3ToV4(parsed);
    if (isComplexStateV2(parsed)) return upgradeComplexV3ToV4(upgradeComplexV2ToV3(parsed));
    if (isComplexStateV1(parsed)) return upgradeComplexV3ToV4(upgradeComplexV2ToV3(upgradeComplexV1ToV2(parsed)));
    return null;
  } catch {
    return null;
  }
}

/** Exported for notebook-state.ts's own "complex" block upgrade -- notebook blocks nest this panel's state type directly rather than re-declaring its version history, so they need the same v1->v2 migration this file's own decodeComplexState applies (same pattern as ode-state.ts's exported `upgradeOdeV1ToV2`). */
export function upgradeComplexV1ToV2(v1: ComplexStateV1): ComplexStateV2 {
  return {
    ...v1,
    v: 2,
    showConformalGrid: DEFAULT_ROW.showConformalGrid,
    conformalGridType: DEFAULT_ROW.conformalGridType,
    conformalGridSpacing: DEFAULT_ROW.conformalGridSpacing,
  };
}

/** Exported for notebook-state.ts's own "complex" block upgrade -- see `upgradeComplexV1ToV2`'s doc comment. */
export function upgradeComplexV2ToV3(v2: ComplexStateV2): ComplexStateV3 {
  return {
    ...v2,
    v: 3,
    showZeros: DEFAULT_ROW.showZeros,
    showPoles: DEFAULT_ROW.showPoles,
  };
}

/** Exported for notebook-state.ts's own "complex" block upgrade -- notebook blocks nest this panel's state type directly rather than re-declaring its version history, so they need the same v3->v4 migration this file's own decodeComplexState applies (same pattern as statistics-state.ts's exported `upgradeStatisticsV1ToV2`). */
export function upgradeComplexV3ToV4(v3: ComplexStateV3): ComplexStateV4 {
  return {
    v: 4,
    rows: [
      {
        exprText: v3.exprText,
        probeRe: v3.probeRe,
        probeIm: v3.probeIm,
        showRootsOfUnity: v3.showRootsOfUnity,
        rootsN: v3.rootsN,
        showConformalGrid: v3.showConformalGrid,
        conformalGridType: v3.conformalGridType,
        conformalGridSpacing: v3.conformalGridSpacing,
        showZeros: v3.showZeros,
        showPoles: v3.showPoles,
        color: DEFAULT_ROW.color,
        visible: true,
      },
    ],
  };
}

function hasV1Fields(v: Record<string, unknown>): boolean {
  if (typeof v.showRootsOfUnity !== "boolean") return false;
  const fields = ["exprText", "probeRe", "probeIm", "rootsN"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

function hasV2Fields(v: Record<string, unknown>): boolean {
  if (!hasV1Fields(v)) return false;
  if (typeof v.showConformalGrid !== "boolean" || typeof v.conformalGridSpacing !== "string") return false;
  return v.conformalGridType === "rectangular" || v.conformalGridType === "polar";
}

export function isComplexStateV1(value: unknown): value is ComplexStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && hasV1Fields(v);
}

export function isComplexStateV2(value: unknown): value is ComplexStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 2 && hasV2Fields(v);
}

export function isComplexStateV3(value: unknown): value is ComplexStateV3 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 3 || !hasV2Fields(v)) return false;
  return typeof v.showZeros === "boolean" && typeof v.showPoles === "boolean";
}

function hasV3Fields(v: Record<string, unknown>): boolean {
  if (!hasV2Fields(v)) return false;
  return typeof v.showZeros === "boolean" && typeof v.showPoles === "boolean";
}

export function isComplexStateV4(value: unknown): value is ComplexStateV4 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 4 || !Array.isArray(v.rows)) return false;
  return v.rows.every((r) => {
    if (typeof r !== "object" || r === null) return false;
    const row = r as Record<string, unknown>;
    if (typeof row.color !== "number" || typeof row.visible !== "boolean") return false;
    return hasV3Fields(row);
  });
}

