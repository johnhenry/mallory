import { Symbolic, type DifferentiationStep, type Expr, type Path2D } from "mallory-math";
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIds, TIME_CELL } from "../lib/cell-ids.ts";
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
import { drawFilledArea, drawPath, drawPoint, drawRegionMask, drawScatter, type Viewport } from "../lib/render-path.ts";
import { sampleExpr, sampleExprAdaptive, sampleRegionMask } from "../lib/sample-function.ts";
import { sampleStructureExpr, type ScatterPoint } from "../lib/sample-structure.ts";
import { evaluateDerivativeAtPoint } from "../lib/point-derivative.ts";
import { findCurveExtrema, type CurveExtrema } from "../lib/curve-extrema.ts";
import { HIGHLIGHT_PRELUDE_SECONDS, timelineDuration, type Keyframe } from "../lib/timeline.ts";
import { COARSE_POINTER_HIT_RADIUS_MULTIPLIER, isCoarsePointer } from "../lib/pointer-media.ts";
import { pathsToSvgDocument } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { AlgebraView } from "./AlgebraView.tsx";
import { CopyableTex } from "./CopyableTex.tsx";
import { KeyframeSliderControl } from "./KeyframeSliderControl.tsx";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";
import { TexSpan } from "./TexSpan.tsx";
import { TransportControls } from "./TransportControls.tsx";
import { useCell } from "../lib/use-cell.ts";
import { canvasEventPoint, toDataX, toScreenX, toScreenY } from "../lib/viewport.ts";

const STRUCTURE_OPTIONS: Array<{ label: string; modulus: number | null }> = [
  { label: "Real numbers", modulus: null },
  { label: "Z/2Z (GF(2))", modulus: 2 },
  { label: "Z/5Z", modulus: 5 },
  { label: "Z/7Z (GF(7))", modulus: 7 },
  { label: "Z/11Z", modulus: 11 },
];

const WIDTH = 600;
const HEIGHT = 600;
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

      graph.define(
        ids.params,
        () => {
          const names = graph.get<string[]>(ids.freeVars);
          const params: Record<string, number> = {};
          for (const name of names) params[name] = graph.get<number>(ids.param(name));
          return params;
        },
        { auxiliary: true },
      );

      let lastGoodPath: Path2D | null = null;
      graph.define(
        ids.path,
        () => {
          try {
            const params = graph.get<Record<string, number>>(ids.params);
            // sampleExprAdaptive (issue #52's flagged finding), not the
            // plain sampleExpr this used before -- matches ExpressionRow's
            // multi-expression rows, which already got the curvature-driven
            // refinement (and its memoization) via #80.
            lastGoodPath = sampleExprAdaptive(
              graph.get<string>(ids.expr),
              { min: viewport.xMin, max: viewport.xMax },
              RESOLUTION,
              AXIS_VARIABLE,
              params,
              undefined,
              {},
              { min: viewport.yMin, max: viewport.yMax },
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
            return sampleRegionMask(expr, { min: viewport.xMin, max: viewport.xMax }, RESOLUTION, AXIS_VARIABLE, params);
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
            const path = sampleExpr(
              expr,
              { min: Math.min(lower, upper), max: Math.max(lower, upper) },
              RESOLUTION,
              AXIS_VARIABLE,
              params,
              undefined,
              { min: viewport.yMin, max: viewport.yMax },
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
}

export function GraphCanvas({
  cellId = DEFAULT_GRAPH_STATE.cells[0].id,
  defaultSource = DEFAULT_GRAPH_STATE.cells[0].source,
  graph: externalGraph,
  showTransport = true,
  syncUrl = true,
  durationCellId,
}: GraphCanvasProps = {}) {
  const viewport = DEFAULT_GRAPH_STATE.viewport;
  const ids = cellIds(cellId);
  const graph = useExpressionGraph(cellId, defaultSource, viewport, externalGraph);
  const navigate = useNavigate();
  // Namespaced by cellId (not a flat "graphing") so two GraphCanvas panes
  // sharing one CellGraph -- LinkedGraphPanes/Linked3DView, and now the
  // Compare tab -- don't collide on tool names: a second registerTool call
  // for an already-taken name throws, caught/console.warn'd by
  // useModelContextTool, silently leaving the second pane un-addressable
  // (mallory-graph#11's resolution).
  useCellGraphTools(`graphing_${cellId}`, graph);
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
  useEffect(() => {
    for (const name of freeVars) {
      const id = ids.param(name);
      if (!graph.hasValue(id)) graph.set(id, defaultSliderRange(name).default);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, freeVars]);
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
    return { source, params, tracks, viewport, duration, latex };
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
      a.download = `mallory-graph-export.${exportFormat}`;
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
  // ChatCommandContext has no way to express.
  function handleChatSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = chatInput.trim();
    if (!input) return;
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
    setSource(cellState.source);
    setMode(decoded.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL fragment in sync with the live graph state, so copying the
  // current URL and opening it elsewhere reproduces the graph exactly.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      const names = graph.get<string[]>(ids.freeVars);
      const params: Record<string, number> = {};
      for (const name of names) params[name] = graph.get<number>(ids.param(name));
      const state: GraphState = {
        v: 3,
        cells: [{ id: cellId, source: graph.get<string>(ids.expr), params, structureModulus: graph.get<number | null>(ids.structure) }],
        viewport,
        mode,
      };
      window.history.replaceState(null, "", `#${encodeGraphState(state)}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, viewport, mode, syncUrl]);

  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (scatter) {
      drawScatter(ctx, scatter, viewport, WIDTH, HEIGHT);
    } else {
      // Shading/fill draws before the curve/handle, so those render on top.
      if (regionMask) drawRegionMask(ctx, regionMask, viewport, WIDTH, HEIGHT);
      if (showArea && area) drawFilledArea(ctx, area.path, viewport, WIDTH, HEIGHT);
      drawPath(ctx, path, viewport, WIDTH, HEIGHT);
      if (showExtrema && extrema) {
        for (const m of extrema.maxima) drawPoint(ctx, m, viewport, WIDTH, HEIGHT, 4, "#16a34a");
        for (const m of extrema.minima) drawPoint(ctx, m, viewport, WIDTH, HEIGHT, 4, "#dc2626");
      }
      if (point) drawPoint(ctx, point, viewport, WIDTH, HEIGHT);
    }
  }, [path, point, scatter, viewport, regionMask, showArea, area, showExtrema, extrema]);

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (!point || modulus !== null) return;
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    const handleSx = toScreenX(point.x, viewport, WIDTH);
    const handleSy = toScreenY(point.y, viewport, HEIGHT);
    // A touch tap is a much less precise target than a mouse click --
    // issue #53's "roll out" item, same isCoarsePointer() widening
    // GraphCanvasMulti's annotation-drag/"Read point" hit-testing already
    // uses.
    const handleHitRadius = isCoarsePointer() ? HANDLE_HIT_RADIUS * COARSE_POINTER_HIT_RADIUS_MULTIPLIER : HANDLE_HIT_RADIUS;
    if (Math.hypot(sx - handleSx, sy - handleSy) > handleHitRadius) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!draggingRef.current) return;
    const { sx } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    const x = Math.min(viewport.xMax, Math.max(viewport.xMin, toDataX(sx, viewport, WIDTH)));
    graph.set(ids.pointX, x);
  }

  function handlePointerUp(e: PointerEvent<HTMLCanvasElement>) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
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
        <label>
          Chat:{" "}
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder='"make it steeper", "animate a from 0 to 5 over 3s", "use GF(7)"...'
            style={{ font: "inherit", width: "32ch" }}
          />
        </label>{" "}
        <button type="submit">Send</button>
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
        <PngExportButton getCanvas={() => canvasRef.current} label="graphing" />{" "}
        <SvgExportButton getSvg={() => (scatter ? null : pathsToSvgDocument([path], viewport, WIDTH, HEIGHT))} label="graphing" />
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

