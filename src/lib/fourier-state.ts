import type { FourierWaveType } from "./fourier-series.ts";

/** URL-state schema for FourierPanel -- a flat dump of its free cells (see cell-ids.ts's cellIdsFourier). Same shape/convention as series-state.ts. */
export interface FourierStateV1 {
  v: 1;
  waveType: FourierWaveType;
  harmonics: string;
}

export type FourierState = FourierStateV1;

export const DEFAULT_FOURIER_STATE: FourierState = {
  v: 1,
  waveType: "square",
  harmonics: "5",
};

export function encodeFourierState(state: FourierState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeFourierState(fragment: string): FourierState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isFourierStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isFourierStateV1(value: unknown): value is FourierStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  if (v.waveType !== "square" && v.waveType !== "sawtooth") return false;
  return typeof v.harmonics === "string";
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
