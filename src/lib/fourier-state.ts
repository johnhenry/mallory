import type { FourierWaveType } from "./fourier-series.ts";
import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";

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
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeFourierState(fragment: string): FourierState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
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

