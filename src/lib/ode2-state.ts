/**
 * URL-state schema for Ode2Panel -- a flat dump of its 10 free string cells
 * (see cell-ids.ts's cellIdsOde2). Same shape/convention as ode-state.ts:
 * every cell is a plain user-editable field, no construction log needed.
 */
export interface Ode2StateV1 {
  v: 1;
  a: string;
  b: string;
  c: string;
  x0: string;
  y0: string;
  yPrime0: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
}

export type Ode2State = Ode2StateV1;

/** Underdamped: disc = 0.4^2 - 4*1*4 = -15.84 < 0 -- decaying oscillation. */
export const DEFAULT_ODE2_STATE: Ode2State = {
  v: 1,
  a: "1",
  b: "0.4",
  c: "4",
  x0: "0",
  y0: "1",
  yPrime0: "0",
  xMin: "0",
  xMax: "10",
  yMin: "-1.5",
  yMax: "1.5",
};

export function encodeOde2State(state: Ode2State): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeOde2State(fragment: string): Ode2State | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isOde2StateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isOde2StateV1(value: unknown): value is Ode2StateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.a === "string" &&
    typeof v.b === "string" &&
    typeof v.c === "string" &&
    typeof v.x0 === "string" &&
    typeof v.y0 === "string" &&
    typeof v.yPrime0 === "string" &&
    typeof v.xMin === "string" &&
    typeof v.xMax === "string" &&
    typeof v.yMin === "string" &&
    typeof v.yMax === "string"
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
