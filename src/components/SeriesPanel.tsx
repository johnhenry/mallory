import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSeries, type CellIdsSeries } from "../lib/cell-ids.ts";
import { analyzeSeries, computeSeriesViewport, type SeriesResult } from "../lib/series-analysis.ts";
import { DEFAULT_SERIES_STATE, decodeSeriesState, encodeSeriesState, type SeriesState } from "../lib/series-state.ts";
import { drawAxes, drawScatter, type Viewport } from "../lib/render-path.ts";
import { scatterPointsToSvgDocument } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { canvasEventPoint, toDataX, toDataY } from "../lib/viewport.ts";
import { pinchZoomFactor, viewportFromAnchor, wheelZoomFactor } from "../lib/viewport-gestures.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 300;
const ZOOM_STEP = 1.1;
const ZOOM_COMMIT_DEBOUNCE_MS = 150;
// Only reached if the default state's own series (see DEFAULT_SERIES_STATE)
// somehow produced an empty partial-sum list -- computeSeriesViewport
// returns null in that one case (see its own doc comment). An arbitrary,
// sane placeholder, never actually shown for the real default demo state.
const FALLBACK_VIEWPORT: Viewport = { xMin: 0, xMax: 10, yMin: -1, yMax: 1 };

function seedSeriesState(graph: CellGraph, ids: CellIdsSeries, state: SeriesState): void {
  graph.set(ids.exprText, state.exprText);
  graph.set(ids.variable, state.variable);
  graph.set(ids.fromN, state.fromN);
  graph.set(ids.toN, state.toN);
  graph.set(ids.plotCount, state.plotCount);
}

function getCurrentSeriesState(graph: CellGraph, ids: CellIdsSeries): SeriesState {
  return {
    v: 1,
    exprText: graph.get<string>(ids.exprText),
    variable: graph.get<string>(ids.variable),
    fromN: graph.get<string>(ids.fromN),
    toN: graph.get<string>(ids.toN),
    plotCount: graph.get<string>(ids.plotCount),
  };
}

function useSeriesGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsSeries(cellId);
    const decoded = typeof window !== "undefined" ? decodeSeriesState(window.location.hash.slice(1)) : null;
    seedSeriesState(graph, ids, decoded ?? DEFAULT_SERIES_STATE);

    graph.define(ids.result, (): Result<SeriesResult> => {
      try {
        const variable = graph.get<string>(ids.variable);
        const from = Number(graph.get<string>(ids.fromN));
        const to = Number(graph.get<string>(ids.toN));
        const plotCount = Number(graph.get<string>(ids.plotCount));
        if (Number.isNaN(from) || Number.isNaN(to)) throw new Error('"from"/"to" must be numbers (or "Infinity").');
        if (!Number.isInteger(from)) throw new Error('"from" must be an integer.');
        if (to < from) throw new Error('"to" must be greater than or equal to "from".');
        if (!Number.isInteger(plotCount) || plotCount <= 0) throw new Error("Plot count must be a positive integer.");
        const exprText = graph.get<string>(ids.exprText);
        return { ok: true, value: analyzeSeries(exprText, variable, from, to, plotCount) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    // Pan/zoom (issue #53): seeded once from the initial series' own
    // auto-fit viewport (not a fixed constant, unlike FourierPanel's
    // INITIAL_VIEWPORT) -- sticky afterwards, same as every other pan/zoom
    // panel: it does NOT re-fit on later expr/from/to/plotCount edits,
    // only on an explicit "Reset view" click.
    const initialResult = graph.get<Result<SeriesResult>>(ids.result);
    const initialViewport = (initialResult.ok && computeSeriesViewport(initialResult.value.partialSums, initialResult.value.finalSum)) || FALLBACK_VIEWPORT;
    graph.set(ids.viewport, initialViewport, { auxiliary: true });
    graph.set<Viewport | null>(ids.liveViewport, null, { auxiliary: true });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * Partial sums of a user series (part of #26): a running partial-sum dot
 * plot alongside a convergence/divergence verdict via `Symbolic.sumSeries`
 * (which throws `SeriesDivergesError`, caught and reported rather than
 * crashing). A finite `to` is a plain partial sum; `to = Infinity` tries a
 * closed form (geometric series) or a numeric convergence check.
 */
export function SeriesPanel({ cellId = "series-1" }: { cellId?: string } = {}) {
  const graph = useSeriesGraph(cellId);
  useCellGraphTools(`calculus_series_${cellId}`, graph);
  const ids = cellIdsSeries(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprText = useCell<string>(graph, ids.exprText);
  const variable = useCell<string>(graph, ids.variable);
  const fromN = useCell<string>(graph, ids.fromN);
  const toN = useCell<string>(graph, ids.toN);
  const plotCount = useCell<string>(graph, ids.plotCount);
  const result = useCell<Result<SeriesResult>>(graph, ids.result);
  const committedViewport = useCell<Viewport>(graph, ids.viewport);
  const liveViewport = useCell<Viewport | null>(graph, ids.liveViewport);
  const viewport = liveViewport ?? committedViewport;

  // Pan/pinch gesture state (issue #53), mirroring FourierPanel (#188). No
  // draggable handle on this canvas, so every pointerdown is a pinch (2+
  // pointers) or a pan.
  const gestureRef = useRef<
    | { kind: "pan"; anchorX: number; anchorY: number; spanX: number; spanY: number }
    | { kind: "pinch"; anchorX: number; anchorY: number; spanX: number; spanY: number; startDistancePx: number }
    | null
  >(null);
  const activePointersRef = useRef<Map<number, { sx: number; sy: number }>>(new Map());
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [exprInput, setExprInput] = useState(exprText);
  useEffect(() => {
    setExprInput(exprText);
  }, [exprText]);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeSeriesState(getCurrentSeriesState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!result.ok) return;
    const { partialSums, finalSum } = result.value;
    drawAxes(ctx, viewport, WIDTH, HEIGHT);
    drawScatter(ctx, partialSums.map((p) => ({ x: p.n, y: p.sum })), viewport, WIDTH, HEIGHT, 3, "#2563eb");

    if (finalSum !== null) {
      const sy = HEIGHT - ((finalSum - viewport.yMin) / (viewport.yMax - viewport.yMin)) * HEIGHT;
      ctx.save();
      ctx.strokeStyle = "#9ca3af";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(WIDTH, sy);
      ctx.stroke();
      ctx.restore();
    }
  }, [result, viewport]);

  function updateExpr(value: string) {
    setExprInput(value);
    graph.set(ids.exprText, value);
  }

  /** Copies a pending live-viewport override into the committed viewport -- shared by pan/pinch release and the wheel-zoom debounce below. */
  function commitLiveViewport() {
    const live = graph.get<Viewport | null>(ids.liveViewport);
    if (!live) return;
    graph.set(ids.viewport, live);
    graph.set<Viewport | null>(ids.liveViewport, null);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    commitLiveViewport();

    const downPoint = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    activePointersRef.current.set(e.pointerId, downPoint);

    if (activePointersRef.current.size >= 2) {
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
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

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

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT));
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      const points = [...activePointersRef.current.values()].slice(-2);
      if (points.length < 2) return;
      const [p1, p2] = points as [{ sx: number; sy: number }, { sx: number; sy: number }];
      const currentDistancePx = Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy);
      if (currentDistancePx < 1) return;
      const factor = pinchZoomFactor(gesture.startDistancePx, currentDistancePx);
      const spanX = gesture.spanX * factor;
      const spanY = gesture.spanY * factor;
      const midSx = (p1.sx + p2.sx) / 2;
      const midSy = (p1.sy + p2.sy) / 2;
      graph.set(ids.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, midSx, midSy, spanX, spanY, WIDTH, HEIGHT));
      return;
    }
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    graph.set(ids.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, sx, sy, gesture.spanX, gesture.spanY, WIDTH, HEIGHT));
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (gestureRef.current?.kind === "pan" || gestureRef.current?.kind === "pinch") commitLiveViewport();
    gestureRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  /** Wheel-to-zoom, anchored on the cursor's data point; the real commit is debounced (no pointerup to trigger it). */
  function handleWheel(e: ReactWheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const vp = graph.get<Viewport | null>(ids.liveViewport) ?? graph.get<Viewport>(ids.viewport);
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
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

  /** Re-fits the viewport to the CURRENT series data (not a fixed constant -- this panel's viewport is inherently a fit, unlike FourierPanel's fixed domain). */
  function resetView() {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    graph.set<Viewport | null>(ids.liveViewport, null);
    const current = graph.get<Result<SeriesResult>>(ids.result);
    const refit = (current.ok && computeSeriesViewport(current.value.partialSums, current.value.finalSum)) || FALLBACK_VIEWPORT;
    graph.set(ids.viewport, refit);
  }

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Sum of a series, term by term -- try "Infinity" as the upper bound for an infinite series.
      </p>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Σ <input value={exprInput} onChange={(e) => updateExpr(e.target.value)} style={{ font: "inherit", width: "12ch" }} />
        </label>
        <label>
          var:{" "}
          <input value={variable} onChange={(e) => graph.set(ids.variable, e.target.value)} style={{ font: "inherit", width: "3ch" }} />
        </label>
        <label>
          from: <input value={fromN} onChange={(e) => graph.set(ids.fromN, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
        <label>
          to: <input value={toN} onChange={(e) => graph.set(ids.toN, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
        </label>
        <label>
          plot:{" "}
          <input
            type="number"
            min={1}
            value={plotCount}
            onChange={(e) => graph.set(ids.plotCount, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: "1px solid var(--border)", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="series" />
        <SvgExportButton
          getSvg={() => {
            if (!result.ok) return null;
            return scatterPointsToSvgDocument(
              result.value.partialSums.map((p) => ({ x: p.n, y: p.sum })),
              viewport,
              WIDTH,
              HEIGHT,
              "#2563eb",
              3,
            );
          }}
          label="series"
        />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
      {result.ok ? (
        result.value.diverges ? (
          <p style={{ color: "var(--danger)" }}>Diverges -- {result.value.divergeMessage}</p>
        ) : (
          <p>Sum = {result.value.finalSum?.toFixed(6)}</p>
        )
      ) : (
        <p style={{ color: "var(--danger)" }}>{result.message}</p>
      )}
    </div>
  );
}
