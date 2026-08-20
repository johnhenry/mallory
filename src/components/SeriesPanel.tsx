import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSeries } from "../lib/cell-ids.ts";
import { analyzeSeries, computeSeriesViewport, type SeriesResult } from "../lib/series-analysis.ts";
import { DEFAULT_SERIES_STATE, decodeSeriesState, encodeSeriesState, type SeriesRowState } from "../lib/series-state.ts";
import { drawAxes, drawScatter, hexToRgba, type Viewport } from "../lib/render-path.ts";
import { scatterPointsToSvgDocument } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useNonPassiveWheel } from "../hooks/use-non-passive-wheel.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
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

/** Seeds one series row's own cells (issue #251, unlimited expressions): its own Σ expression/variable/from/to/plot-count, color and visibility, and its own derived analysis. */
export function seedSeriesRow(graph: CellGraph, rowId: string, row: SeriesRowState): void {
  const ids = cellIdsSeries(rowId);
  graph.set(ids.exprText, row.exprText);
  graph.set(ids.variable, row.variable);
  graph.set(ids.fromN, row.fromN);
  graph.set(ids.toN, row.toN);
  graph.set(ids.plotCount, row.plotCount);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

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
}

function seedSeriesRowDefault(graph: CellGraph, rowId: string, index: number): void {
  seedSeriesRow(graph, rowId, { ...(DEFAULT_SERIES_STATE.rows[0] as SeriesRowState), color: paletteColor(index) });
}

/**
 * Pure re-render of the shared partial-sums/final-sum canvas, extracted
 * from the redraw effect below so `PngExportButton`'s `renderAtScale`
 * (issue #278) can call it against a fresh offscreen canvas at any size.
 */
export function drawSeriesPanel(ctx: CanvasRenderingContext2D, width: number, height: number, graph: CellGraph, containerIds: ReturnType<typeof cellIdsSeries>): void {
  ctx.clearRect(0, 0, width, height);
  const vp = graph.get<Viewport | null>(containerIds.liveViewport) ?? graph.get<Viewport>(containerIds.viewport);
  drawAxes(ctx, vp, width, height);
  for (const rowId of graph.get<string[]>(containerIds.list)) {
    const ids = cellIdsSeries(rowId);
    try {
      if (!graph.get<boolean>(ids.visible)) continue;
      const result = graph.get<Result<SeriesResult>>(ids.result);
      if (!result.ok) continue;
      const color = graph.get<number>(ids.color);
      const { partialSums, finalSum } = result.value;
      drawScatter(ctx, partialSums.map((p) => ({ x: p.n, y: p.sum })), vp, width, height, 3, hexToRgba(color, 1));

      if (finalSum !== null) {
        const sy = height - ((finalSum - vp.yMin) / (vp.yMax - vp.yMin)) * height;
        ctx.save();
        ctx.strokeStyle = hexToRgba(color, 0.6);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
        ctx.stroke();
        ctx.restore();
      }
    } catch {
      // A row whose cells haven't registered yet -- skip it this frame.
    }
  }
}

function useSeriesGraph(containerId: string): { graph: CellGraph; containerIds: ReturnType<typeof cellIdsSeries> } {
  // `containerIds` is memoized on the ref itself, not recomputed every
  // render -- see ImplicitPanel's identical `useImplicitGraph` doc comment
  // for why (issue #236's stale-reference bug class, reintroduced by this
  // hook's own container-id object).
  const ref = useRef<{ graph: CellGraph; containerIds: ReturnType<typeof cellIdsSeries> } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsSeries(containerId);
    const graph = new CellGraph();
    const decoded = typeof window !== "undefined" ? decodeSeriesState(window.location.hash.slice(1)) : null;
    const state = decoded ?? DEFAULT_SERIES_STATE;
    const rowIds = state.rows.map(() => crypto.randomUUID());
    rowIds.forEach((id, i) => seedSeriesRow(graph, id, state.rows[i] as SeriesRowState));
    graph.set(containerIds.list, rowIds, { auxiliary: true });

    // Pan/zoom (issue #53): seeded once from the initial FIRST row's own
    // auto-fit viewport (not a fixed constant, unlike FourierPanel's
    // INITIAL_VIEWPORT) -- sticky afterwards, same as every other pan/zoom
    // panel: it does NOT re-fit on later edits, only on an explicit "Reset
    // view" click. Scoped to the first row only, the same v1 "primary row"
    // scoping GraphCanvasMulti's own sonification/description use (see its
    // `getPrimaryRow` doc comment) -- auto-fitting to the union of every
    // visible row's data is a natural follow-up, not attempted here.
    const firstRowIds = cellIdsSeries(rowIds[0] as string);
    const initialResult = graph.get<Result<SeriesResult>>(firstRowIds.result);
    const initialViewport = (initialResult.ok && computeSeriesViewport(initialResult.value.partialSums, initialResult.value.finalSum)) || FALLBACK_VIEWPORT;
    graph.set(containerIds.viewport, initialViewport, { auxiliary: true });
    graph.set<Viewport | null>(containerIds.liveViewport, null, { auxiliary: true });

    ref.current = { graph, containerIds };
  }
  return ref.current;
}

/** One series row's controls (issue #251): Σ expression, variable, from/to bounds, plot count, color/visibility, and its own convergence verdict. */
function SeriesRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsSeries(rowId);
  const exprText = useCell<string>(graph, ids.exprText);
  const variable = useCell<string>(graph, ids.variable);
  const fromN = useCell<string>(graph, ids.fromN);
  const toN = useCell<string>(graph, ids.toN);
  const plotCount = useCell<string>(graph, ids.plotCount);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const result = useCell<Result<SeriesResult>>(graph, ids.result);

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this series" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          Σ <input value={exprText} onChange={(e) => graph.set(ids.exprText, e.target.value)} style={{ font: "inherit", width: "12ch" }} />
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
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this series">
            ✕
          </button>
        )}
      </div>
      {result.ok ? (
        result.value.diverges ? (
          <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>Diverges -- {result.value.divergeMessage}</p>
        ) : (
          <p style={{ fontSize: "0.85rem" }}>Sum = {result.value.finalSum?.toFixed(6)}</p>
        )
      ) : (
        <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{result.message}</p>
      )}
    </div>
  );
}

/**
 * Unlimited series, partial sums plotted term by term (issue #251, part of
 * #26) -- each row its own running partial-sum dot plot alongside its own
 * convergence/divergence verdict via `Symbolic.sumSeries` (which throws
 * `SeriesDivergesError`, caught and reported rather than crashing), overlaid
 * on one shared, pannable/zoomable viewport. v1 was a single series only;
 * every series now gets its own color/visibility, the same "shared
 * viewport, unlimited rows" shape GraphCanvasMulti established. A finite
 * `to` is a plain partial sum; `to = Infinity` tries a closed form
 * (geometric series) or a numeric convergence check.
 */
export function SeriesPanel({ cellId = "series-1" }: { cellId?: string } = {}) {
  const { graph, containerIds } = useSeriesGraph(cellId);
  useCellGraphTools(`calculus_series_${cellId}`, graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const committedViewport = useCell<Viewport>(graph, containerIds.viewport);
  const liveViewport = useCell<Viewport | null>(graph, containerIds.liveViewport);
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

  function addSeries() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedSeriesRowDefault(graph, id, index);
  }

  function removeSeries(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsSeries(rowId));
  }

  // subscribeMany (not subscribeAll, issue #242 -- follow-up to #235,
  // extended to the dynamic row list): getCurrentSeriesState never reads
  // containerIds.viewport/liveViewport, so watching every graph cell here
  // would re-run writeUrl on every pan/pinch/wheel-zoom gesture tick even
  // though the URL never encodes viewport state at all.
  useEffect(() => {
    function writeUrl() {
      const rows = graph.get<string[]>(containerIds.list).map((rowId) => {
        const ids = cellIdsSeries(rowId);
        return {
          exprText: graph.get<string>(ids.exprText),
          variable: graph.get<string>(ids.variable),
          fromN: graph.get<string>(ids.fromN),
          toN: graph.get<string>(ids.toN),
          plotCount: graph.get<string>(ids.plotCount),
          color: graph.get<number>(ids.color),
          visible: graph.get<boolean>(ids.visible),
        };
      });
      window.history.replaceState(null, "", `#${encodeSeriesState({ v: 2, rows })}`);
    }
    writeUrl();
    const watchedIds = [
      containerIds.list,
      ...rowIds.flatMap((id) => {
        const ids = cellIdsSeries(id);
        return [ids.exprText, ids.variable, ids.fromN, ids.toN, ids.plotCount, ids.color, ids.visible];
      }),
    ];
    return graph.subscribeMany(watchedIds, writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, containerIds, rowIds]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  // Redraws whenever the row list changes, the shared viewport pans/zooms,
  // or any individual row's own cells do -- graph.subscribeAll rather than
  // per-row useCell hooks, same reasoning as every other multi-row panel.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const redraw = () => drawSeriesPanel(ctx, WIDTH, HEIGHT, graph, containerIds);
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds]);

  /** Copies a pending live-viewport override into the committed viewport -- shared by pan/pinch release and the wheel-zoom debounce below. */
  function commitLiveViewport() {
    const live = graph.get<Viewport | null>(containerIds.liveViewport);
    if (!live) return;
    graph.set(containerIds.viewport, live);
    graph.set<Viewport | null>(containerIds.liveViewport, null);
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
      const vp = graph.get<Viewport | null>(containerIds.liveViewport) ?? graph.get<Viewport>(containerIds.viewport);
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

    const vp = graph.get<Viewport>(containerIds.viewport);
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
      graph.set(containerIds.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, midSx, midSy, spanX, spanY, WIDTH, HEIGHT));
      return;
    }
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    graph.set(containerIds.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, sx, sy, gesture.spanX, gesture.spanY, WIDTH, HEIGHT));
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (gestureRef.current?.kind === "pan" || gestureRef.current?.kind === "pinch") commitLiveViewport();
    gestureRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  /**
   * Wheel-to-zoom, anchored on the cursor's data point; the real commit is
   * debounced (no pointerup to trigger it). Attached via `useNonPassiveWheel`
   * below, NOT the React `onWheel` prop -- see that hook's own doc comment
   * for why `preventDefault()` here only actually stops the page from also
   * scrolling when the listener itself is non-passive.
   */
  function handleWheel(e: WheelEvent) {
    if (!canvasRef.current) return;
    e.preventDefault();
    const vp = graph.get<Viewport | null>(containerIds.liveViewport) ?? graph.get<Viewport>(containerIds.viewport);
    const { sx, sy } = canvasEventPoint(e, canvasRef.current, WIDTH, HEIGHT);
    const anchorX = toDataX(sx, vp, WIDTH);
    const anchorY = toDataY(sy, vp, HEIGHT);
    const factor = wheelZoomFactor(e.deltaY, ZOOM_STEP);
    const spanX = (vp.xMax - vp.xMin) * factor;
    const spanY = (vp.yMax - vp.yMin) * factor;
    graph.set(containerIds.liveViewport, viewportFromAnchor(anchorX, anchorY, sx, sy, spanX, spanY, WIDTH, HEIGHT));
    if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    zoomCommitTimerRef.current = setTimeout(() => {
      zoomCommitTimerRef.current = null;
      commitLiveViewport();
    }, ZOOM_COMMIT_DEBOUNCE_MS);
  }
  useNonPassiveWheel(canvasRef, handleWheel);

  /** Re-fits the viewport to the FIRST row's CURRENT series data (not a fixed constant -- this panel's viewport is inherently a fit, unlike FourierPanel's fixed domain; scoped to the first row, same v1 primary-row convention `useSeriesGraph`'s own initial fit uses). */
  function resetView() {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    graph.set<Viewport | null>(containerIds.liveViewport, null);
    const firstRowId = graph.get<string[]>(containerIds.list)[0];
    const current = firstRowId ? graph.get<Result<SeriesResult>>(cellIdsSeries(firstRowId).result) : null;
    const refit = (current?.ok && computeSeriesViewport(current.value.partialSums, current.value.finalSum)) || FALLBACK_VIEWPORT;
    graph.set(containerIds.viewport, refit);
  }

  function getExportSvg(): string | null {
    for (const rowId of rowIds) {
      const ids = cellIdsSeries(rowId);
      if (!graph.hasValue(ids.result) || !graph.get<boolean>(ids.visible)) continue;
      const result = graph.get<Result<SeriesResult>>(ids.result);
      if (!result.ok) continue;
      // v1 scope: exports the first visible row only -- a genuine multi-
      // series SVG (several scatter layers, one per row) is a natural
      // follow-up, not attempted here.
      return scatterPointsToSvgDocument(
        result.value.partialSums.map((p) => ({ x: p.n, y: p.sum })),
        viewport,
        WIDTH,
        HEIGHT,
        `#${graph.get<number>(ids.color).toString(16).padStart(6, "0")}`,
        3,
      );
    }
    return null;
  }

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Sum of a series, term by term -- try "Infinity" as the upper bound for an infinite series.
      </p>
      {rowIds.map((rowId) => (
        <SeriesRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeSeries(rowId) : undefined} />
      ))}
      <button type="button" onClick={addSeries} style={{ margin: "0.35rem 0" }}>
        + Add series
      </button>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: "1px solid var(--border)", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="series"
          renderAtScale={(ctx, width, height) => drawSeriesPanel(ctx, width, height, graph, containerIds)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <SvgExportButton getSvg={getExportSvg} label="series" />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
    </div>
  );
}
