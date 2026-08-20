import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for StatisticsPanel -- a flat dump of its 10 free
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

export type StatisticsState = StatisticsStateV1;

export const DEFAULT_STATISTICS_STATE: StatisticsState = {
  v: 1,
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
};

export function encodeStatisticsState(state: StatisticsState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeStatisticsState(fragment: string): StatisticsState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    return isStatisticsStateV1(parsed) ? parsed : null;
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

