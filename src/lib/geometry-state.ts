import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for GeometryPanel -- unlike every other panel's flat
 * free-cell dump, this is a **replay-based (construction-log) schema**:
 * Reflect/Rotate/Translate/Scale results are `graph.define`d dependent
 * points with no free cell to serialize -- only the *construction call
 * itself* (tool + args) is reconstructable state. So instead of dumping
 * cell values, this records the ordered sequence of `add*` calls
 * (GeometryPanel.tsx) and replays them, in order, through the real `add*`
 * functions on decode -- reconstructing the full dependent-cell graph
 * exactly as it was built interactively. Each op carries the object's
 * original id so cross-references (a line's `a`/`b`, a reflection's
 * `source`/`center`, ...) resolve correctly on replay.
 */
export interface GeometryOpPoint {
  tool: "point";
  id: string;
  x: number;
  y: number;
}
export interface GeometryOpLine {
  tool: "line";
  id: string;
  a: string;
  b: string;
  /** #336 item 2: omitted (not merely undefined -- never written to the encoded op) unless the user explicitly recolored this line, so an un-recolored line keeps following the theme-aware default color rather than freezing whatever theme was active at construction time. */
  color?: string;
}
export interface GeometryOpCircle {
  tool: "circle";
  id: string;
  center: string;
  radiusPoint: string;
  /** See GeometryOpLine.color's doc comment -- same "omitted means auto" convention. */
  color?: string;
}
export interface GeometryOpReflection {
  tool: "reflection";
  id: string;
  source: string;
  center: string;
}
export interface GeometryOpRotation {
  tool: "rotation";
  id: string;
  source: string;
  center: string;
  angleDegrees: number;
}
export interface GeometryOpTranslation {
  tool: "translation";
  id: string;
  source: string;
  dx: number;
  dy: number;
}
export interface GeometryOpScale {
  tool: "scale";
  id: string;
  source: string;
  center: string;
  factor: number;
}
export interface GeometryOpAngle {
  tool: "angle";
  id: string;
  a: string;
  vertex: string;
  c: string;
}
export interface GeometryOpPolygon {
  tool: "polygon";
  id: string;
  points: string[];
  /** See GeometryOpLine.color's doc comment -- same "omitted means auto" convention. */
  color?: string;
}
/**
 * A point anchored to a specific spot on an existing circle or line --
 * `target` is that circle's/line's own id, `param` is an angle in radians
 * (circle) or a 0..1 fraction along the segment (line); which one applies
 * is derived from what `target` currently is, not stored separately.
 * Dragging this point moves it ALONG the constraint (re-solving `param`
 * from the drag position) rather than freely in 2D -- see
 * GeometryPanel.tsx's `dragAnchorToTarget`.
 */
export interface GeometryOpAnchor {
  tool: "anchor";
  id: string;
  target: string;
  param: number;
}

export type GeometryOp =
  | GeometryOpPoint
  | GeometryOpLine
  | GeometryOpCircle
  | GeometryOpReflection
  | GeometryOpRotation
  | GeometryOpTranslation
  | GeometryOpScale
  | GeometryOpAngle
  | GeometryOpPolygon
  | GeometryOpAnchor;

export interface GeometryStateV1 {
  v: 1;
  ops: GeometryOp[];
}

export type GeometryState = GeometryStateV1;

export const DEFAULT_GEOMETRY_STATE: GeometryState = { v: 1, ops: [] };

export function encodeGeometryState(state: GeometryState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeGeometryState(fragment: string): GeometryState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    return isGeometryStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

function isGeometryOp(value: unknown): value is GeometryOp {
  if (typeof value !== "object" || value === null) return false;
  const op = value as Record<string, unknown>;
  if (!isString(op.id)) return false;
  switch (op.tool) {
    case "point":
      return isNumber(op.x) && isNumber(op.y);
    case "line":
      return isString(op.a) && isString(op.b) && (op.color === undefined || isString(op.color));
    case "circle":
      return isString(op.center) && isString(op.radiusPoint) && (op.color === undefined || isString(op.color));
    case "reflection":
      return isString(op.source) && isString(op.center);
    case "rotation":
      return isString(op.source) && isString(op.center) && isNumber(op.angleDegrees);
    case "translation":
      return isString(op.source) && isNumber(op.dx) && isNumber(op.dy);
    case "scale":
      return isString(op.source) && isString(op.center) && isNumber(op.factor);
    case "angle":
      return isString(op.a) && isString(op.vertex) && isString(op.c);
    case "polygon":
      return Array.isArray(op.points) && op.points.every(isString) && (op.color === undefined || isString(op.color));
    case "anchor":
      return isString(op.target) && isNumber(op.param);
    default:
      return false;
  }
}

export function isGeometryStateV1(value: unknown): value is GeometryStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && Array.isArray(v.ops) && v.ops.every(isGeometryOp);
}

