/**
 * URL-state schema for SignalPanel -- the raw inputs only (see
 * cell-ids.ts's cellIdsSignal); every result cell is purely derived.
 */
export interface SignalStateV1 {
  v: 1;
  exprText: string;
  sampleRate: string;
  duration: string;
}

export type SignalState = SignalStateV1;

export const DEFAULT_SIGNAL_STATE: SignalState = {
  v: 1,
  exprText: "sin(2*pi*5*t) + 0.5*sin(2*pi*12*t)",
  sampleRate: "64",
  duration: "1",
};

export function encodeSignalState(state: SignalState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeSignalState(fragment: string): SignalState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isSignalStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isSignalStateV1(value: unknown): value is SignalStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  const fields = ["exprText", "sampleRate", "duration"] as const;
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
