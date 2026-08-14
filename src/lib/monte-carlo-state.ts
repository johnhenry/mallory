import type { MonteCarloDistType } from "./monte-carlo.ts";

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

export type MonteCarloState = MonteCarloStateV1;

export const DEFAULT_MONTE_CARLO_STATE: MonteCarloState = {
  v: 1,
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
};

export function encodeMonteCarloState(state: MonteCarloState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeMonteCarloState(fragment: string): MonteCarloState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isMonteCarloStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const DIST_TYPES: MonteCarloDistType[] = ["normal", "uniform", "exponential", "binomial", "poisson"];

export function isMonteCarloStateV1(value: unknown): value is MonteCarloStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !DIST_TYPES.includes(v.distType as MonteCarloDistType)) return false;
  const fields = [
    "seed",
    "dartCount",
    "distMean",
    "distSd",
    "distA",
    "distB",
    "distRate",
    "distN",
    "distP",
    "distLambda",
    "sampleCount",
  ] as const;
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
