import type { Path2D } from "@johnhenry/math";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react";
import { CellGraph } from "@johnhenry/math";
import { cellIdsParametric } from "../lib/cell-ids.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useNonPassiveWheel } from "../hooks/use-non-passive-wheel.ts";
import { drawAxes, drawPath, type Viewport } from "../lib/render-path.ts";
import { sampleParametricCurve, samplePolarCurve } from "../lib/sample-parametric.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import { pathsToSvgDocument } from "../lib/svg-export.ts";
import { useCell } from "../lib/use-cell.ts";
import { canvasEventPoint, toDataX, toDataY } from "../lib/viewport.ts";
import { pinchZoomFactor, viewportFromAnchor, wheelZoomFactor } from "../lib/viewport-gestures.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

const WIDTH = 500;
const HEIGHT = 500;
const RESOLUTION = 400;
const INITIAL_VIEWPORT: Viewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
const ZOOM_STEP = 1.1;
const ZOOM_COMMIT_DEBOUNCE_MS = 150;

type PathResult = { ok: true; path: Path2D } | { ok: false; message: string };
type Mode = "parametric" | "polar";

const DEFAULTS = { mode: "parametric" as Mode, exprX: "cos(t)", exprY: "sin(t)", exprR: "1+cos(t)", tMin: "0", tMax: "6.2832" };

/**
 * Seeds one curve row's own cells (issue #251, unlimited expressions): mode
 * plus either x(t)/y(t) or r(θ) (a polar curve is sampled internally as
 * x=r·cosθ, y=r·sinθ, see `samplePolarCurve`) and its own t/θ domain, color
 * and visibility -- everything each row needs to plot independently of any
 * other row on the shared viewport.
 */
export function seedParametricRow(graph: CellGraph, rowId: string, index: number): void {
  const ids = cellIdsParametric(rowId);
  graph.set(ids.mode, DEFAULTS.mode);
  graph.set(ids.exprX, DEFAULTS.exprX);
  graph.set(ids.exprY, DEFAULTS.exprY);
  graph.set(ids.exprR, DEFAULTS.exprR);
  graph.set(ids.tMin, DEFAULTS.tMin);
  graph.set(ids.tMax, DEFAULTS.tMax);
  graph.set(ids.color, paletteColor(index));
  graph.set(ids.visible, true);

  graph.define(ids.path, (): PathResult => {
    try {
      const mode = graph.get<Mode>(ids.mode);
      const tMin = Number(graph.get<string>(ids.tMin));
      const tMax = Number(graph.get<string>(ids.tMax));
      if ([tMin, tMax].some(Number.isNaN)) throw new Error("t-min/t-max must be numbers.");
      if (tMin >= tMax) throw new Error("t-min must be less than t-max.");
      const domain = { min: tMin, max: tMax };
      const path =
        mode === "polar"
          ? samplePolarCurve(graph.get<string>(ids.exprR), domain, RESOLUTION)
          : sampleParametricCurve(graph.get<string>(ids.exprX), graph.get<string>(ids.exprY), domain, RESOLUTION);
      return { ok: true, path };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * Sets up the parametric/polar panel's reactive cells on its own private
 * CellGraph -- one shared pannable/zoomable viewport (the container id's
 * own `viewport`/`liveViewport` cells) plus an ordered list of curve rows
 * (issue #251), each its own independent x(t)/y(t)-or-r(θ) curve (see
 * `seedParametricRow`).
 */
/**
 * Pure re-render of the shared parametric/polar curves canvas, extracted
 * from the redraw effect below so `PngExportButton`'s `renderAtScale`
 * (issue #278) can call it against a fresh offscreen canvas at any size.
 */
export function drawParametricPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  graph: CellGraph,
  containerIds: ReturnType<typeof cellIdsParametric>,
): void {
  ctx.clearRect(0, 0, width, height);
  const vp = graph.get<Viewport | null>(containerIds.liveViewport) ?? graph.get<Viewport>(containerIds.viewport);
  drawAxes(ctx, vp, width, height);
  for (const rowId of graph.get<string[]>(containerIds.list)) {
    const ids = cellIdsParametric(rowId);
    try {
      if (!graph.get<boolean>(ids.visible)) continue;
      const path = graph.get<PathResult>(ids.path);
      if (!path.ok) continue;
      const color = graph.get<number>(ids.color);
      drawPath(ctx, { ...path.path, stroke: { ...path.path.stroke, color } }, vp, width, height);
    } catch {
      // A row whose cells haven't registered yet -- skip it this frame.
    }
  }
}

function useParametricGraph(containerId: string): { graph: CellGraph; containerIds: ReturnType<typeof cellIdsParametric> } {
  // `containerIds` is memoized on the ref itself, not recomputed every
  // render -- see ImplicitPanel's identical `useImplicitGraph` doc comment
  // for why (issue #236's stale-reference bug class, reintroduced by this
  // hook's own container-id object).
  const ref = useRef<{ graph: CellGraph; containerIds: ReturnType<typeof cellIdsParametric> } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsParametric(containerId);
    const graph = new CellGraph();
    if (!graph.hasValue(containerIds.list)) {
      graph.set(containerIds.viewport, INITIAL_VIEWPORT, { auxiliary: true });
      graph.set<Viewport | null>(containerIds.liveViewport, null, { auxiliary: true });
      const rowId = crypto.randomUUID();
      seedParametricRow(graph, rowId, 0);
      graph.set(containerIds.list, [rowId], { auxiliary: true });
    }
    ref.current = { graph, containerIds };
  }
  return ref.current;
}

/** One curve row's controls (issue #251): mode toggle, x(t)/y(t) or r(θ) inputs, t/θ domain, color/visibility -- the canvas draw itself lives in `ParametricPanel`, which loops over every row. */
function ParametricRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsParametric(rowId);
  const mode = useCell<Mode>(graph, ids.mode);
  const exprX = useCell<string>(graph, ids.exprX);
  const exprY = useCell<string>(graph, ids.exprY);
  const exprR = useCell<string>(graph, ids.exprR);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const path = useCell<PathResult>(graph, ids.path);

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this curve" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          <input type="radio" checked={mode === "parametric"} onChange={() => graph.set(ids.mode, "parametric")} /> parametric
        </label>
        <label>
          <input type="radio" checked={mode === "polar"} onChange={() => graph.set(ids.mode, "polar")} /> polar
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this curve">
            ✕
          </button>
        )}
      </div>
      {mode === "polar" ? (
        <div style={{ margin: "0.25rem 0" }}>
          <label>
            r(θ) ={" "}
            <input value={exprR} onChange={(e) => graph.set(ids.exprR, e.target.value)} style={{ font: "inherit", width: "16ch" }} />
          </label>
        </div>
      ) : (
        <div style={{ margin: "0.25rem 0" }}>
          <label>
            x(t) ={" "}
            <input value={exprX} onChange={(e) => graph.set(ids.exprX, e.target.value)} style={{ font: "inherit", width: "12ch" }} />
          </label>{" "}
          <label>
            y(t) ={" "}
            <input value={exprY} onChange={(e) => graph.set(ids.exprY, e.target.value)} style={{ font: "inherit", width: "12ch" }} />
          </label>
        </div>
      )}
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          {mode === "polar" ? "θ" : "t"}: [
          <input value={tMin} onChange={(e) => graph.set(ids.tMin, e.target.value)} style={{ font: "inherit", width: "8ch" }} />,{" "}
          <input value={tMax} onChange={(e) => graph.set(ids.tMax, e.target.value)} style={{ font: "inherit", width: "8ch" }} />]
        </label>
      </div>
      {!path.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{path.message}</p>}
    </div>
  );
}

export interface ParametricPanelProps {
  cellId?: string;
}

/**
 * Unlimited parametric (x(t),y(t)) or polar (r(θ)) curves (issue #251),
 * overlaid on one shared pannable/zoomable viewport -- v1 was a single
 * curve only; every curve now gets its own mode/color/visibility, the same
 * "shared viewport, unlimited rows" shape GraphCanvasMulti established for
 * y=f(x) curves.
 */
export function ParametricPanel({ cellId = "parametric-1" }: ParametricPanelProps = {}) {
  const { graph, containerIds } = useParametricGraph(cellId);
  useCellGraphTools("graphing_parametric", graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const committedViewport = useCell<Viewport>(graph, containerIds.viewport);
  const liveViewport = useCell<Viewport | null>(graph, containerIds.liveViewport);
  const viewport = liveViewport ?? committedViewport;

  // Pan/pinch gesture state (issue #53), mirroring GraphCanvas's own
  // gestureRef/activePointersRef/zoomCommitTimerRef exactly -- there's no
  // draggable handle on this canvas, so unlike GraphCanvas every
  // pointerdown is either a pinch (2+ pointers) or a pan, never a
  // point-drag.
  const gestureRef = useRef<
    | { kind: "pan"; anchorX: number; anchorY: number; spanX: number; spanY: number }
    | { kind: "pinch"; anchorX: number; anchorY: number; spanX: number; spanY: number; startDistancePx: number }
    | null
  >(null);
  const activePointersRef = useRef<Map<number, { sx: number; sy: number }>>(new Map());
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function addCurve() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedParametricRow(graph, id, index);
  }

  function removeCurve(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsParametric(rowId));
  }

  // Redraws whenever the row list changes, the shared viewport pans/zooms,
  // or any individual row's own cells do -- graph.subscribeAll rather than
  // per-row useCell hooks, same reasoning as GraphCanvasMulti/ImplicitPanel:
  // the row *set* changes as much as any one row's path/color/visibility
  // does, and a fixed hook-per-row list can't track a dynamic row count.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const redraw = () => drawParametricPanel(ctx, WIDTH, HEIGHT, graph, containerIds);
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

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
      graph.set(
        containerIds.liveViewport,
        viewportFromAnchor(gesture.anchorX, gesture.anchorY, midSx, midSy, spanX, spanY, WIDTH, HEIGHT),
      );
      return;
    }
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    graph.set(
      containerIds.liveViewport,
      viewportFromAnchor(gesture.anchorX, gesture.anchorY, sx, sy, gesture.spanX, gesture.spanY, WIDTH, HEIGHT),
    );
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (gestureRef.current?.kind === "pan" || gestureRef.current?.kind === "pinch") commitLiveViewport();
    gestureRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  /**
   * Wheel-to-zoom, anchored on the cursor's data point; the real commit is
   * debounced (no pointerup to trigger it), same as GraphCanvas's
   * handleWheel. Attached via `useNonPassiveWheel` below, NOT the React
   * `onWheel` prop -- see that hook's own doc comment for why
   * `preventDefault()` here only actually stops the page from also
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

  function resetView() {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    graph.set<Viewport | null>(containerIds.liveViewport, null);
    graph.set(containerIds.viewport, INITIAL_VIEWPORT);
  }

  function getExportSvg(): string | null {
    const paths: Path2D[] = [];
    for (const rowId of rowIds) {
      const ids = cellIdsParametric(rowId);
      if (!graph.hasValue(ids.path) || !graph.get<boolean>(ids.visible)) continue;
      const path = graph.get<PathResult>(ids.path);
      if (path.ok) paths.push(path.path);
    }
    if (paths.length === 0) return null;
    return pathsToSvgDocument(paths, viewport, WIDTH, HEIGHT);
  }

  return (
    <div>
      {rowIds.map((rowId) => (
        <ParametricRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeCurve(rowId) : undefined} />
      ))}
      <button type="button" onClick={addCurve} style={{ margin: "0.35rem 0" }}>
        + Add curve
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
          label="parametric"
          renderAtScale={(ctx, width, height) => drawParametricPanel(ctx, width, height, graph, containerIds)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <SvgExportButton getSvg={getExportSvg} label="parametric" />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
    </div>
  );
}
