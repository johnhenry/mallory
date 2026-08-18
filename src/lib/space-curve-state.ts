/**
 * URL-state schema for SpaceCurvePanel (issue #30 item 2) -- a flat dump of
 * its free string cells (see cell-ids.ts's cellIdsSpaceCurve). Same shape/
 * convention as vector-field-3d-state.ts. Defaults to a helix, so the plot
 * reads as genuinely 3D rather than a flat planar curve.
 */
export interface SpaceCurveStateV1 {
  v: 1;
  exprX: string;
  exprY: string;
  exprZ: string;
  tMin: string;
  tMax: string;
}

/** One curve row (issue #251, unlimited expressions) -- the exact shape of a v1 state, plus color/visibility. */
export interface SpaceCurveRowState {
  exprX: string;
  exprY: string;
  exprZ: string;
  tMin: string;
  tMax: string;
  color: number;
  visible: boolean;
}

/** v2 (issue #251): unlimited space curves, same "flat single state -> ordered rows" upgrade graph-state.ts's own v2->v3 migration used. */
export interface SpaceCurveStateV2 {
  v: 2;
  rows: SpaceCurveRowState[];
}

export type SpaceCurveState = SpaceCurveStateV2;

const DEFAULT_ROW: SpaceCurveRowState = {
  exprX: "cos(t)",
  exprY: "sin(t)",
  exprZ: "0.15*t",
  tMin: "0",
  tMax: String(4 * Math.PI),
  color: 0x2563eb,
  visible: true,
};

export const DEFAULT_SPACE_CURVE_STATE: SpaceCurveState = {
  v: 2,
  rows: [DEFAULT_ROW],
};

function upgradeV1ToV2(v1: SpaceCurveStateV1): SpaceCurveStateV2 {
  return {
    v: 2,
    rows: [{ exprX: v1.exprX, exprY: v1.exprY, exprZ: v1.exprZ, tMin: v1.tMin, tMax: v1.tMax, color: 0x2563eb, visible: true }],
  };
}

export function encodeSpaceCurveState(state: SpaceCurveState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeSpaceCurveState(fragment: string): SpaceCurveState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    if (isSpaceCurveStateV2(parsed)) return parsed;
    if (isSpaceCurveStateV1(parsed)) return upgradeV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

export function isSpaceCurveStateV1(value: unknown): value is SpaceCurveStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  const fields = ["exprX", "exprY", "exprZ", "tMin", "tMax"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

export function isSpaceCurveStateV2(value: unknown): value is SpaceCurveStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.rows)) return false;
  const fields = ["exprX", "exprY", "exprZ", "tMin", "tMax"] as const;
  return v.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return fields.every((f) => typeof r[f] === "string") && typeof r.color === "number" && typeof r.visible === "boolean";
  });
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
