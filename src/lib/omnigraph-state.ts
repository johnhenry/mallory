/**
 * URL-fragment state codec for the Omnigraph panel -- the unified graphing
 * surface where every graph type from the Graphing and 3D & Surfaces tabs
 * renders on ONE surface (a 2D canvas that upgrades to a 3D scene when any
 * 3D-type item exists).
 *
 * The FULL 11-variant item union is defined here in V1 up front, even
 * though the panel's own dropdown gains types phase by phase (2D core ->
 * 3D core -> exotic) -- a state schema that grew a version per phase would
 * churn through V2/V3 for no benefit, since the strict decoder (null on
 * malformed) never encounters a not-yet-implemented type in a real URL:
 * the UI can't create one until its phase lands. Exhaustive per-variant
 * round-trip tests keep every arm honest from day one.
 *
 * Domain bounds (`tMin`, `uMax`, ...) are STRINGS, not numbers -- they're
 * user-editable text fields, and keeping them as entered (matching
 * ParametricPanel/ImplicitPanel's own string-cell convention) means a
 * half-typed "-" or "1e" survives a URL round trip instead of collapsing
 * to NaN.
 */
import type { AxisChoice } from "./sample-complex-graph.ts";
import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";

export interface OmnigraphViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** y = f(x) curve (Graphing tab's Expression rows). */
export interface OmnigraphExpressionItem {
  type: "expression";
  expr: string;
  color: number;
  visible: boolean;
}

/** x(t), y(t) plane curve. `exprA` = x(t), `exprB` = y(t). */
export interface OmnigraphParametricItem {
  type: "parametric";
  exprA: string;
  exprB: string;
  tMin: string;
  tMax: string;
  color: number;
  visible: boolean;
}

/** r(t) polar curve (t = angle). */
export interface OmnigraphPolarItem {
  type: "polar";
  exprA: string;
  tMin: string;
  tMax: string;
  color: number;
  visible: boolean;
}

/** Implicit equation (e.g. "x^2+y^2=4"), marching-squares sampled. */
export interface OmnigraphImplicitItem {
  type: "implicit";
  expr: string;
  color: number;
  visible: boolean;
}

/**
 * Complex domain coloring f(z) -- renders as a background raster LAYER
 * (layered in list order), the honest degraded form of the Complex plane
 * panel's per-function raster. No `color`: the raster IS the color.
 */
export interface OmnigraphComplexItem {
  type: "complex";
  expr: string;
  visible: boolean;
}

/** Height-field surface z = f(x, y). */
export interface OmnigraphSurfaceItem {
  type: "surface";
  expr: string;
  color: number;
  visible: boolean;
}

/** Parametric surface r(u,v) = (x,y,z). exprA/B/C = x/y/z components. */
export interface OmnigraphParametricSurfaceItem {
  type: "parametricSurface";
  exprA: string;
  exprB: string;
  exprC: string;
  uMin: string;
  uMax: string;
  vMin: string;
  vMax: string;
  color: number;
  visible: boolean;
}

/** Space curve r(t) = (x,y,z). exprA/B/C = x/y/z components. */
export interface OmnigraphSpaceCurveItem {
  type: "spaceCurve";
  exprA: string;
  exprB: string;
  exprC: string;
  tMin: string;
  tMax: string;
  color: number;
  visible: boolean;
}

/** 3D vector field (dx,dy,dz) = F(x,y,z) on a cubic lattice over the shared -5..5 domain. exprA/B/C = dx/dy/dz components. */
export interface OmnigraphVectorField3dItem {
  type: "vectorField3d";
  exprA: string;
  exprB: string;
  exprC: string;
  color: number;
  visible: boolean;
}

/** Complex graph y=f(x) over complex x, plotted onto per-item selectable axes (the ComplexGraph3DPanel's container-level axis machinery, made per-item here). */
export interface OmnigraphComplexGraph3dItem {
  type: "complexGraph3d";
  expr: string;
  axisX: AxisChoice;
  axisY: AxisChoice;
  axisZ: AxisChoice;
  tMin: string;
  tMax: string;
  sweepReX: boolean;
  sweepImX: boolean;
  highlightNearReal: boolean;
  color: number;
  visible: boolean;
}

/** Gradient descent on a loss surface: translucent surface + eager, static descent path (pure runGradientDescent -- no animation in v1). */
export interface OmnigraphGradientDescentItem {
  type: "gradientDescent";
  expr: string;
  startX: string;
  startY: string;
  stepSize: string;
  steps: string;
  color: number;
  visible: boolean;
}

export type OmnigraphItem =
  | OmnigraphExpressionItem
  | OmnigraphParametricItem
  | OmnigraphPolarItem
  | OmnigraphImplicitItem
  | OmnigraphComplexItem
  | OmnigraphSurfaceItem
  | OmnigraphParametricSurfaceItem
  | OmnigraphSpaceCurveItem
  | OmnigraphVectorField3dItem
  | OmnigraphComplexGraph3dItem
  | OmnigraphGradientDescentItem;

export type OmnigraphItemType = OmnigraphItem["type"];

export interface OmnigraphStateV1 {
  version: 1;
  viewport: OmnigraphViewport;
  items: OmnigraphItem[];
}

export type OmnigraphState = OmnigraphStateV1;

export const DEFAULT_OMNIGRAPH_VIEWPORT: OmnigraphViewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };

export const DEFAULT_OMNIGRAPH_STATE: OmnigraphState = {
  version: 1,
  viewport: DEFAULT_OMNIGRAPH_VIEWPORT,
  items: [{ type: "expression", expr: "sin(x)", color: 0x2563eb, visible: true }],
};

export function encodeOmnigraphState(state: OmnigraphState): string {
  return encodeStateFragment(state);
}

const AXIS_CHOICES = new Set<string>(["reX", "imX", "reY", "imY", "none"]);

function isViewport(v: unknown): v is OmnigraphViewport {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.xMin === "number" &&
    typeof o.xMax === "number" &&
    typeof o.yMin === "number" &&
    typeof o.yMax === "number" &&
    [o.xMin, o.xMax, o.yMin, o.yMax].every((n) => Number.isFinite(n))
  );
}

function hasStrings(o: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((k) => typeof o[k] === "string");
}

function hasCommon(o: Record<string, unknown>, withColor: boolean): boolean {
  return typeof o.visible === "boolean" && (!withColor || typeof o.color === "number");
}

function isItem(value: unknown): value is OmnigraphItem {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  switch (o.type) {
    case "expression":
    case "implicit":
    case "surface":
      return hasStrings(o, ["expr"]) && hasCommon(o, true);
    case "complex":
      return hasStrings(o, ["expr"]) && hasCommon(o, false);
    case "parametric":
      return hasStrings(o, ["exprA", "exprB", "tMin", "tMax"]) && hasCommon(o, true);
    case "polar":
      return hasStrings(o, ["exprA", "tMin", "tMax"]) && hasCommon(o, true);
    case "parametricSurface":
      return hasStrings(o, ["exprA", "exprB", "exprC", "uMin", "uMax", "vMin", "vMax"]) && hasCommon(o, true);
    case "spaceCurve":
      return hasStrings(o, ["exprA", "exprB", "exprC", "tMin", "tMax"]) && hasCommon(o, true);
    case "vectorField3d":
      return hasStrings(o, ["exprA", "exprB", "exprC"]) && hasCommon(o, true);
    case "complexGraph3d":
      return (
        hasStrings(o, ["expr", "tMin", "tMax"]) &&
        hasCommon(o, true) &&
        [o.axisX, o.axisY, o.axisZ].every((a) => typeof a === "string" && AXIS_CHOICES.has(a)) &&
        typeof o.sweepReX === "boolean" &&
        typeof o.sweepImX === "boolean" &&
        typeof o.highlightNearReal === "boolean"
      );
    case "gradientDescent":
      return hasStrings(o, ["expr", "startX", "startY", "stepSize", "steps"]) && hasCommon(o, true);
    default:
      return false;
  }
}

/** Returns null on any malformed/unrecognized fragment rather than throwing -- same contract as every other panel codec. */
export function decodeOmnigraphState(fragment: string): OmnigraphState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (typeof parsed !== "object" || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    if (o.version !== 1) return null;
    if (!isViewport(o.viewport)) return null;
    if (!Array.isArray(o.items) || !o.items.every(isItem)) return null;
    return parsed as OmnigraphState;
  } catch {
    return null;
  }
}
