/**
 * URL-state schema for GradientDescentPanel -- the raw inputs only (see
 * cell-ids.ts's cellIdsGradientDescent); the contour and descent-path cells
 * are purely derived. Same shape/convention as series-state.ts.
 */
export interface GradientDescentStateV1 {
  v: 1;
  exprText: string;
  startX: string;
  startY: string;
  lr: string;
  steps: string;
  showSgd: boolean;
  showAdam: boolean;
  showRmsprop: boolean;
}

export type GradientDescentState = GradientDescentStateV1;

export const DEFAULT_GRADIENT_DESCENT_STATE: GradientDescentState = {
  v: 1,
  // Anisotropic bowl: the classic picture where SGD zigzags across the
  // narrow valley while Adam's per-coordinate scaling goes straighter.
  exprText: "x^2 + 10*y^2",
  startX: "4",
  startY: "2",
  lr: "0.05",
  steps: "80",
  showSgd: true,
  showAdam: true,
  showRmsprop: false,
};

export function encodeGradientDescentState(state: GradientDescentState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeGradientDescentState(fragment: string): GradientDescentState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isGradientDescentStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isGradientDescentStateV1(value: unknown): value is GradientDescentStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  const stringFields = ["exprText", "startX", "startY", "lr", "steps"] as const;
  if (!stringFields.every((f) => typeof v[f] === "string")) return false;
  const boolFields = ["showSgd", "showAdam", "showRmsprop"] as const;
  return boolFields.every((f) => typeof v[f] === "boolean");
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
