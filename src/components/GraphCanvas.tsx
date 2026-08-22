import { Symbolic, type DifferentiationStep, type Expr, type Path2D } from "@johnhenry/math";
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CellGraph } from "@johnhenry/math";
import { cellIds, TIME_CELL, workspaceValueCellId, type CellIds } from "../lib/cell-ids.ts";
import { getWorkspaceGraph } from "../lib/workspace-graph.ts";
import { resolveChatCommand, type ChatCommandContext } from "../lib/chat-commands.ts";
import { getExportVideoJob, renderExportPreviewFrame, startExportVideoJob, type ExportVideoInput } from "../lib/export-video.ts";
import { exprToLatex } from "../lib/expr-to-latex.ts";
import { integersModuloStructure } from "../lib/finite-structure.ts";
import { collectFreeVars, defaultSliderRange } from "../lib/free-vars.ts";
import { DEFAULT_GRAPH_STATE, decodeGraphState, encodeGraphState, type GraphState } from "../lib/graph-state.ts";
import { evaluateExactAt } from "../lib/exact-eval.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import { resolveNavigationCommand } from "../lib/nav-sections.ts";
import { resolveNaturalLanguageQuery } from "../lib/nl-query.ts";
import { resolveMatrixNavigationCommand } from "../lib/nl-query-matrix.ts";
import { resolveDiscreteNavigationCommand } from "../lib/nl-query-discrete.ts";
import { drawAxes, drawFilledArea, drawPath, drawPoint, drawRegionMask, drawScatter, type Viewport } from "../lib/render-path.ts";
import { sampleExpr, sampleExprAdaptive, sampleRegionMask } from "../lib/sample-function.ts";
import { sampleStructureExpr, type ScatterPoint } from "../lib/sample-structure.ts";
import { evaluateDerivativeAtPoint } from "../lib/point-derivative.ts";
import { findCurveExtrema, type CurveExtrema } from "../lib/curve-extrema.ts";
import { HIGHLIGHT_PRELUDE_SECONDS, timelineDuration, type Keyframe } from "../lib/timeline.ts";
import { COARSE_POINTER_HIT_RADIUS_MULTIPLIER, isCoarsePointer } from "../lib/pointer-media.ts";
import { pathsToSvgDocument, scatterPointsToSvgDocument } from "../lib/svg-export.ts";
import { pinchZoomFactor, viewportFromAnchor, wheelZoomFactor } from "../lib/viewport-gestures.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useDebouncedSubscribeAll } from "../hooks/use-debounced-subscribe-all.ts";
import { useNonPassiveWheel } from "../hooks/use-non-passive-wheel.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { AlgebraView } from "./AlgebraView.tsx";
import { CopyableTex } from "./CopyableTex.tsx";
import { KeyframeSliderControl } from "./KeyframeSliderControl.tsx";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";
import { TexSpan } from "./TexSpan.tsx";
import { TransportControls } from "./TransportControls.tsx";
import { useCell } from "../lib/use-cell.ts";
import { canvasEventPoint, toDataX, toDataY, toScreenX, toScreenY } from "../lib/viewport.ts";

const STRUCTURE_OPTIONS: Array<{ label: string; modulus: number | null }> = [
  { label: "Real numbers", modulus: null },
  { label: "Z/2Z (GF(2))", modulus: 2 },
  { label: "Z/5Z", modulus: 5 },
  { label: "Z/7Z (GF(7))", modulus: 7 },
  { label: "Z/11Z", modulus: 11 },
];

const WIDTH = 600;
const HEIGHT = 600;

interface GraphCanvasDrawParams {
  viewport: Viewport;
  scatter: ScatterPoint[] | null;
  regionMask: boolean[] | null;
  showArea: boolean;
  area: { path: Path2D } | null;
  path: Path2D;
  showExtrema: boolean;
  extrema: CurveExtrema | null;
  point: { x: number; y: number } | null;
}

/**
 * The main draw effect's logic, extracted as a pure `(ctx, width, height,
 * params)` function (issue #45's remaining scope, item 2: "2x-scale crisp
 * PNG" needs each panel's draw effect exposed this way so a re-render at a
 * higher resolution is a real re-render, not an upscaled blur of the
 * on-screen raster). The live `useEffect` below calls this against the
 * on-screen canvas at `WIDTH x HEIGHT`; `PngExportButton`'s `renderAtScale`
 * calls it again against a fresh offscreen canvas at `2*WIDTH x 2*HEIGHT`.
 * Every `draw*` helper here already takes `width`/`height` as parameters
 * (render-path.ts's own existing contract), so this extraction is a pure
 * mechanical pull-out -- no drawing logic changes.
 */
export function drawGraphCanvas(ctx: CanvasRenderingContext2D, width: number, height: number, params: GraphCanvasDrawParams): void {
  const { viewport, scatter, regionMask, showArea, area, path, showExtrema, extrema, point } = params;
  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, viewport, width, height);
  if (scatter) {
    drawScatter(ctx, scatter, viewport, width, height);
  } else {
    // Shading/fill draws before the curve/handle, so those render on top.
    if (regionMask) drawRegionMask(ctx, regionMask, viewport, width, height);
    if (showArea && area) drawFilledArea(ctx, area.path, viewport, width, height);
    drawPath(ctx, path, viewport, width, height);
    if (showExtrema && extrema) {
      for (const m of extrema.maxima) drawPoint(ctx, m, viewport, width, height, 4, "#16a34a");
      for (const m of extrema.minima) drawPoint(ctx, m, viewport, width, height, 4, "#dc2626");
    }
    if (point) drawPoint(ctx, point, viewport, width, height);
  }
}
const RESOLUTION = 400;
const AXIS_VARIABLE = "x";
const HANDLE_HIT_RADIUS = 12;

interface CurvePoint {
  x: number;
  y: number;
}

interface Derivative {
  steps: DifferentiationStep[];
  result: Expr;
}

interface AreaResult {
  value: number;
  path: Path2D;
}

/**
 * Resolves each free variable's numeric value, checking the app-global
 * workspace (issue #42) before falling back to this pane's own local
 * slider cell -- mirrors `ExpressionRow.tsx`'s `notebookValueCellId`
 * fallback (workspace variables are `set()`, never `get()`-only, so
 * `hasValue` correctly distinguishes a real override from a phantom
 * lookup-created cell; see `WorkspacePanel.tsx`'s `listWorkspaceVariables`
 * doc comment for why that distinction matters). Reads the workspace's
 * OWN separate `CellGraph` instance, not `graph` -- see the `useEffect`
 * in `GraphCanvas` below for why that means this alone isn't reactive to
 * a workspace change and needs an explicit subscription bridge.
 */
export function computeParams(graph: CellGraph, ids: CellIds): Record<string, number> {
  const workspace = getWorkspaceGraph();
  const names = graph.get<string[]>(ids.freeVars);
  const params: Record<string, number> = {};
  for (const name of names) {
    const workspaceId = workspaceValueCellId(name);
    params[name] = workspace.hasValue(workspaceId) ? workspace.get<number>(workspaceId) : graph.get<number>(ids.param(name));
  }
  return params;
}

/**
 * Sets up one pane's reactive cells on `graph` (created fresh unless an
 * `externalGraph` is supplied by a caller that wants several panes to share
 * one CellGraph — see LinkedGraphPanes.tsx): source expr cell -> free-var
 * list -> per-variable slider cells (seeded lazily, so re-parsing on every
 * keystroke doesn't clobber a value the user already dragged) -> params
 * snapshot -> derived sampled-path cell. The path cell falls back to the
 * last successfully sampled path on a parse/eval error, so a mid-typing
 * invalid expression (e.g. "2x sin(") leaves the last good curve on screen
 * instead of blanking the canvas.
 *
 * Guarded by `!graph.has(ids.expr)` (not just the `ref` mount-guard) so that
 * mounting a second GraphCanvas pointed at an already-populated `cellId` on a
 * shared graph is a safe no-op rather than clobbering that pane's state.
 */
function useExpressionGraph(cellId: string, source: string, viewport: Viewport, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const ids = cellIds(cellId);

    if (!graph.has(TIME_CELL)) graph.set(TIME_CELL, 0, { auxiliary: true });

    if (!graph.has(ids.expr)) {
      graph.set(ids.expr, source);
      graph.set(ids.viewport, viewport, { auxiliary: true });
      graph.set<Viewport | null>(ids.liveViewport, null, { auxiliary: true });

      // Kept pure -- no `graph.set()` here. This cell is read via `get()`
      // from inside React's `getSnapshot` during render (through `params`'s
      // and `path`'s own computes), and a write triggered synchronously from
      // there trips React's "Cannot update a component while rendering a
      // different component" guard, which silently drops the resulting
      // update. Newly-discovered free variables get their slider cell seeded
      // by a `useEffect` in GraphCanvas instead (see below).
      graph.define(
        ids.freeVars,
        () => {
          let names: string[] = [];
          try {
            const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            names = collectFreeVars(expr, AXIS_VARIABLE);
          } catch {
            // Leave `names` empty on a mid-typing parse error; sliders just don't update.
          }
          return names;
        },
        { auxiliary: true },
      );

      graph.define(ids.params, () => computeParams(graph, ids), { auxiliary: true });

      let lastGoodPath: Path2D | null = null;
      graph.define(
        ids.path,
        () => {
          try {
            const params = graph.get<Record<string, number>>(ids.params);
            // Reads the COMMITTED viewport (ids.viewport), not a live
            // mid-gesture override (ids.liveViewport) -- panning/pinching
            // stays a pure redraw with zero resampling for the whole
            // gesture, same as GraphCanvasMulti's #52 split.
            const vp = graph.get<Viewport>(ids.viewport);
            // sampleExprAdaptive (issue #52's flagged finding), not the
            // plain sampleExpr this used before -- matches ExpressionRow's
            // multi-expression rows, which already got the curvature-driven
            // refinement (and its memoization) via #80.
            lastGoodPath = sampleExprAdaptive(
              graph.get<string>(ids.expr),
              { min: vp.xMin, max: vp.xMax },
              RESOLUTION,
              AXIS_VARIABLE,
              params,
              undefined,
              {},
              { min: vp.yMin, max: vp.yMax },
            );
          } catch {
            if (!lastGoodPath) throw new Error(`Initial expression "${source}" failed to parse`);
          }
          return lastGoodPath;
        },
        { auxiliary: true },
      );

      // Local maxima/minima markers over the plotted path (issue #28).
      // Depends only on ids.path, so it recomputes exactly when the curve
      // itself changes -- no separate expr/params reads needed here.
      graph.define(
        ids.extrema,
        (): CurveExtrema | null => {
          try {
            return findCurveExtrema(graph.get<Path2D>(ids.path));
          } catch {
            return null;
          }
        },
        { auxiliary: true },
      );

      // 1D inequality shading: only populated when the top-level parsed
      // expression is a `cmp` node (e.g. "sin(x) < cos(x)"), so nothing
      // changes for the vast majority of non-inequality inputs. Samples at
      // the same resolution/grid as `ids.path`. `ids.exact`/`ids.derivative`
      // already degrade gracefully for a `cmp` top-level expr via their own
      // try/catch (Symbolic.evaluateExact/differentiateSteps just don't
      // apply usefully to a bare comparison) -- no new scaffolding needed
      // there.
      graph.define(
        ids.regionMask,
        (): boolean[] | null => {
          try {
            const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            const params = graph.get<Record<string, number>>(ids.params);
            const vp = graph.get<Viewport>(ids.viewport);
            return sampleRegionMask(expr, { min: vp.xMin, max: vp.xMax }, RESOLUTION, AXIS_VARIABLE, params);
          } catch {
            return null;
          }
        },
        { auxiliary: true },
      );

      graph.set(ids.pointX, (viewport.xMin + viewport.xMax) / 2, { auxiliary: true });

      // A handle dragged along the curve: x follows the pointer, y is
      // re-derived from the current expression/params, so it stays
      // curve-constrained through any edit or slider drag.
      let lastGoodPoint: CurvePoint | null = null;
      graph.define(
        ids.point,
        () => {
          try {
            const x = graph.get<number>(ids.pointX);
            const params = graph.get<Record<string, number>>(ids.params);
            const compiled = Symbolic.compile(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            lastGoodPoint = { x, y: compiled({ ...params, [AXIS_VARIABLE]: x }) };
          } catch {
            // Leave the handle at its last good position on a mid-typing parse error.
          }
          return lastGoodPoint;
        },
        { auxiliary: true },
      );

      // Exact numeric f'(x) at the draggable point (issue #28) -- see
      // point-derivative.ts's doc comment for why this goes through
      // Symbolic.differentiate rather than DualNumber forward-mode AD.
      graph.define(
        ids.pointDerivative,
        (): number | null => {
          try {
            const x = graph.get<number>(ids.pointX);
            const params = graph.get<Record<string, number>>(ids.params);
            return evaluateDerivativeAtPoint(preprocessImplicitMultiplication(graph.get<string>(ids.expr)), x, params, AXIS_VARIABLE);
          } catch {
            return null;
          }
        },
        { auxiliary: true },
      );

      // Exact-mode readout: re-evaluates the current handle position over
      // Rational arithmetic instead of floats -- see evaluateExactAt's own
      // doc comment (shared with GraphCanvasMulti's per-row readout, #51).
      graph.define(
        ids.exact,
        () => {
          const x = graph.get<number>(ids.pointX);
          const params = graph.get<Record<string, number>>(ids.params);
          return evaluateExactAt(graph.get<string>(ids.expr), x, params, AXIS_VARIABLE);
        },
        { auxiliary: true },
      );

      // "Show steps" accordion: derivative of the current expression w.r.t. the
      // axis variable, plus a bottom-up trace of every rule applied.
      graph.define(
        ids.derivative,
        (): Derivative | null => {
          try {
            const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            return Symbolic.differentiateSteps(expr, AXIS_VARIABLE);
          } catch {
            return null;
          }
        },
        { auxiliary: true },
      );

      // Area-under-curve: bounds are plain fixed numeric inputs, not the
      // auto-inferred-slider mechanism -- they aren't symbols discovered in
      // the expression, they're independent numeric knobs, so repurposing
      // the free-var/slider machinery would pollute that abstraction.
      graph.set(ids.areaLower, viewport.xMin, { auxiliary: true });
      graph.set(ids.areaUpper, (viewport.xMin + viewport.xMax) / 2, { auxiliary: true });

      let lastGoodArea: AreaResult | null = null;
      graph.define(
        ids.area,
        (): AreaResult | null => {
          try {
            const lower = graph.get<number>(ids.areaLower);
            const upper = graph.get<number>(ids.areaUpper);
            const params = graph.get<Record<string, number>>(ids.params);
            const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            const value = Symbolic.integrateDefinite(expr, lower, upper, AXIS_VARIABLE, params);
            const vp = graph.get<Viewport>(ids.viewport);
            const path = sampleExpr(
              expr,
              { min: Math.min(lower, upper), max: Math.max(lower, upper) },
              RESOLUTION,
              AXIS_VARIABLE,
              params,
              undefined,
              { min: vp.yMin, max: vp.yMax },
            );
            lastGoodArea = { value, path };
          } catch {
            // Leave the last good area/shading on a mid-typing parse error, or
            // an out-of-domain bound (e.g. integrating straight through an asymptote).
          }
          return lastGoodArea;
        },
        { auxiliary: true },
      );

      graph.set(ids.structure, null as number | null, { auxiliary: true });

      // Structure selector: when set to a modulus, plots a finite scatter (all
      // elements of Z/nZ) instead of the continuous sampled path.
      graph.define(
        ids.scatter,
        () => {
          const modulus = graph.get<number | null>(ids.structure);
          if (modulus === null) return null;
          try {
            const params = graph.get<Record<string, number>>(ids.params);
            return sampleStructureExpr(graph.get<string>(ids.expr), integersModuloStructure(modulus), AXIS_VARIABLE, params);
          } catch {
            return [];
          }
        },
        { auxiliary: true },
      );

      // Parameter timeline: a param's value cell is either a plain `set` cell
      // (static, dragged manually) or, once SliderControl enables a keyframe
      // track for it, redefined to interpolate from that track + the shared
      // TIME_CELL -- the same "cell reads another cell's current value"
      // mechanism that powers sliders and direct manipulation elsewhere in
      // this graph, and what lets multiple panes stay in lockstep off one
      // clock (see LinkedGraphPanes.tsx).
      graph.define(
        ids.timelineDuration,
        () => {
          const names = graph.get<string[]>(ids.freeVars);
          return timelineDuration(names.map((name) => graph.get<Keyframe[] | undefined>(ids.track(name))));
        },
        { auxiliary: true },
      );
    }

    ref.current = graph;
  }
  return ref.current;
}

export interface GraphCanvasProps {
  /** Namespaces this pane's cells on `graph`. Defaults to the app's single default cell id. */
  cellId?: string;
  /** Initial expression source for this pane, when it isn't already present on `graph`. */
  defaultSource?: string;
  /** Share an existing CellGraph (e.g. from LinkedGraphPanes) instead of creating a private one. */
  graph?: CellGraph;
  /** Hide the play/pause/loop/speed/export transport — for secondary panes in a linked view. */
  showTransport?: boolean;
  /** Hydrate from and write to the URL fragment. Only one pane per page should do this. */
  syncUrl?: boolean;
  /**
   * Drive the transport (scrub range, play/pause/loop bound) off a different
   * cell than this pane's own `timelineDuration` -- e.g. a `combinedDuration`
   * cell a linked multi-pane view defines as the max across every pane, so
   * scrubbing the primary pane's transport doesn't cut off a longer-running
   * animation on a secondary pane. Defaults to this pane's own duration cell.
   */
  durationCellId?: string;
  /**
   * Starting viewport when this pane's cells aren't already seeded
   * (mallory#305 bug 2). The global default
   * (`DEFAULT_GRAPH_STATE.viewport`, y up to 100) fits the main tab's
   * default `x^2` -- a caller whose `defaultSource` is an amplitude-1
   * trig curve (the Compare tab's sin/cos) must pass a matching viewport
   * or the curves render as a near-flat line squashed at y=0.
   */
  initialViewport?: Viewport;
}

export function GraphCanvas({
  cellId = DEFAULT_GRAPH_STATE.cells[0].id,
  defaultSource = DEFAULT_GRAPH_STATE.cells[0].source,
  graph: externalGraph,
  showTransport = true,
  syncUrl = true,
  durationCellId,
  initialViewport = DEFAULT_GRAPH_STATE.viewport,
}: GraphCanvasProps = {}) {
  const ids = cellIds(cellId);
  const graph = useExpressionGraph(cellId, defaultSource, initialViewport, externalGraph);
  const navigate = useNavigate();
  // Namespaced by cellId (not a flat "graphing") so two GraphCanvas panes
  // sharing one CellGraph -- LinkedGraphPanes/Linked3DView, and now the
  // Compare tab -- don't collide on tool names: a second registerTool call
  // for an already-taken name throws, caught/console.warn'd by
  // useModelContextTool, silently leaving the second pane un-addressable
  // (mallory#11's resolution).
  useCellGraphTools(`graphing_${cellId}`, graph);
  // Pan/zoom (issue #53): `committedViewport` is what curve/region-mask/
  // area sampling reads; `liveViewport` overrides it for a zero-resample
  // redraw during an in-progress wheel/drag/pinch gesture -- see
  // cell-ids.ts's doc comment for the full VIEWPORT_CELL/LIVE_VIEWPORT_CELL
  // rationale (mirrors GraphCanvasMulti's #52/#103 split).
  const committedViewport = useCell<Viewport>(graph, ids.viewport);
  const liveViewport = useCell<Viewport | null>(graph, ids.liveViewport);
  const viewport = liveViewport ?? committedViewport;
  const path = useCell<Path2D>(graph, ids.path);
  const point = useCell<CurvePoint | null>(graph, ids.point);
  const exact = useCell<string | null>(graph, ids.exact);
  const freeVars = useCell<string[]>(graph, ids.freeVars);
  const modulus = useCell<number | null>(graph, ids.structure);
  const scatter = useCell<ScatterPoint[] | null>(graph, ids.scatter);
  const derivative = useCell<Derivative | null>(graph, ids.derivative);
  const pointDerivative = useCell<number | null>(graph, ids.pointDerivative);
  const extrema = useCell<CurveExtrema | null>(graph, ids.extrema);
  const regionMask = useCell<boolean[] | null>(graph, ids.regionMask);
  const areaLower = useCell<number>(graph, ids.areaLower);
  const areaUpper = useCell<number>(graph, ids.areaUpper);
  const area = useCell<AreaResult | null>(graph, ids.area);
  const time = useCell<number>(graph, TIME_CELL);
  const duration = useCell<number>(graph, durationCellId ?? ids.timelineDuration);
  const exprValue = useCell<string>(graph, ids.expr);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  // Pan/pinch gesture state (issue #53), mirroring GraphCanvasMulti's own
  // dragRef/activePointersRef exactly -- "point" here is the existing
  // curve-handle drag (handlePointerDown's hit-test below), kept as its own
  // kind so it can coexist with pan/pinch on the same canvas: a pointerdown
  // ON the handle drags it, anywhere else starts a pan.
  const gestureRef = useRef<
    | { kind: "pan"; anchorX: number; anchorY: number; spanX: number; spanY: number }
    | { kind: "pinch"; anchorX: number; anchorY: number; spanX: number; spanY: number; startDistancePx: number }
    | null
  >(null);
  const activePointersRef = useRef<Map<number, { sx: number; sy: number }>>(new Map());
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [source, setSource] = useState(defaultSource);

  // Keeps the input box's displayed text in sync whenever `ids.expr` changes
  // for a reason other than typing in this same box -- e.g. a chat command,
  // or a linked pane hydrating from the URL (LinkedGraphPanes.tsx) after this
  // component has already mounted with its hardcoded default source.
  useEffect(() => {
    setSource(exprValue);
  }, [exprValue]);

  // Seeds a slider cell for each newly-discovered free variable. This used
  // to be a side effect of `ids.freeVars`'s compute, but that cell is read
  // synchronously during render (via useCell -> useSyncExternalStore), and
  // writing to other cells from there trips React's "Cannot update a
  // component while rendering a different component" guard -- the write
  // gets dropped and `params`'s dependency edges never get established, so
  // later slider drags silently fail to redraw the curve. Doing it in an
  // effect defers the write until after render, where it's safe.
  const prevFreeVarsRef = useRef<string[]>([]);
  useEffect(() => {
    for (const name of freeVars) {
      const id = ids.param(name);
      if (!graph.hasValue(id)) graph.set(id, defaultSliderRange(name).default);
    }
    // Delete param/track cells for names that LEFT the free-variable set
    // (issue #309): every mid-typing keystroke parses live, so typing
    // "sin(k*x)" transiently yields free vars `s`, then `s`+`i` (implicit
    // multiplication), then `sin` -- each seeding a param cell above --
    // and nothing ever removed them, leaving `param:pane-a:i/s/sin`
    // cluttering the cell graph and the Objects panel forever. Losing a
    // mistyped-then-retyped slider value is the accepted tradeoff; the
    // sliders UI only ever renders CURRENT free vars anyway.
    for (const name of prevFreeVarsRef.current) {
      if (!freeVars.includes(name)) {
        graph.delete(ids.param(name));
        graph.delete(ids.track(name));
      }
    }
    prevFreeVarsRef.current = freeVars;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, freeVars]);

  // Bridges the workspace's own separate CellGraph into this pane's
  // reactivity (issue #42): `computeParams` reads `getWorkspaceGraph()`
  // directly rather than through THIS graph's `get()`, so CellGraph's
  // per-instance dependency tracking (`this.stack`) never sees that read --
  // a workspace variable changing would otherwise silently fail to redraw
  // the curve. Redefining `ids.params` with the SAME compute function is
  // how `graph.define()`'s own "redefine forces an immediate, synchronous
  // recompute" behavior (see cell-graph.ts) is (ab)used here as a manual
  // "something this cell depends on outside the graph just changed" signal.
  useEffect(() => {
    const workspace = getWorkspaceGraph();
    return workspace.subscribeAll(() => {
      graph.define(ids.params, () => computeParams(graph, ids), { auxiliary: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);
  const [mode, setMode] = useState<"float" | "exact">("float");
  const [showSteps, setShowSteps] = useState(false);
  const [showArea, setShowArea] = useState(false);
  const [showExtrema, setShowExtrema] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [exportFormat, setExportFormat] = useState<"mp4" | "gif">("mp4");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const startExportVideoJobFn = useServerFn(startExportVideoJob);
  const getExportVideoJobFn = useServerFn(getExportVideoJob);
  const renderExportPreviewFrameFn = useServerFn(renderExportPreviewFrame);

  /** The export payload, shared by the full render job and the scrub preview so they can't drift apart. */
  function buildExportInput(): Omit<ExportVideoInput, "format"> {
    const names = graph.get<string[]>(ids.freeVars);
    const params: Record<string, number> = {};
    const tracks: Record<string, Keyframe[] | undefined> = {};
    for (const name of names) {
      params[name] = graph.get<number>(ids.param(name));
      tracks[name] = graph.get<Keyframe[] | undefined>(ids.track(name));
    }
    const source = graph.get<string>(ids.expr);
    // Typeset equation label for the exported clip -- a nicety; a
    // mid-typing parse failure just omits it.
    let latex: string | undefined;
    try {
      latex = exprToLatex(Symbolic.parse(preprocessImplicitMultiplication(source)));
    } catch {
      latex = undefined;
    }
    // The committed viewport (not a live mid-gesture one) -- the server
    // export renders against exactly what curve sampling itself uses.
    return { source, params, tracks, viewport: graph.get<Viewport>(ids.viewport), duration, latex };
  }

  // Fetched on slider release (not per drag tick): a frame render is fast
  // but not free, and a drag emits dozens of ticks.
  async function fetchPreviewFrame(time: number) {
    setPreviewLoading(true);
    setExportError(null);
    try {
      const frame = await renderExportPreviewFrameFn({ data: { ...buildExportInput(), format: exportFormat, time } });
      setPreviewSrc(`data:${frame.mimeType};base64,${frame.data}`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  // Phase 11b: the render runs as a background job (see export-video.ts)
  // rather than inside one SSR request, so a long or high-res export doesn't
  // hold a request open for the whole render -- this just polls for
  // completion instead of awaiting a single response. No duration cap here:
  // longer exports simply take longer to poll for.
  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const { jobId } = await startExportVideoJobFn({
        data: { ...buildExportInput(), format: exportFormat },
      });
      const job = await new Promise<Awaited<ReturnType<typeof getExportVideoJobFn>>>((resolve, reject) => {
        const poll = () => {
          getExportVideoJobFn({ data: { jobId } }).then((status) => {
            if (status.status === "pending") setTimeout(poll, 1000);
            else resolve(status);
          }, reject);
        };
        poll();
      });
      if (job.status !== "done") {
        throw new Error(job.status === "error" ? job.message : "Export job did not complete.");
      }
      const { data, mimeType } = job.result;
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `mallory-export.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<Array<{ input: string; ok: boolean; message: string }>>([]);

  // Phase 10 (rule-based MVP): a chat message resolves to exactly the same
  // CellGraph operation a human would trigger through the UI -- there's no
  // separate "chat state" to drift out of sync with direct manipulation.
  //
  // Navigation phrasings ("go to statistics", "open the 3D view") are
  // checked FIRST, before resolveChatCommand -- issue #46's "routing
  // layer" item -- since they're a router action (leaving this panel
  // entirely), not a CellGraph mutation resolveChatCommand's
  // ChatCommandContext has no way to express. The matrix-literal
  // state-prefilled resolver is checked ahead of the bare-path one since
  // it's the more specific match (a literal-bearing phrasing, not just a
  // section name) -- issue #46's "State-prefilled navigation" item.
  function handleChatSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = chatInput.trim();
    if (!input) return;
    const matrixNav = resolveMatrixNavigationCommand(input);
    if (matrixNav) {
      setChatLog((log) => [...log, { input, ok: true, message: "Navigating to the matrix panel…" }]);
      setChatInput("");
      navigate(matrixNav);
      return;
    }
    const discreteNav = resolveDiscreteNavigationCommand(input);
    if (discreteNav) {
      setChatLog((log) => [...log, { input, ok: true, message: "Navigating to the discrete panel…" }]);
      setChatInput("");
      navigate(discreteNav);
      return;
    }
    const navPath = resolveNavigationCommand(input);
    if (navPath) {
      setChatLog((log) => [...log, { input, ok: true, message: `Navigating to ${navPath}…` }]);
      setChatInput("");
      navigate({ to: navPath });
      return;
    }
    const ctx: ChatCommandContext = { graph, ids, freeVars, setSource, setMode, setPlaying, setLoop, setSpeed };
    const result = resolveChatCommand(input, ctx);
    setChatLog((log) => [
      ...log,
      {
        input,
        ok: result?.ok ?? false,
        message:
          result?.message ??
          `Didn't understand that. Try things like "set a to 3", "make it steeper", "animate a from 0 to 5 over 3s", "play", or "use GF(7)".`,
      },
    ]);
    setChatInput("");
  }

  // Hydrate from the URL fragment (if any) once, on mount. Params/structure
  // are written before the source, so by the time the seeding effect above
  // sees the new source's free vars, these slider cells are already
  // populated and its `if (!graph.hasValue(id))` guard leaves them alone.
  // Only one pane per page should have `syncUrl` on -- a linked multi-pane
  // view (LinkedGraphPanes.tsx) turns this off for every pane and does its
  // own combined hydration/write across every pane's cell instead.
  useEffect(() => {
    if (!syncUrl) return;
    const decoded = decodeGraphState(window.location.hash.slice(1));
    if (!decoded) return;
    const cellState = decoded.cells.find((c) => c.id === cellId) ?? decoded.cells[0];
    for (const [name, value] of Object.entries(cellState.params)) graph.set(ids.param(name), value);
    graph.set(ids.structure, cellState.structureModulus);
    graph.set(ids.expr, cellState.source);
    graph.set(ids.viewport, decoded.viewport);
    setSource(cellState.source);
    setMode(decoded.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL fragment in sync with the live graph state, so copying the
  // current URL and opening it elsewhere reproduces the graph exactly.
  // Debounced (issue #235), not a plain subscribeAll: writeUrl reads
  // neither TIME_CELL nor ids.liveViewport (only the gesture-end-committed
  // ids.viewport, per the comment below), so a subscribeAll here used to
  // re-run writeUrl -- rebuilding the params object and calling
  // history.replaceState -- on every RAF tick of timeline playback and
  // every mid-gesture pointermove/wheel tick, even though neither changes
  // what gets written. ids.freeVars/ids.param(name) are a dynamic
  // per-expression set, so this can't cleanly switch to `subscribeMany`
  // the way the fixed-cell-list panels (GraphTheoryPanel, ComplexPanel,
  // MlPlaygroundPanel) did.
  function writeUrl() {
    const names = graph.get<string[]>(ids.freeVars);
    const params: Record<string, number> = {};
    for (const name of names) params[name] = graph.get<number>(ids.param(name));
    const state: GraphState = {
      v: 3,
      cells: [{ id: cellId, source: graph.get<string>(ids.expr), params, structureModulus: graph.get<number | null>(ids.structure) }],
      // Committed, not live -- so the URL doesn't wobble on every
      // mid-gesture pointermove/wheel tick, only on gesture-end commit.
      viewport: graph.get<Viewport>(ids.viewport),
      mode,
    };
    window.history.replaceState(null, "", `#${encodeGraphState(state)}`);
  }
  useEffect(() => {
    if (!syncUrl) return;
    writeUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, mode, syncUrl]);
  useDebouncedSubscribeAll(graph, writeUrl, 250, syncUrl);

  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    drawGraphCanvas(ctx, WIDTH, HEIGHT, { viewport, scatter, regionMask, showArea, area, path, showExtrema, extrema, point });
  }, [path, point, scatter, viewport, regionMask, showArea, area, showExtrema, extrema]);

  /** Copies a pending live-viewport override into the real, sampled-against viewport (the gesture-end resample) and clears the override -- shared by pan/pinch release and the wheel-zoom debounce below. */
  function commitLiveViewport() {
    const live = graph.get<Viewport | null>(ids.liveViewport);
    if (!live) return;
    graph.set(ids.viewport, live);
    graph.set<Viewport | null>(ids.liveViewport, null);
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    // A scroll-then-immediately-drag sequence could otherwise start the new
    // gesture's anchor capture against a stale pre-zoom committed viewport
    // while the zoomed position only exists in the live one -- same guard
    // GraphCanvasMulti's own handleCanvasPointerDown uses.
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    commitLiveViewport();

    const downPoint = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    activePointersRef.current.set(e.pointerId, downPoint);

    if (activePointersRef.current.size >= 2) {
      // Pinch-to-zoom (issue #53): a second finger touching down overrides
      // whatever single-pointer gesture (point-drag/pan) was in progress --
      // picks the two most recently added touches, same as Multi.
      const [p1, p2] = [...activePointersRef.current.values()].slice(-2) as [{ sx: number; sy: number }, { sx: number; sy: number }];
      const midSx = (p1.sx + p2.sx) / 2;
      const midSy = (p1.sy + p2.sy) / 2;
      const vp = graph.get<Viewport | null>(ids.liveViewport) ?? graph.get<Viewport>(ids.viewport);
      gestureRef.current = {
        kind: "pinch",
        anchorX: toDataX(midSx, vp, WIDTH),
        anchorY: toDataY(midSy, vp, HEIGHT),
        spanX: vp.xMax - vp.xMin,
        spanY: vp.yMax - vp.yMin,
        startDistancePx: Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy),
      };
      draggingRef.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (point && modulus === null) {
      const { sx, sy } = downPoint;
      const handleSx = toScreenX(point.x, viewport, WIDTH);
      const handleSy = toScreenY(point.y, viewport, HEIGHT);
      // A touch tap is a much less precise target than a mouse click --
      // issue #53's "roll out" item, same isCoarsePointer() widening
      // GraphCanvasMulti's annotation-drag/"Read point" hit-testing already
      // uses.
      const handleHitRadius = isCoarsePointer() ? HANDLE_HIT_RADIUS * COARSE_POINTER_HIT_RADIUS_MULTIPLIER : HANDLE_HIT_RADIUS;
      if (Math.hypot(sx - handleSx, sy - handleSy) <= handleHitRadius) {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Neither pinch nor a handle hit -- start a pan. Anchors the data point
    // currently under the cursor; every subsequent pointermove recomputes
    // the viewport from scratch so that same data point stays under the
    // cursor, rather than accumulating per-frame deltas.
    const vp = graph.get<Viewport>(ids.viewport);
    const { sx, sy } = downPoint;
    gestureRef.current = {
      kind: "pan",
      anchorX: toDataX(sx, vp, WIDTH),
      anchorY: toDataY(sy, vp, HEIGHT),
      spanX: vp.xMax - vp.xMin,
      spanY: vp.yMax - vp.yMin,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT));
    }
    if (draggingRef.current) {
      const { sx } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
      const x = Math.min(viewport.xMax, Math.max(viewport.xMin, toDataX(sx, viewport, WIDTH)));
      graph.set(ids.pointX, x);
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      // Only the ONE pointer that generated this event is in `e` -- both
      // touches' up-to-date positions come back out of activePointersRef.
      const points = [...activePointersRef.current.values()].slice(-2);
      if (points.length < 2) return; // a finger lifted without a matching pointerup somehow -- ignore this tick
      const [p1, p2] = points as [{ sx: number; sy: number }, { sx: number; sy: number }];
      const currentDistancePx = Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy);
      if (currentDistancePx < 1) return; // fingers overlapping -- avoid a near-zero-divide factor spike
      const factor = pinchZoomFactor(gesture.startDistancePx, currentDistancePx);
      const spanX = gesture.spanX * factor;
      const spanY = gesture.spanY * factor;
      const midSx = (p1.sx + p2.sx) / 2;
      const midSy = (p1.sy + p2.sy) / 2;
      graph.set(ids.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, midSx, midSy, spanX, spanY, WIDTH, HEIGHT));
      return;
    }
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    // Live-only write: ids.path/regionMask/area all depend on ids.viewport,
    // not this cell, so panning stays a pure redraw -- zero resampling --
    // for the whole gesture. Committed to ids.viewport (the one real
    // resample) on pointerup below.
    graph.set(ids.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, sx, sy, gesture.spanX, gesture.spanY, WIDTH, HEIGHT));
  }

  function handlePointerUp(e: PointerEvent<HTMLCanvasElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (draggingRef.current) {
      draggingRef.current = false;
    } else {
      if (gestureRef.current?.kind === "pan" || gestureRef.current?.kind === "pinch") commitLiveViewport();
      gestureRef.current = null;
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const ZOOM_STEP = 1.1;
  const ZOOM_COMMIT_DEBOUNCE_MS = 150;

  /**
   * Wheel-to-zoom, anchored on the cursor's data point (same anchor
   * technique as panning). Live-only: a trackpad's continuous scroll has no
   * discrete "gesture end" event the way a pointerup does, so the real
   * commit (the resample) is debounced instead -- fires
   * `ZOOM_COMMIT_DEBOUNCE_MS` after the last wheel event, reset on every
   * new one, matching GraphCanvasMulti's own handleCanvasWheel exactly.
   *
   * Attached via `useNonPassiveWheel` below, NOT the React `onWheel` prop --
   * see that hook's own doc comment for why `preventDefault()` here only
   * actually stops the page from also scrolling when the listener itself is
   * non-passive.
   */
  function handleWheel(e: WheelEvent) {
    if (!canvasRef.current) return;
    e.preventDefault();
    const vp = graph.get<Viewport | null>(ids.liveViewport) ?? graph.get<Viewport>(ids.viewport);
    const { sx, sy } = canvasEventPoint(e, canvasRef.current, WIDTH, HEIGHT);
    const anchorX = toDataX(sx, vp, WIDTH);
    const anchorY = toDataY(sy, vp, HEIGHT);
    const factor = wheelZoomFactor(e.deltaY, ZOOM_STEP);
    const spanX = (vp.xMax - vp.xMin) * factor;
    const spanY = (vp.yMax - vp.yMin) * factor;
    graph.set(ids.liveViewport, viewportFromAnchor(anchorX, anchorY, sx, sy, spanX, spanY, WIDTH, HEIGHT));
    if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    zoomCommitTimerRef.current = setTimeout(() => {
      zoomCommitTimerRef.current = null;
      commitLiveViewport();
    }, ZOOM_COMMIT_DEBOUNCE_MS);
  }
  useNonPassiveWheel(canvasRef, handleWheel);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  function resetView() {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    graph.set<Viewport | null>(ids.liveViewport, null);
    graph.set(ids.viewport, initialViewport);
  }

  return (
    <div>
      <label>
        y ={" "}
        <input
          value={source}
          onChange={(e) => {
            const value = e.target.value;
            setSource(value);
            graph.set(ids.expr, resolveNaturalLanguageQuery(value) ?? value);
          }}
          style={{ font: "inherit", width: "20ch" }}
        />
      </label>
      <div style={{ margin: "0.5rem 0" }}>
        <AlgebraView graph={graph} />
      </div>
      {freeVars.length > 0 && (
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "0.5rem 0" }}>
          {freeVars.map((name) => (
            <KeyframeSliderControl key={name} graph={graph} ids={ids} name={name} />
          ))}
        </div>
      )}
      <form onSubmit={handleChatSubmit} style={{ margin: "0.5rem 0" }}>
        <label title="A fixed set of command phrasings, not free-text chat -- the placeholder shows the shapes it understands.">
          Commands:{" "}
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder='"make it steeper", "animate a from 0 to 5 over 3s", "use GF(7)"...'
            style={{ font: "inherit", width: "32ch" }}
          />
        </label>{" "}
        <button type="submit">Run</button>
        {chatLog.length > 0 && (
          <ul style={{ fontSize: "0.85rem", listStyle: "none", padding: 0, margin: "0.25rem 0" }}>
            {chatLog.slice(-5).map((entry, i) => (
              <li key={i} style={{ color: entry.ok ? "inherit" : "var(--danger)" }}>
                <strong>{entry.input}</strong> — {entry.message}
              </li>
            ))}
          </ul>
        )}
      </form>
      {showTransport && (
        <TransportControls
          graph={graph}
          time={time}
          duration={duration}
          playing={playing}
          setPlaying={setPlaying}
          loop={loop}
          setLoop={setLoop}
          speed={speed}
          setSpeed={setSpeed}
        />
      )}
      {showTransport && duration > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", margin: "0.5rem 0" }}>
          <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as "mp4" | "gif")}>
            <option value="mp4">MP4</option>
            <option value="gif">GIF</option>
          </select>
          <button type="button" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export"}
          </button>
          {exportError && <span style={{ color: "var(--danger)" }}>{exportError}</span>}
        </div>
      )}
      {showTransport && duration > 0 && (
        <div style={{ margin: "0.5rem 0" }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Export preview</span>
            {/* Slider spans the full clip: highlight prelude + parameter
                animation. With no root crossings the prelude doesn't play
                and times past the animation clamp to the final frame --
                harmless. Fetch happens on release (pointer up / key up),
                not per drag tick. */}
            <input
              type="range"
              min={0}
              max={duration + HIGHLIGHT_PRELUDE_SECONDS}
              step={0.05}
              value={previewTime}
              onChange={(e) => setPreviewTime(Number(e.target.value))}
              onPointerUp={() => void fetchPreviewFrame(previewTime)}
              onKeyUp={() => void fetchPreviewFrame(previewTime)}
            />
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              {previewTime.toFixed(2)}s{previewLoading ? " — rendering…" : previewSrc ? "" : " — release to preview"}
            </span>
          </label>
          {previewSrc && (
            <img
              src={previewSrc}
              alt={`Export preview frame at ${previewTime.toFixed(2)}s`}
              width={160}
              height={160}
              style={{ border: "1px solid var(--border)", display: "block", marginTop: "0.25rem", opacity: previewLoading ? 0.5 : 1 }}
            />
          )}
        </div>
      )}
      <label style={{ display: "block", margin: "0.5rem 0" }}>
        Structure:{" "}
        <select
          value={modulus === null ? "real" : STRUCTURE_OPTIONS.some((opt) => opt.modulus === modulus) ? String(modulus) : "custom"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "real") graph.set(ids.structure, null);
            else if (v === "custom") graph.set(ids.structure, 13); // seed a default so the number input below has something to edit
            else graph.set(ids.structure, Number(v));
          }}
        >
          {STRUCTURE_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.modulus === null ? "real" : String(opt.modulus)}>
              {opt.label}
            </option>
          ))}
          <option value="custom">Custom Z/nZ…</option>
        </select>
        {modulus !== null && !STRUCTURE_OPTIONS.some((opt) => opt.modulus === modulus) && (
          <>
            {" "}
            n:{" "}
            <input
              type="number"
              min={2}
              value={modulus}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 2) graph.set(ids.structure, n);
              }}
              style={{ font: "inherit", width: "6ch" }}
            />
          </>
        )}
      </label>
      {modulus === null && (
        <div role="radiogroup" aria-label="Arithmetic mode" style={{ margin: "0.5rem 0" }}>
          <label>
            <input
              type="radio"
              name={`mode-${cellId}`}
              checked={mode === "float"}
              onChange={() => setMode("float")}
            />{" "}
            Float
          </label>{" "}
          <label>
            <input
              type="radio"
              name={`mode-${cellId}`}
              checked={mode === "exact"}
              onChange={() => setMode("exact")}
            />{" "}
            Exact
          </label>
        </div>
      )}
      <div>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          style={{ border: "1px solid var(--border)", touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="graphing"
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
          renderAtScale={(ctx, width, height) => drawGraphCanvas(ctx, width, height, { viewport, scatter, regionMask, showArea, area, path, showExtrema, extrema, point })}
        />{" "}
        <SvgExportButton
          getSvg={() => (scatter ? scatterPointsToSvgDocument(scatter, viewport, WIDTH, HEIGHT) : pathsToSvgDocument([path], viewport, WIDTH, HEIGHT))}
          label="graphing"
        />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
      {modulus === null && point && (
        <div>
          y = {mode === "exact" ? exact ?? `${point.y.toFixed(4)} (not exact)` : point.y.toFixed(4)}
          {pointDerivative !== null && <>, f'({point.x.toFixed(4)}) = {pointDerivative.toFixed(6)}</>}
        </div>
      )}
      {modulus === null && derivative && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={() => setShowSteps((v) => !v)}>
            {showSteps ? "▾" : "▸"} Show steps
          </button>{" "}
          dy/dx = <CopyableTex tex={exprToLatex(derivative.result)} />
          {showSteps && (
            <ol>
              {derivative.steps.map((step, i) => (
                <li key={i}>
                  <strong>{step.rule}</strong>: d/dx[<TexSpan tex={exprToLatex(step.input)} />] ={" "}
                  <TexSpan tex={exprToLatex(step.output)} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {modulus === null && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={() => setShowArea((v) => !v)}>
            {showArea ? "▾" : "▸"} Area under curve
          </button>
          {showArea && (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "0.25rem 0" }}>
              <label>
                from{" "}
                <input
                  type="number"
                  value={areaLower ?? 0}
                  step={0.1}
                  style={{ width: "6ch" }}
                  onChange={(e) => graph.set(ids.areaLower, Number(e.target.value))}
                />
              </label>
              <label>
                to{" "}
                <input
                  type="number"
                  value={areaUpper ?? 0}
                  step={0.1}
                  style={{ width: "6ch" }}
                  onChange={(e) => graph.set(ids.areaUpper, Number(e.target.value))}
                />
              </label>
              <span>Area = {area ? area.value.toFixed(4) : "—"}</span>
            </div>
          )}
        </div>
      )}
      {modulus === null && (
        <div style={{ margin: "0.5rem 0" }}>
          <label>
            <input type="checkbox" checked={showExtrema} onChange={(e) => setShowExtrema(e.target.checked)} /> Show extrema
          </label>
          {showExtrema && extrema && (extrema.maxima.length > 0 || extrema.minima.length > 0) && (
            <ul style={{ margin: "0.25rem 0" }}>
              {extrema.maxima.map((m, i) => (
                <li key={`max-${i}`} style={{ color: "#16a34a" }}>
                  max at ({m.x.toFixed(4)}, {m.y.toFixed(4)})
                </li>
              ))}
              {extrema.minima.map((m, i) => (
                <li key={`min-${i}`} style={{ color: "#dc2626" }}>
                  min at ({m.x.toFixed(4)}, {m.y.toFixed(4)})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

