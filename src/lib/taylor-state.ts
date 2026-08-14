/**
 * URL-state schema for TaylorPanel -- a flat dump of its 8 free string
 * cells (see cell-ids.ts's cellIdsTaylor). Same shape/convention as
 * ode2-state.ts.
 */
export interface TaylorStateV1 {
  v: 1;
  expr: string;
  center: string;
  order: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  limitPoint: string;
  limitDirection: "left" | "right" | "both";
}

export type TaylorState = TaylorStateV1;

export const DEFAULT_TAYLOR_STATE: TaylorState = {
  v: 1,
  expr: "sin(x)",
  center: "0",
  order: "3",
  xMin: "-6",
  xMax: "6",
  yMin: "-2",
  yMax: "2",
  limitPoint: "0",
  limitDirection: "both",
};

export function encodeTaylorState(state: TaylorState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeTaylorState(fragment: string): TaylorState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isTaylorStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const LIMIT_DIRECTIONS = ["left", "right", "both"];

export function isTaylorStateV1(value: unknown): value is TaylorStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !LIMIT_DIRECTIONS.includes(v.limitDirection as string)) return false;
  const fields = ["expr", "center", "order", "xMin", "xMax", "yMin", "yMax", "limitPoint"] as const;
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
