import type { DatasetType } from "./ml-playground.ts";

/**
 * URL-state schema for MlPlaygroundPanel -- the CONFIG inputs only (see
 * cell-ids.ts's cellIdsMlPlayground). Deliberately no trained weights in
 * the URL: training is imperative/stateful (Train mutates the model
 * in place, Reset re-seeds it), so the reproducible thing to share is the
 * full recipe (dataset + seeds + architecture + lr/epochs), which
 * regenerates the identical run -- training is deterministic end to end,
 * pinned by ml-playground.test.ts.
 */
export interface MlPlaygroundStateV1 {
  v: 1;
  dataset: DatasetType;
  pointsPerClass: string;
  dataSeed: string;
  modelSeed: string;
  hidden: string;
  lr: string;
  epochs: string;
}

export interface MlPlaygroundStateV2 {
  v: 2;
  dataset: DatasetType;
  pointsPerClass: string;
  dataSeed: string;
  modelSeed: string;
  hidden: string;
  lr: string;
  epochs: string;
  dropout: string;
  /**
   * Issue #34's "StepLR exposure" remaining-scope item -- optional (not a
   * v3 bump), same convention as `gradient-descent-state.ts`'s own
   * `useSchedule`/`stepSize`/`gamma` fields: off by default, and an old
   * encoded hash from before this field existed still decodes instead of
   * failing validation and resetting the whole state.
   */
  useSchedule?: boolean;
  stepSize?: string;
  gamma?: string;
}

export type MlPlaygroundState = MlPlaygroundStateV2;

export const DEFAULT_ML_PLAYGROUND_STATE: MlPlaygroundState = {
  v: 2,
  dataset: "moons",
  pointsPerClass: "60",
  dataSeed: "7",
  modelSeed: "42",
  hidden: "8",
  lr: "0.05",
  epochs: "200",
  dropout: "0",
  useSchedule: false,
  stepSize: "50",
  gamma: "0.5",
};

export function encodeMlPlaygroundState(state: MlPlaygroundState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. Upgrades a v1 payload to v2 with dropout defaulted off. */
export function decodeMlPlaygroundState(fragment: string): MlPlaygroundState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    if (isMlPlaygroundStateV2(parsed)) return parsed;
    if (isMlPlaygroundStateV1(parsed)) return { ...parsed, v: 2, dropout: DEFAULT_ML_PLAYGROUND_STATE.dropout };
    return null;
  } catch {
    return null;
  }
}

const DATASET_TYPES: DatasetType[] = ["xor", "moons", "rings"];

function hasV1Fields(v: Record<string, unknown>): boolean {
  if (!DATASET_TYPES.includes(v.dataset as DatasetType)) return false;
  const fields = ["pointsPerClass", "dataSeed", "modelSeed", "hidden", "lr", "epochs"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

export function isMlPlaygroundStateV1(value: unknown): value is MlPlaygroundStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && hasV1Fields(v);
}

export function isMlPlaygroundStateV2(value: unknown): value is MlPlaygroundStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !hasV1Fields(v) || typeof v.dropout !== "string") return false;
  const optionalStringFields = ["stepSize", "gamma"] as const;
  if (!optionalStringFields.every((f) => v[f] === undefined || typeof v[f] === "string")) return false;
  return v.useSchedule === undefined || typeof v.useSchedule === "boolean";
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
