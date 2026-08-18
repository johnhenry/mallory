import type { DatasetType, LabeledPoint } from "./ml-playground.ts";

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

export interface MlPlaygroundStateV3 {
  v: 3;
  dataset: DatasetType;
  pointsPerClass: string;
  dataSeed: string;
  modelSeed: string;
  hidden: string;
  lr: string;
  epochs: string;
  dropout: string;
  useSchedule?: boolean;
  stepSize?: string;
  gamma?: string;
  /**
   * Issue #253's CSV-import dataset (`dataset: "csv"`): the imported points
   * themselves, encoded directly in the URL -- unlike `drawnPoints`
   * (appended one click at a time, deliberately EXCLUDED from the URL to
   * avoid a `replaceState` per click, see MlPlaygroundPanel.tsx), a CSV
   * import is one bulk, deliberate action, the same shareability case as
   * every other config input here (and the same pattern DataImportPanel's
   * "Open in Regression"/"Open in Statistics" already use for THEIR target
   * panels' row lists).
   */
  csvPoints?: LabeledPoint[];
  /**
   * Display names for `csvPoints`' label indices (`classNames[i]` is the
   * original CSV cell text for label `i`) -- purely cosmetic (the legend
   * MlPlaygroundPanel renders next to the decision boundary), never read by
   * training/inference, which only ever sees the numeric `label`.
   */
  classNames?: string[];
}

export type MlPlaygroundState = MlPlaygroundStateV3;

export const DEFAULT_ML_PLAYGROUND_STATE: MlPlaygroundState = {
  v: 3,
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

/** Returns null on any malformed/unrecognized fragment rather than throwing. Upgrades a v1/v2 payload to v3 with dropout (v1 only) and csvPoints/classNames defaulted off. */
export function decodeMlPlaygroundState(fragment: string): MlPlaygroundState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    if (isMlPlaygroundStateV3(parsed)) return parsed;
    if (isMlPlaygroundStateV2(parsed)) return { ...parsed, v: 3 };
    if (isMlPlaygroundStateV1(parsed)) return { ...parsed, v: 3, dropout: DEFAULT_ML_PLAYGROUND_STATE.dropout };
    return null;
  } catch {
    return null;
  }
}

// "drawn" (issue #34) and "csv" (issue #253) are included here (unlike the
// original v1 list, which predates both) so a shared/reloaded URL encoding
// either dataset actually round-trips instead of silently failing
// `hasV1Fields` and falling back to the default state.
const DATASET_TYPES: DatasetType[] = ["xor", "moons", "rings", "drawn", "csv"];

function hasV1Fields(v: Record<string, unknown>): boolean {
  if (!DATASET_TYPES.includes(v.dataset as DatasetType)) return false;
  const fields = ["pointsPerClass", "dataSeed", "modelSeed", "hidden", "lr", "epochs"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

/** True when every element of `value` looks like a `LabeledPoint` (finite x/y, non-negative integer label). */
function isLabeledPointArray(value: unknown): value is LabeledPoint[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as Record<string, unknown>).x === "number" &&
      typeof (p as Record<string, unknown>).y === "number" &&
      Number.isFinite((p as Record<string, unknown>).x as number) &&
      Number.isFinite((p as Record<string, unknown>).y as number) &&
      typeof (p as Record<string, unknown>).label === "number" &&
      Number.isInteger((p as Record<string, unknown>).label) &&
      ((p as Record<string, unknown>).label as number) >= 0,
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((s) => typeof s === "string");
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

export function isMlPlaygroundStateV3(value: unknown): value is MlPlaygroundStateV3 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 3 || !hasV1Fields(v) || typeof v.dropout !== "string") return false;
  const optionalStringFields = ["stepSize", "gamma"] as const;
  if (!optionalStringFields.every((f) => v[f] === undefined || typeof v[f] === "string")) return false;
  if (v.useSchedule !== undefined && typeof v.useSchedule !== "boolean") return false;
  if (v.csvPoints !== undefined && !isLabeledPointArray(v.csvPoints)) return false;
  return v.classNames === undefined || isStringArray(v.classNames);
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
