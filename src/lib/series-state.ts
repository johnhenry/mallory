/**
 * URL-state schema for SeriesPanel -- a flat dump of its free string cells
 * (see cell-ids.ts's cellIdsSeries). Same shape/convention as
 * taylor-state.ts. `toN` accepts the literal string "Infinity" --
 * `Number("Infinity")` is exactly `Infinity` in JS, matching
 * `Symbolic.sumSeries`'s own `to: number` parameter for an infinite series.
 */
export interface SeriesStateV1 {
  v: 1;
  exprText: string;
  variable: string;
  fromN: string;
  toN: string;
  plotCount: string;
}

export type SeriesState = SeriesStateV1;

export const DEFAULT_SERIES_STATE: SeriesState = {
  v: 1,
  exprText: "1/n^2",
  variable: "n",
  fromN: "1",
  toN: "Infinity",
  plotCount: "30",
};

export function encodeSeriesState(state: SeriesState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeSeriesState(fragment: string): SeriesState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isSeriesStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isSeriesStateV1(value: unknown): value is SeriesStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  const fields = ["exprText", "variable", "fromN", "toN", "plotCount"] as const;
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
