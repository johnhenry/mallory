/**
 * URL-state schema for MatrixPanel -- just the two raw text inputs
 * (see cell-ids.ts's cellIdsMatrix). Every other cell is purely derived
 * from these, so there's nothing else worth persisting.
 */
export interface MatrixStateV1 {
  v: 1;
  matrixText: string;
  polyCoeffs: string;
}

export type MatrixState = MatrixStateV1;

export const DEFAULT_MATRIX_STATE: MatrixState = {
  v: 1,
  matrixText: "4, 3\n6, 3",
  polyCoeffs: "-6, 11, -6",
};

export function encodeMatrixState(state: MatrixState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeMatrixState(fragment: string): MatrixState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isMatrixStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isMatrixStateV1(value: unknown): value is MatrixStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && typeof v.matrixText === "string" && typeof v.polyCoeffs === "string";
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
