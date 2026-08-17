import type { Path2D } from "mallory-math";
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsTaylor, type CellIdsTaylor } from "../lib/cell-ids.ts";
import { drawAxes, drawPath, type Viewport } from "../lib/render-path.ts";
import { resolveNaturalLanguageQuery } from "../lib/nl-query.ts";
import { computeLimit, computeTaylorApproximation, type LimitDirection } from "../lib/taylor-approx.ts";
import { DEFAULT_TAYLOR_STATE, decodeTaylorState, encodeTaylorState, type TaylorState } from "../lib/taylor-state.ts";
import { pathsToSvgDocument } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { canvasEventPoint, toDataX, toDataY } from "../lib/viewport.ts";
import { pinchZoomFactor, viewportFromAnchor, wheelZoomFactor } from "../lib/viewport-gestures.ts";
import { CopyableTex } from "./CopyableTex.tsx";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

type ApproxResult = { ok: true; fPath: Path2D; taylorPath: Path2D; latex: string } | { ok: false; message: string };
type LimitResult = { ok: true; value: number } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;
const ZOOM_STEP = 1.1;
const ZOOM_COMMIT_DEBOUNCE_MS = 150;

function seedTaylorState(graph: CellGraph, ids: CellIdsTaylor, state: TaylorState): void {
  graph.set(ids.expr, state.expr);
  graph.set(ids.center, state.center);
  graph.set(ids.order, state.order);
  graph.set(ids.xMin, state.xMin);
  graph.set(ids.xMax, state.xMax);
  graph.set(ids.yMin, state.yMin);
  graph.set(ids.yMax, state.yMax);
  graph.set(ids.limitPoint, state.limitPoint);
  graph.set(ids.limitDirection, state.limitDirection);
}

function getCurrentTaylorState(graph: CellGraph, ids: CellIdsTaylor): TaylorState {
  return {
    v: 1,
    expr: graph.get<string>(ids.expr),
    center: graph.get<string>(ids.center),
    order: graph.get<string>(ids.order),
    xMin: graph.get<string>(ids.xMin),
    xMax: graph.get<string>(ids.xMax),
    yMin: graph.get<string>(ids.yMin),
    yMax: graph.get<string>(ids.yMax),
    limitPoint: graph.get<string>(ids.limitPoint),
    limitDirection: graph.get<LimitDirection>(ids.limitDirection),
  };
}

function useTaylorGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsTaylor(cellId);
    const decoded = typeof window !== "undefined" ? decodeTaylorState(window.location.hash.slice(1)) : null;
    seedTaylorState(graph, ids, decoded ?? DEFAULT_TAYLOR_STATE);
    graph.set<Viewport | null>(ids.liveViewport, null, { auxiliary: true });

    graph.define(ids.taylorPath, (): ApproxResult => {
      try {
        const expr = graph.get<string>(ids.expr);
        const center = Number(graph.get<string>(ids.center));
        const order = Number(graph.get<string>(ids.order));
        const xMin = Number(graph.get<string>(ids.xMin));
        const xMax = Number(graph.get<string>(ids.xMax));
        const yMin = Number(graph.get<string>(ids.yMin));
        const yMax = Number(graph.get<string>(ids.yMax));
        if ([center, order, xMin, xMax, yMin, yMax].some(Number.isNaN)) throw new Error("Every field must be a number.");
        if (xMin >= xMax) throw new Error("x-min must be less than x-max.");
        if (!Number.isInteger(order) || order < 0) throw new Error("Order must be a non-negative integer.");
        const { fPath, taylorPath, latex } = computeTaylorApproximation(expr, center, order, { min: xMin, max: xMax }, { min: yMin, max: yMax });
        return { ok: true, fPath, taylorPath, latex };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.limitResult, (): LimitResult => {
      const expr = graph.get<string>(ids.expr);
      const point = Number(graph.get<string>(ids.limitPoint));
      const direction = graph.get<LimitDirection>(ids.limitDirection);
      if (Number.isNaN(point)) return { ok: false, message: "The limit point must be a number." };
      return computeLimit(expr, point, direction);
    });

    ref.current = graph;
  }
  return ref.current;
}

/** f(x) plus its degree-n Taylor polynomial about a center point (Symbolic.taylor), and a numeric limit readout (Symbolic.limit) at a chosen point/direction. */
export function TaylorPanel({ cellId = "taylor-1" }: { cellId?: string } = {}) {
  const graph = useTaylorGraph(cellId);
  useCellGraphTools(`calculus_taylor_${cellId}`, graph);
  const ids = cellIdsTaylor(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const expr = useCell<string>(graph, ids.expr);
  const center = useCell<string>(graph, ids.center);
  const order = useCell<string>(graph, ids.order);
  const xMin = useCell<string>(graph, ids.xMin);
  const xMax = useCell<string>(graph, ids.xMax);
  const yMin = useCell<string>(graph, ids.yMin);
  const yMax = useCell<string>(graph, ids.yMax);
  const limitPoint = useCell<string>(graph, ids.limitPoint);
  const limitDirection = useCell<LimitDirection>(graph, ids.limitDirection);
  const approx = useCell<ApproxResult>(graph, ids.taylorPath);
  const limitResult = useCell<LimitResult>(graph, ids.limitResult);
  const liveViewport = useCell<Viewport | null>(graph, ids.liveViewport);

  const [exprInput, setExprInput] = useState(expr);
  useEffect(() => {
    setExprInput(expr);
  }, [expr]);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeTaylorState(getCurrentTaylorState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Unlike GraphCanvas/FourierPanel/ParametricPanel, there's no single
  // cached `viewport` cell here -- x/y-min/max are four separate free cells
  // (so they can be four separate text inputs), so a fresh object built
  // from them inline was a NEW reference on every render even when none of
  // the four actually changed. That defeated the draw effect's own
  // `[approx, viewport]` dependency check below (issue #236): it saw
  // "viewport changed" and redrew both curves on every unrelated re-render
  // (e.g. typing into the limit-point field). Memoized on the four
  // underlying values so the reference is stable when they aren't.
  const committedViewport: Viewport = useMemo(
    () => ({
      xMin: Number(xMin) || -5,
      xMax: Number(xMax) || 5,
      yMin: Number(yMin) || -5,
      yMax: Number(yMax) || 5,
    }),
    [xMin, xMax, yMin, yMax],
  );
  const viewport = liveViewport ?? committedViewport;

  // Pan/pinch gesture state (issue #53), mirroring GraphCanvas/ParametricPanel/
  // FourierPanel. No draggable handle, so every pointerdown is a pinch (2+
  // pointers) or a pan.
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
    if (approx.ok) {
      drawPath(ctx, approx.fPath, viewport, WIDTH, HEIGHT);
      drawPath(ctx, approx.taylorPath, viewport, WIDTH, HEIGHT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approx, viewport]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  function updateExpr(value: string) {
    setExprInput(value);
    graph.set(ids.expr, resolveNaturalLanguageQuery(value) ?? value);
  }

  /**
   * Copies a pending live-viewport override back into the four x/y-min/max
   * cells (the real, resample-triggering commit) and clears the override --
   * shared by pan/pinch release and the wheel-zoom debounce below. Unlike
   * GraphCanvas/FourierPanel's single `ids.viewport` cell, there's no
   * separate committed-viewport cell to write here -- this IS the commit,
   * straight into the same cells the text inputs edit.
   */
  function commitLiveViewport() {
    const live = graph.get<Viewport | null>(ids.liveViewport);
    if (!live) return;
    graph.set(ids.xMin, String(live.xMin));
    graph.set(ids.xMax, String(live.xMax));
    graph.set(ids.yMin, String(live.yMin));
    graph.set(ids.yMax, String(live.yMax));
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
      const vp = graph.get<Viewport | null>(ids.liveViewport) ?? committedViewport;
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

    const vp = committedViewport;
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
    const vp = graph.get<Viewport | null>(ids.liveViewport) ?? committedViewport;
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
    graph.set(ids.xMin, DEFAULT_TAYLOR_STATE.xMin);
    graph.set(ids.xMax, DEFAULT_TAYLOR_STATE.xMax);
    graph.set(ids.yMin, DEFAULT_TAYLOR_STATE.yMin);
    graph.set(ids.yMax, DEFAULT_TAYLOR_STATE.yMax);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          f(x) ={" "}
          <input value={exprInput} onChange={(e) => updateExpr(e.target.value)} style={{ font: "inherit", width: "20ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          center ={" "}
          <input value={center} onChange={(e) => graph.set(ids.center, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>{" "}
        <label>
          order (n) ={" "}
          <input
            type="number"
            min={0}
            value={order}
            onChange={(e) => graph.set(ids.order, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          x: [<input value={xMin} onChange={(e) => graph.set(ids.xMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={xMax} onChange={(e) => graph.set(ids.xMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>{" "}
        <label>
          y: [<input value={yMin} onChange={(e) => graph.set(ids.yMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={yMax} onChange={(e) => graph.set(ids.yMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      {approx.ok ? (
        <p style={{ margin: "0.25rem 0" }}>
          Taylor polynomial: <CopyableTex tex={approx.latex} />
        </p>
      ) : (
        <p style={{ color: "var(--danger)" }}>{approx.message}</p>
      )}
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
        <PngExportButton getCanvas={() => canvasRef.current} label="taylor" />
        <SvgExportButton
          getSvg={() => (approx.ok ? pathsToSvgDocument([approx.fPath, approx.taylorPath], viewport, WIDTH, HEIGHT) : null)}
          label="taylor"
        />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
      <h2>Limit</h2>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          lim (x →{" "}
          <input value={limitPoint} onChange={(e) => graph.set(ids.limitPoint, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          {limitDirection === "left" ? "⁻" : limitDirection === "right" ? "⁺" : ""}) f(x) ={" "}
          {limitResult.ok ? limitResult.value.toFixed(6) : <span style={{ color: "var(--danger)" }}>{limitResult.message}</span>}
        </label>{" "}
        <select value={limitDirection} onChange={(e) => graph.set(ids.limitDirection, e.target.value as LimitDirection)}>
          <option value="both">both sides</option>
          <option value="left">from the left</option>
          <option value="right">from the right</option>
        </select>
      </div>
    </div>
  );
}
