import type { MonteCarloDistType } from "./monte-carlo.ts";
import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";

/**
 * URL-state schema for MonteCarloPanel -- a flat dump of its free string
 * cells (see cell-ids.ts's cellIdsMonteCarlo). Same shape/convention as
 * taylor-state.ts/ode2-state.ts.
 */
export interface MonteCarloStateV1 {
  v: 1;
  seed: string;
  dartCount: string;
  distType: MonteCarloDistType;
  distMean: string;
  distSd: string;
  distA: string;
  distB: string;
  distRate: string;
  distN: string;
  distP: string;
  distLambda: string;
  sampleCount: string;
}

export interface MonteCarloStateV2 {
  v: 2;
  seed: string;
  dartCount: string;
  distType: MonteCarloDistType;
  distMean: string;
  distSd: string;
  distA: string;
  distB: string;
  distRate: string;
  distN: string;
  distP: string;
  distLambda: string;
  sampleCount: string;
  integrandText: string;
  integrandA: string;
  integrandB: string;
  integrandSampleCount: string;
}

export type MonteCarloState = MonteCarloStateV2;

export const DEFAULT_MONTE_CARLO_STATE: MonteCarloState = {
  v: 2,
  seed: "42",
  dartCount: "5000",
  distType: "normal",
  distMean: "0",
  distSd: "1",
  distA: "0",
  distB: "1",
  distRate: "1",
  distN: "10",
  distP: "0.5",
  distLambda: "4",
  sampleCount: "3000",
  integrandText: "sin(x)",
  integrandA: "0",
  integrandB: "3.14159",
  integrandSampleCount: "5000",
};

export function encodeMonteCarloState(state: MonteCarloState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. Upgrades a v1 payload to v2 with the integration fields defaulted. */
export function decodeMonteCarloState(fragment: string): MonteCarloState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isMonteCarloStateV2(parsed)) return parsed;
    if (isMonteCarloStateV1(parsed)) return upgradeV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

function upgradeV1ToV2(v1: MonteCarloStateV1): MonteCarloStateV2 {
  return {
    ...v1,
    v: 2,
    integrandText: DEFAULT_MONTE_CARLO_STATE.integrandText,
    integrandA: DEFAULT_MONTE_CARLO_STATE.integrandA,
    integrandB: DEFAULT_MONTE_CARLO_STATE.integrandB,
    integrandSampleCount: DEFAULT_MONTE_CARLO_STATE.integrandSampleCount,
  };
}

const DIST_TYPES: MonteCarloDistType[] = ["normal", "uniform", "exponential", "binomial", "poisson"];

const V1_FIELDS = ["seed", "dartCount", "distMean", "distSd", "distA", "distB", "distRate", "distN", "distP", "distLambda", "sampleCount"] as const;

function hasV1Fields(v: Record<string, unknown>): boolean {
  if (!DIST_TYPES.includes(v.distType as MonteCarloDistType)) return false;
  return V1_FIELDS.every((f) => typeof v[f] === "string");
}

export function isMonteCarloStateV1(value: unknown): value is MonteCarloStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && hasV1Fields(v);
}

export function isMonteCarloStateV2(value: unknown): value is MonteCarloStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !hasV1Fields(v)) return false;
  const fields = ["integrandText", "integrandA", "integrandB", "integrandSampleCount"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

