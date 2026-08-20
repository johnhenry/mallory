import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for RegressionPanel -- a flat dump of its free cells (see
 * cell-ids.ts's cellIdsRegression). Rows carry no `id` in the serialized
 * shape (regenerated via `crypto.randomUUID()` on decode, mirroring
 * multi-graph-state.ts's row convention) since row ids are just React/cell
 * keys, not referenced elsewhere. No construction-log/replay needed.
 */
export interface RegressionRowState {
  x: string;
  y: string;
}

export interface RegressionStateV1 {
  v: 1;
  rows: RegressionRowState[];
  fitType: "linear" | "nonlinear";
  modelExpr: string;
  paramGuesses: Record<string, string>;
}

export type RegressionState = RegressionStateV1;

export const DEFAULT_REGRESSION_STATE: RegressionState = {
  v: 1,
  rows: [
    { x: "1", y: "2.1" },
    { x: "2", y: "3.9" },
    { x: "3", y: "6.2" },
    { x: "4", y: "7.8" },
    { x: "5", y: "10.1" },
  ],
  fitType: "linear",
  modelExpr: "a*exp(b*x)",
  paramGuesses: { a: "1", b: "0.1" },
};

export function encodeRegressionState(state: RegressionState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeRegressionState(fragment: string): RegressionState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    return isRegressionStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isRegressionStateV1(value: unknown): value is RegressionStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !Array.isArray(v.rows)) return false;
  if (v.fitType !== "linear" && v.fitType !== "nonlinear") return false;
  if (typeof v.modelExpr !== "string") return false;
  if (typeof v.paramGuesses !== "object" || v.paramGuesses === null) return false;
  return v.rows.every((r) => {
    if (typeof r !== "object" || r === null) return false;
    const row = r as Record<string, unknown>;
    return typeof row.x === "string" && typeof row.y === "string";
  });
}

