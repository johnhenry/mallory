import type { Path2D } from "mallory-math";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, type WheelEvent as ReactWheelEvent } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsParametric } from "../lib/cell-ids.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { drawAxes, drawPath, type Viewport } from "../lib/render-path.ts";
import { sampleParametricCurve, samplePolarCurve } from "../lib/sample-parametric.ts";
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
 * Sets up the parametric/polar panel's reactive cells on its own private
 * CellGraph. A polar curve r(θ) is sampled as the parametric curve
 * x=r·cosθ, y=r·sinθ (see `samplePolarCurve`) -- one `mode` cell picks which
 * of `exprX`/`exprY` vs. `exprR` the derived `path` cell reads.
 */
function useParametricGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsParametric(cellId);
    if (!graph.has(ids.mode)) {
      graph.set(ids.mode, DEFAULTS.mode);
      graph.set(ids.exprX, DEFAULTS.exprX);
      graph.set(ids.exprY, DEFAULTS.exprY);
      graph.set(ids.exprR, DEFAULTS.exprR);
      graph.set(ids.tMin, DEFAULTS.tMin);
      graph.set(ids.tMax, DEFAULTS.tMax);
      graph.set(ids.viewport, INITIAL_VIEWPORT, { auxiliary: true });
      graph.set<Viewport | null>(ids.liveViewport, null, { auxiliary: true });

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
    ref.current = graph;
  }
  return ref.current;
}

export interface ParametricPanelProps {
  cellId?: string;
}

/** v1: a single parametric curve (x(t),y(t)) or polar curve r(θ), over a fixed domain and viewport. */
export function ParametricPanel({ cellId = "parametric-1" }: ParametricPanelProps = {}) {
  const graph = useParametricGraph(cellId);
  useCellGraphTools("graphing_parametric", graph);
  const ids = cellIdsParametric(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const mode = useCell<Mode>(graph, ids.mode);
  const exprX = useCell<string>(graph, ids.exprX);
  const exprY = useCell<string>(graph, ids.exprY);
  const exprR = useCell<string>(graph, ids.exprR);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
  const path = useCell<PathResult>(graph, ids.path);
  const committedViewport = useCell<Viewport>(graph, ids.viewport);
  const liveViewport = useCell<Viewport | null>(graph, ids.liveViewport);
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

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawAxes(ctx, viewport, WIDTH, HEIGHT);
    if (path.ok) drawPath(ctx, path.path, viewport, WIDTH, HEIGHT);
  }, [path, viewport]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

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

  /** Wheel-to-zoom, anchored on the cursor's data point; the real commit is debounced (no pointerup to trigger it), same as GraphCanvas's handleWheel. */
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

  function resetView() {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    graph.set<Viewport | null>(ids.liveViewport, null);
    graph.set(ids.viewport, INITIAL_VIEWPORT);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          <input type="radio" checked={mode === "parametric"} onChange={() => graph.set(ids.mode, "parametric")} /> parametric
          (x(t), y(t))
        </label>{" "}
        <label>
          <input type="radio" checked={mode === "polar"} onChange={() => graph.set(ids.mode, "polar")} /> polar (r(θ))
        </label>
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
        <PngExportButton getCanvas={() => canvasRef.current} label="parametric" />
        <SvgExportButton getSvg={() => (path.ok ? pathsToSvgDocument([path.path], viewport, WIDTH, HEIGHT) : null)} label="parametric" />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
      {!path.ok && <p style={{ color: "var(--danger)" }}>{path.message}</p>}
    </div>
  );
}
