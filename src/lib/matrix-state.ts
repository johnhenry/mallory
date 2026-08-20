import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
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
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeMatrixState(fragment: string): MatrixState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
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

