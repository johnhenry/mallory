import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for mallory-graph — the graph's source of truth,
 * serialized into a compact base64url fragment (Desmos-style: no server
 * round-trip). Designed now, in Phase 1, even though full support (sliders,
 * multi-cell graphs, style) lands in later phases and round-trip UI wiring
 * ships in Phase 8 — extending a versioned schema is far cheaper than
 * retrofitting one once cells/sliders/viewport state already exist.
 */
export interface GraphStateV1 {
  v: 1;
  /** Ordered list of expression cells, each compiled via Symbolic. */
  cells: Array<{ id: string; source: string }>;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
}

export interface GraphStateV2 {
  v: 2;
  /** Ordered list of expression cells, each compiled via Symbolic. */
  cells: Array<{ id: string; source: string }>;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** Current value of every auto-inferred slider, keyed by variable name. */
  params: Record<string, number>;
  /** Structure selector: a modulus for Z/nZ, or null for the real numbers. */
  structureModulus: number | null;
  /** Arithmetic mode for the y-readout. */
  mode: "float" | "exact";
}

export interface GraphStateV3 {
  v: 3;
  /**
   * Ordered list of expression cells, each compiled via Symbolic. Unlike v2,
   * params/structureModulus live per-cell rather than once globally, so a
   * multi-pane view (LinkedGraphPanes.tsx) round-trips every pane's state
   * through one URL fragment, not just the first cell's.
   */
  cells: Array<{
    id: string;
    source: string;
    params: Record<string, number>;
    structureModulus: number | null;
  }>;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** Arithmetic mode for the y-readout -- still a single global setting, applied to the URL-syncing pane. */
  mode: "float" | "exact";
}

export type GraphState = GraphStateV3;

export const DEFAULT_GRAPH_STATE: GraphState = {
  v: 3,
  cells: [{ id: "f", source: "x^2", params: {}, structureModulus: null }],
  viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 100 },
  mode: "float",
};

export function encodeGraphState(state: GraphState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. Upgrades v1/v2 payloads to v3 with defaults. */
export function decodeGraphState(fragment: string): GraphState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isGraphStateV3(parsed)) return parsed;
    if (isGraphStateV2(parsed)) return upgradeV2ToV3(parsed);
    if (isGraphStateV1(parsed)) return upgradeV2ToV3(upgradeV1ToV2(parsed));
    return null;
  } catch {
    return null;
  }
}

function upgradeV1ToV2(v1: GraphStateV1): GraphStateV2 {
  return { ...v1, v: 2, params: {}, structureModulus: null, mode: "float" };
}

function upgradeV2ToV3(v2: GraphStateV2): GraphStateV3 {
  return {
    v: 3,
    viewport: v2.viewport,
    mode: v2.mode,
    cells: v2.cells.map((c, i) =>
      i === 0 ? { ...c, params: v2.params, structureModulus: v2.structureModulus } : { ...c, params: {}, structureModulus: null },
    ),
  };
}

function hasCellsAndViewport(v: Record<string, unknown>): boolean {
  return (
    Array.isArray(v.cells) &&
    v.cells.every((c) => typeof c === "object" && c !== null && typeof (c as { id?: unknown }).id === "string" && typeof (c as { source?: unknown }).source === "string") &&
    typeof v.viewport === "object" &&
    v.viewport !== null
  );
}

function isGraphStateV1(value: unknown): value is GraphStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && hasCellsAndViewport(v);
}

function isGraphStateV2(value: unknown): value is GraphStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 2 &&
    hasCellsAndViewport(v) &&
    typeof v.params === "object" &&
    v.params !== null &&
    (v.structureModulus === null || typeof v.structureModulus === "number") &&
    (v.mode === "float" || v.mode === "exact")
  );
}

function isGraphStateV3(value: unknown): value is GraphStateV3 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 3 || !(v.mode === "float" || v.mode === "exact")) return false;
  if (!Array.isArray(v.cells) || typeof v.viewport !== "object" || v.viewport === null) return false;
  return v.cells.every((c) => {
    if (typeof c !== "object" || c === null) return false;
    const cell = c as Record<string, unknown>;
    return (
      typeof cell.id === "string" &&
      typeof cell.source === "string" &&
      typeof cell.params === "object" &&
      cell.params !== null &&
      (cell.structureModulus === null || typeof cell.structureModulus === "number")
    );
  });
}

