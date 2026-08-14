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

export type ComplexState = ComplexStateV1;

export const DEFAULT_COMPLEX_STATE: ComplexState = {
  v: 1,
  exprText: "z^2 + 1",
  probeRe: "1",
  probeIm: "1",
  showRootsOfUnity: true,
  rootsN: "5",
};

export function encodeComplexState(state: ComplexState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeComplexState(fragment: string): ComplexState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isComplexStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isComplexStateV1(value: unknown): value is ComplexStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || typeof v.showRootsOfUnity !== "boolean") return false;
  const fields = ["exprText", "probeRe", "probeIm", "rootsN"] as const;
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
