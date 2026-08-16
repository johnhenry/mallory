import { isComplexStateV2, type ComplexState } from "./complex-state.ts";
import { isGeometryStateV1, type GeometryState } from "./geometry-state.ts";
import { TENSOR_OP_LABELS, type TensorOpType } from "./tensor-block.ts";
import { isOdeStateV1, type OdeState } from "./ode-state.ts";
import { isOdeSystemStateV1, type OdeSystemState } from "./ode-system-state.ts";
import { isRegressionStateV1, type RegressionState } from "./regression-state.ts";
import { isStatisticsStateV1, type StatisticsState } from "./statistics-state.ts";
import { isSystemStateV1, type SystemState } from "./system-state.ts";

/**
 * URL-state schema for NotebookPanel, parallel to multi-graph-state.ts's
 * schema for GraphCanvasMulti (not layered onto either's own lineage, since
 * a notebook document -- an ordered mix of text/graph/value blocks -- is a
 * genuinely different shape from a single row list). Same base64url-in-the-
 * hash convention: no server round-trip, Desmos-style. Duplicates its own
 * tiny base64url helpers rather than sharing them with multi-graph-state.ts,
 * matching that file's own choice not to factor them out either.
 *
 * The 6 later block types (surface3d/ode/ode-system/regression/statistics/
 * geometry, added in the organizational gap-fixing pass) each nest their
 * standalone panel's own already-existing state shape/validator (ode-
 * state.ts etc.) rather than re-declaring the fields -- one exception,
 * `NotebookSurface3DBlockStateV1`, since Graph3DCanvas has no independent
 * top-level save/URL state of its own (only Linked3DView's combined
 * `linked3d-state.ts` does).
 */
export interface NotebookGraphBlockStateV1 {
  type: "graph";
  /** `name` (issue #35 item 2): publishes this row's sampled curve under a referenceable name -- see `notebookCurveCellId`. Omitted/empty means "not published," same as an un-named row today. */
  rows: Array<{ source: string; color: number; visible: boolean; params: Record<string, number>; name?: string }>;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
}

/**
 * Numeric derivative/integral/difference of one or two named published
 * curves (issue #35 item 2), computed via `mallory-iteration`'s
 * `pairwiseSync`/`transducers.accumulate`, or (for `"difference"`) plain
 * linear interpolation -- see `curve-transform.ts`. `curveName2` is only
 * meaningful for `op: "difference"`; optional (not a schema version bump)
 * so an old saved derivative/integral block still decodes.
 */
export interface NotebookCurveTransformBlockStateV1 {
  type: "curve-transform";
  curveName: string;
  op: "derivative" | "integral" | "difference";
  curveName2?: string;
}

export interface NotebookSurface3DBlockStateV1 {
  type: "surface3d";
  expr: string;
  params: Record<string, number>;
}

export interface NotebookOdeBlockStateV1 {
  type: "ode";
  state: OdeState;
}

export interface NotebookOdeSystemBlockStateV1 {
  type: "ode-system";
  state: OdeSystemState;
}

export interface NotebookRegressionBlockStateV1 {
  type: "regression";
  state: RegressionState;
}

export interface NotebookStatisticsBlockStateV1 {
  type: "statistics";
  state: StatisticsState;
}

export interface NotebookSystemsBlockStateV1 {
  type: "systems";
  state: SystemState;
}

export interface NotebookGeometryBlockStateV1 {
  type: "geometry";
  state: GeometryState;
}

export interface NotebookComplexBlockStateV1 {
  type: "complex";
  state: ComplexState;
}

/** A small literal tensor (the raw grid TEXT, not a parsed array -- mid-typing invalid input must survive a save/reload round trip) plus one structural/elementwise op applied for display. */
export interface NotebookTensorBlockStateV1 {
  type: "tensor";
  source: string;
  op: TensorOpType;
  /** Read only by ops in `TENSOR_OPS_WITH_ARG` (pad's border width, repeat's row count). Optional (not a schema version bump) -- an additive field defaulting to 1 downstream, same convention StatisticsPanel's own inference fields already use for a reload-safe default rather than forcing every existing saved tensor block through a migration. */
  opArg?: number;
  /**
   * "curve" source (issue #35's remaining scope: "a tensor block built
   * from a curve's samples") reads a named published curve instead of
   * parsing `source` as a literal grid -- see `curveToTensorGrid`. Both
   * fields optional (not a schema version bump), same additive-field
   * convention as `opArg` above; an old saved block with neither still
   * decodes as the literal-grid default.
   */
  sourceMode?: "literal" | "curve";
  curveName?: string;
}

export type NotebookBlockStateV1 =
  | { type: "text"; content: string }
  | NotebookGraphBlockStateV1
  | { type: "value"; name: string; value: number }
  | NotebookSurface3DBlockStateV1
  | NotebookOdeBlockStateV1
  | NotebookOdeSystemBlockStateV1
  | NotebookRegressionBlockStateV1
  | NotebookStatisticsBlockStateV1
  | NotebookSystemsBlockStateV1
  | NotebookGeometryBlockStateV1
  | NotebookComplexBlockStateV1
  | NotebookTensorBlockStateV1
  | NotebookCurveTransformBlockStateV1;

export interface NotebookStateV1 {
  v: 1;
  blocks: NotebookBlockStateV1[];
}

export type NotebookState = NotebookStateV1;

export const DEFAULT_NOTEBOOK_STATE: NotebookState = {
  v: 1,
  blocks: [
    {
      type: "text",
      content:
        "A reactive notebook: mix free-form notes with live graph cells and named value cells. Every graph cell below shares one CellGraph, so a graph cell's expression can reference an earlier value cell by name -- e.g. a value block named \"k\" makes \"k\" available to any graph cell below it, sourced live instead of getting its own independent slider. A graph row can also be given a name (via its row's \"name\" field) to publish its whole curve, which a \"curve transform\" block below can then reference to compute a numeric derivative or running integral.",
    },
    {
      type: "graph",
      rows: [{ source: "sin(x)", color: 0x2563eb, visible: true, params: {} }],
      viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
    },
  ],
};

export function encodeNotebookState(state: NotebookState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeNotebookState(fragment: string): NotebookState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isNotebookStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isNotebookStateV1(value: unknown): value is NotebookStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !Array.isArray(v.blocks)) return false;
  return v.blocks.every(isNotebookBlockStateV1);
}

function isNotebookBlockStateV1(value: unknown): value is NotebookBlockStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  if (b.type === "text") return typeof b.content === "string";
  if (b.type === "value") return typeof b.name === "string" && typeof b.value === "number";
  if (b.type === "graph") {
    if (typeof b.viewport !== "object" || b.viewport === null || !Array.isArray(b.rows)) return false;
    return b.rows.every((r) => {
      if (typeof r !== "object" || r === null) return false;
      const row = r as Record<string, unknown>;
      return (
        typeof row.source === "string" &&
        typeof row.color === "number" &&
        typeof row.visible === "boolean" &&
        typeof row.params === "object" &&
        row.params !== null &&
        (row.name === undefined || typeof row.name === "string")
      );
    });
  }
  if (b.type === "surface3d") {
    return typeof b.expr === "string" && typeof b.params === "object" && b.params !== null;
  }
  if (b.type === "ode") return isOdeStateV1(b.state);
  if (b.type === "ode-system") return isOdeSystemStateV1(b.state);
  if (b.type === "regression") return isRegressionStateV1(b.state);
  if (b.type === "statistics") return isStatisticsStateV1(b.state);
  if (b.type === "systems") return isSystemStateV1(b.state);
  if (b.type === "geometry") return isGeometryStateV1(b.state);
  if (b.type === "complex") return isComplexStateV2(b.state);
  if (b.type === "tensor") {
    if (typeof b.source !== "string" || typeof b.op !== "string" || !(b.op in TENSOR_OP_LABELS)) return false;
    if (b.opArg !== undefined && typeof b.opArg !== "number") return false;
    if (b.sourceMode !== undefined && b.sourceMode !== "literal" && b.sourceMode !== "curve") return false;
    return b.curveName === undefined || typeof b.curveName === "string";
  }
  if (b.type === "curve-transform") {
    if (typeof b.curveName !== "string" || (b.op !== "derivative" && b.op !== "integral" && b.op !== "difference")) return false;
    return b.curveName2 === undefined || typeof b.curveName2 === "string";
  }
  return false;
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
