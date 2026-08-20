import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for RegressionPanel -- a flat dump of its free cells (see
 * cell-ids.ts's cellIdsRegression). Points carry no `id` in the serialized
 * shape (regenerated via `crypto.randomUUID()` on decode, mirroring
 * multi-graph-state.ts's row convention) since point ids are just React/cell
 * keys, not referenced elsewhere. No construction-log/replay needed.
 */
export interface RegressionPointState {
  x: string;
  y: string;
}

export interface RegressionStateV1 {
  v: 1;
  rows: RegressionPointState[];
  fitType: "linear" | "nonlinear";
  modelExpr: string;
  paramGuesses: Record<string, string>;
}

/**
 * One overlaid dataset+fit (#336 item 7, unlimited datasets): the
 * rows/fitType/modelExpr/paramGuesses half of a v1 state -- its own scatter
 * of (x, y) points, its own fit type and (when nonlinear) model/initial
 * guesses -- plus color/visibility, same "flat single state -> ordered
 * rows" upgrade ode-state.ts's own v1->v2 migration used. `points` (not
 * `rows`) to avoid colliding with the panel-level "row" vocabulary this
 * port introduces for datasets themselves -- see cellIdsRegression's own
 * doc comment.
 */
export interface RegressionDatasetState {
  points: RegressionPointState[];
  fitType: "linear" | "nonlinear";
  modelExpr: string;
  paramGuesses: Record<string, string>;
  color: number;
  visible: boolean;
}

/**
 * v2: unlimited overlaid datasets, each with its own fit, plotted together
 * on one shared, auto-computed viewport (there's no user-editable domain
 * here, unlike ode-state.ts/ode-system-state.ts's own v1->v2 migrations --
 * RegressionPanel's viewport has always been derived from the active
 * dataset's own points, never a free cell, so v2 stays just an ordered list
 * of datasets with no new container-level fields).
 */
export interface RegressionStateV2 {
  v: 2;
  datasets: RegressionDatasetState[];
}

export type RegressionState = RegressionStateV2;

const DEFAULT_DATASET: RegressionDatasetState = {
  points: [
    { x: "1", y: "2.1" },
    { x: "2", y: "3.9" },
    { x: "3", y: "6.2" },
    { x: "4", y: "7.8" },
    { x: "5", y: "10.1" },
  ],
  fitType: "linear",
  modelExpr: "a*exp(b*x)",
  paramGuesses: { a: "1", b: "0.1" },
  color: 0x2563eb,
  visible: true,
};

export const DEFAULT_REGRESSION_STATE: RegressionState = {
  v: 2,
  datasets: [DEFAULT_DATASET],
};

/** Exported for notebook-state.ts's own "regression" block upgrade -- notebook blocks nest this panel's state type directly rather than re-declaring its version history, so they need the same v1->v2 migration this file's own decodeRegressionState applies. */
export function upgradeRegressionV1ToV2(v1: RegressionStateV1): RegressionStateV2 {
  return {
    v: 2,
    datasets: [
      {
        points: v1.rows.map(({ x, y }) => ({ x, y })),
        fitType: v1.fitType,
        modelExpr: v1.modelExpr,
        paramGuesses: v1.paramGuesses,
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
}

export function encodeRegressionState(state: RegressionState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeRegressionState(fragment: string): RegressionState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isRegressionStateV2(parsed)) return parsed;
    if (isRegressionStateV1(parsed)) return upgradeRegressionV1ToV2(parsed);
    return null;
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

export function isRegressionStateV2(value: unknown): value is RegressionStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.datasets)) return false;
  return v.datasets.every((d) => {
    if (typeof d !== "object" || d === null) return false;
    const dataset = d as Record<string, unknown>;
    if (!Array.isArray(dataset.points)) return false;
    if (dataset.fitType !== "linear" && dataset.fitType !== "nonlinear") return false;
    if (typeof dataset.modelExpr !== "string") return false;
    if (typeof dataset.paramGuesses !== "object" || dataset.paramGuesses === null) return false;
    if (typeof dataset.color !== "number" || typeof dataset.visible !== "boolean") return false;
    return dataset.points.every((p) => {
      if (typeof p !== "object" || p === null) return false;
      const point = p as Record<string, unknown>;
      return typeof point.x === "string" && typeof point.y === "string";
    });
  });
}
