import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
import { isAxisChoice, type AxisChoice } from "./sample-complex-graph.ts";

/**
 * URL-state schema for ComplexGraph3DPanel. v1 (issue #345) was a single
 * complex-graph curve, not yet multi-row -- the design explicitly deferred
 * "another row" until the always-grid-sample/auto-detect redesign (this
 * file's own v1 comment history) settled what a row even means once the
 * strict curve-only constraint was gone.
 *
 * v2 lifts that: unlimited y=f(x) functions (`rows`), sharing ONE set of
 * screen axes (`axisX`/`axisY`/`axisZ` stay panel-level, not per-row) -- the
 * point is comparing several functions against the same view, the same way
 * SpaceCurvePanel's issue #251 upgrade added unlimited curves. Each row
 * gets its own `color`/`visible` (mirroring every other multi-row panel's
 * row shape) plus its own `tMin`/`tMax`, since different functions often
 * want different sweep ranges even while sharing axes.
 *
 * Each axis is `AxisChoice` (a real component, or `"none"`) -- see
 * sample-complex-graph.ts's own top comment: any of the 4 real components
 * may be assigned to any axis, or left unassigned, with the render mode
 * (curve vs. scatter) auto-detected per row from how many domain
 * components (Re(x)/Im(x)) end up used.
 */
export interface ComplexGraphStateV1 {
  v: 1;
  yExpr: string;
  axisX: AxisChoice;
  axisY: AxisChoice;
  axisZ: AxisChoice;
  tMin: string;
  tMax: string;
}

/** One function row (v2, multi-function) -- a v1 state's own per-curve fields, plus color/visibility. */
export interface ComplexGraphRowState {
  yExpr: string;
  tMin: string;
  tMax: string;
  color: number;
  visible: boolean;
}

export interface ComplexGraphStateV2 {
  v: 2;
  axisX: AxisChoice;
  axisY: AxisChoice;
  axisZ: AxisChoice;
  rows: ComplexGraphRowState[];
}

/**
 * v3 (issue #365): adds `sweepReX`/`sweepImX`, the explicit "sweep this
 * domain component even if it isn't assigned to a screen axis" toggles --
 * see sample-complex-graph.ts's `DomainSweepFlags`. Shared/container-level
 * like the axis assignment (not per-row): both govern the same "what does
 * the domain sampling actually explore" question the shared curve-vs-
 * scatter render mode already depends on, so every row stays in sync the
 * same way it already does for axis assignment. Default `false` for both
 * matches today's implicit behavior exactly, so existing saved/shared
 * graphs are unaffected by the upgrade.
 */
export interface ComplexGraphStateV3 {
  v: 3;
  axisX: AxisChoice;
  axisY: AxisChoice;
  axisZ: AxisChoice;
  sweepReX: boolean;
  sweepImX: boolean;
  rows: ComplexGraphRowState[];
}

export type ComplexGraphState = ComplexGraphStateV3;

/** y = e^(i*x): the issue's own worked example, so the panel opens already showing the spiral rather than a blank/degenerate default. */
const DEFAULT_ROW: ComplexGraphRowState = {
  yExpr: "exp(i*x)",
  tMin: "0",
  tMax: String(4 * Math.PI),
  color: 0x9333ea,
  visible: true,
};

export const DEFAULT_COMPLEX_GRAPH_STATE: ComplexGraphState = {
  v: 3,
  axisX: "reX",
  axisY: "reY",
  axisZ: "imY",
  sweepReX: false,
  sweepImX: false,
  rows: [DEFAULT_ROW],
};

function upgradeV1ToV2(v1: ComplexGraphStateV1): ComplexGraphStateV2 {
  return {
    v: 2,
    axisX: v1.axisX,
    axisY: v1.axisY,
    axisZ: v1.axisZ,
    rows: [{ yExpr: v1.yExpr, tMin: v1.tMin, tMax: v1.tMax, color: 0x9333ea, visible: true }],
  };
}

function upgradeV2ToV3(v2: ComplexGraphStateV2): ComplexGraphStateV3 {
  return { ...v2, v: 3, sweepReX: false, sweepImX: false };
}

export function encodeComplexGraphState(state: ComplexGraphState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeComplexGraphState(fragment: string): ComplexGraphState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isComplexGraphStateV3(parsed)) return parsed;
    if (isComplexGraphStateV2(parsed)) return upgradeV2ToV3(parsed);
    if (isComplexGraphStateV1(parsed)) return upgradeV2ToV3(upgradeV1ToV2(parsed));
    return null;
  } catch {
    return null;
  }
}

export function isComplexGraphStateV1(value: unknown): value is ComplexGraphStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.yExpr === "string" &&
    isAxisChoice(v.axisX) &&
    isAxisChoice(v.axisY) &&
    isAxisChoice(v.axisZ) &&
    typeof v.tMin === "string" &&
    typeof v.tMax === "string"
  );
}

function hasValidRows(v: Record<string, unknown>): boolean {
  if (!Array.isArray(v.rows)) return false;
  return v.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return typeof r.yExpr === "string" && typeof r.tMin === "string" && typeof r.tMax === "string" && typeof r.color === "number" && typeof r.visible === "boolean";
  });
}

export function isComplexGraphStateV2(value: unknown): value is ComplexGraphStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 2 && isAxisChoice(v.axisX) && isAxisChoice(v.axisY) && isAxisChoice(v.axisZ) && hasValidRows(v);
}

export function isComplexGraphStateV3(value: unknown): value is ComplexGraphStateV3 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 3 &&
    isAxisChoice(v.axisX) &&
    isAxisChoice(v.axisY) &&
    isAxisChoice(v.axisZ) &&
    typeof v.sweepReX === "boolean" &&
    typeof v.sweepImX === "boolean" &&
    hasValidRows(v)
  );
}
