/**
 * URL-state schema for ParametricSurfacePanel -- a flat dump of its free
 * string cells (see cell-ids.ts's cellIdsParametricSurface). Same shape/
 * convention as series-state.ts. Defaults to the torus preset.
 */
export interface ParametricSurfaceStateV1 {
  v: 1;
  exprX: string;
  exprY: string;
  exprZ: string;
  uMin: string;
  uMax: string;
  vMin: string;
  vMax: string;
}

export type ParametricSurfaceState = ParametricSurfaceStateV1;

export const DEFAULT_PARAMETRIC_SURFACE_STATE: ParametricSurfaceState = {
  v: 1,
  exprX: "(2+cos(v))*cos(u)",
  exprY: "(2+cos(v))*sin(u)",
  exprZ: "sin(v)",
  uMin: "0",
  uMax: "6.28318",
  vMin: "0",
  vMax: "6.28318",
};

export function encodeParametricSurfaceState(state: ParametricSurfaceState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeParametricSurfaceState(fragment: string): ParametricSurfaceState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isParametricSurfaceStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isParametricSurfaceStateV1(value: unknown): value is ParametricSurfaceStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  const fields = ["exprX", "exprY", "exprZ", "uMin", "uMax", "vMin", "vMax"] as const;
  return fields.every((f) => typeof v[f] === "string");
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
