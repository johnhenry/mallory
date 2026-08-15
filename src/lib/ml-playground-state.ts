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

export type MlPlaygroundState = MlPlaygroundStateV1;

export const DEFAULT_ML_PLAYGROUND_STATE: MlPlaygroundState = {
  v: 1,
  dataset: "moons",
  pointsPerClass: "60",
  dataSeed: "7",
  modelSeed: "42",
  hidden: "8",
  lr: "0.05",
  epochs: "200",
};

export function encodeMlPlaygroundState(state: MlPlaygroundState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeMlPlaygroundState(fragment: string): MlPlaygroundState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isMlPlaygroundStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const DATASET_TYPES: DatasetType[] = ["xor", "moons", "rings"];

export function isMlPlaygroundStateV1(value: unknown): value is MlPlaygroundStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  if (!DATASET_TYPES.includes(v.dataset as DatasetType)) return false;
  const fields = ["pointsPerClass", "dataSeed", "modelSeed", "hidden", "lr", "epochs"] as const;
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
