import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for StatisticsPanel -- a flat dump of its free
 * string/enum cells (see cell-ids.ts's cellIdsStatistics). No construction-
 * log/replay needed, same convention as ode-state.ts.
 */
export type StatisticsDistType = "normal" | "binomial" | "poisson" | "studentT" | "chiSquare";

export interface StatisticsStateV1 {
  v: 1;
  data: string;
  distType: StatisticsDistType;
  distMean: string;
  distSd: string;
  distN: string;
  distP: string;
  distLambda: string;
  distDf: string;
  queryLower: string;
  queryUpper: string;
}

/**
 * One independent dataset (#336 item 7, unlimited datasets): exactly the
 * v1 flat state's own 9 persisted fields (its data string, distribution
 * type/params, and query bounds), plus color/visibility. Unlike
 * RegressionPanel/OdeSystemPanel's own v1->v2 ports, there's no shared
 * viewport or shared distribution params to hoist to the container level --
 * summary stats, distribution query, hypothesis test, and kernel smoothing
 * are each a small text/canvas output tied to ONE dataset, so every one of
 * today's fields (and, per cell-ids.ts's own doc comment, the
 * inference/smoothing cells that are deliberately NOT part of this
 * persisted shape either) stays scoped per-dataset. `color` mainly colors
 * the smoothing/residual polyline (replacing the old hardcoded
 * "#dc2626"/"#16a34a"); `visible` controls whether the whole dataset block
 * (and its own two canvases) renders at all.
 */
export interface StatisticsRowState {
  data: string;
  distType: StatisticsDistType;
  distMean: string;
  distSd: string;
  distN: string;
  distP: string;
  distLambda: string;
  distDf: string;
  queryLower: string;
  queryUpper: string;
  color: number;
  visible: boolean;
}

/**
 * v2: unlimited independent datasets, each fully self-contained (#336 item
 * 7) -- no container-level fields beyond the ordered row list itself
 * (tracked at the cell-graph level via cellIdsStatistics's own `list`, not
 * part of this serialized shape, same convention as
 * RegressionStateV2/SpaceCurveState).
 */
export interface StatisticsStateV2 {
  v: 2;
  rows: StatisticsRowState[];
}

export type StatisticsState = StatisticsStateV2;

const DEFAULT_ROW: StatisticsRowState = {
  data: "2, 4, 4, 4, 5, 5, 7, 9",
  distType: "normal",
  distMean: "0",
  distSd: "1",
  distN: "10",
  distP: "0.5",
  distLambda: "4",
  distDf: "5",
  queryLower: "-1",
  queryUpper: "1",
  color: 0x2563eb,
  visible: true,
};

export const DEFAULT_STATISTICS_STATE: StatisticsState = {
  v: 2,
  rows: [DEFAULT_ROW],
};

/** Exported for notebook-state.ts's own "statistics" block upgrade -- notebook blocks nest this panel's state type directly rather than re-declaring its version history, so they need the same v1->v2 migration this file's own decodeStatisticsState applies. */
export function upgradeStatisticsV1ToV2(v1: StatisticsStateV1): StatisticsStateV2 {
  return {
    v: 2,
    rows: [
      {
        data: v1.data,
        distType: v1.distType,
        distMean: v1.distMean,
        distSd: v1.distSd,
        distN: v1.distN,
        distP: v1.distP,
        distLambda: v1.distLambda,
        distDf: v1.distDf,
        queryLower: v1.queryLower,
        queryUpper: v1.queryUpper,
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
}

export function encodeStatisticsState(state: StatisticsState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeStatisticsState(fragment: string): StatisticsState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isStatisticsStateV2(parsed)) return parsed;
    if (isStatisticsStateV1(parsed)) return upgradeStatisticsV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

const DIST_TYPES: StatisticsDistType[] = ["normal", "binomial", "poisson", "studentT", "chiSquare"];

export function isStatisticsStateV1(value: unknown): value is StatisticsStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !DIST_TYPES.includes(v.distType as StatisticsDistType)) return false;
  const fields = ["data", "distMean", "distSd", "distN", "distP", "distLambda", "distDf", "queryLower", "queryUpper"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

export function isStatisticsStateV2(value: unknown): value is StatisticsStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.rows)) return false;
  return v.rows.every((r) => {
    if (typeof r !== "object" || r === null) return false;
    const row = r as Record<string, unknown>;
    if (!DIST_TYPES.includes(row.distType as StatisticsDistType)) return false;
    if (typeof row.color !== "number" || typeof row.visible !== "boolean") return false;
    const fields = ["data", "distMean", "distSd", "distN", "distP", "distLambda", "distDf", "queryLower", "queryUpper"] as const;
    return fields.every((f) => typeof row[f] === "string");
  });
}
