import type { Path2D } from "@johnhenry/math";
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef } from "react";
import { CellGraph } from "@johnhenry/math";
import { cellIdsTaylor } from "../lib/cell-ids.ts";
import { drawAxes, drawPath, type Viewport } from "../lib/render-path.ts";
import { resolveNaturalLanguageQuery } from "../lib/nl-query.ts";
import { computeLimit, computeTaylorApproximation, type LimitDirection } from "../lib/taylor-approx.ts";
import { DEFAULT_TAYLOR_STATE, decodeTaylorState, encodeTaylorState, type TaylorRowState } from "../lib/taylor-state.ts";
import { pathsToSvgDocument } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useNonPassiveWheel } from "../hooks/use-non-passive-wheel.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
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

/** Seeds one function row's own cells (issue #251, unlimited expressions): its own f(x)/center/order/limit point+direction, color and visibility, and its own derived approximation/limit. Reads the shared container's x/y viewport live inside `taylorPath`'s define, so panning/resizing the one shared domain recomputes every row. */
export function seedTaylorRow(graph: CellGraph, containerIds: ReturnType<typeof cellIdsTaylor>, rowId: string, row: TaylorRowState): void {
  const ids = cellIdsTaylor(rowId);
  graph.set(ids.expr, row.expr);
  graph.set(ids.center, row.center);
  graph.set(ids.order, row.order);
  graph.set(ids.limitPoint, row.limitPoint);
  graph.set(ids.limitDirection, row.limitDirection);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

  graph.define(ids.taylorPath, (): ApproxResult => {
    try {
      const expr = graph.get<string>(ids.expr);
      const center = Number(graph.get<string>(ids.center));
      const order = Number(graph.get<string>(ids.order));
      const xMin = Number(graph.get<string>(containerIds.xMin));
      const xMax = Number(graph.get<string>(containerIds.xMax));
      const yMin = Number(graph.get<string>(containerIds.yMin));
      const yMax = Number(graph.get<string>(containerIds.yMax));
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
}

function seedTaylorRowDefault(graph: CellGraph, containerIds: ReturnType<typeof cellIdsTaylor>, rowId: string, index: number): void {
  seedTaylorRow(graph, containerIds, rowId, { ...(DEFAULT_TAYLOR_STATE.rows[0] as TaylorRowState), color: paletteColor(index) });
}

/**
 * Pure re-render of the shared f(x)/Taylor-polynomial canvas, extracted
 * from the redraw effect below so `PngExportButton`'s `renderAtScale`
 * (issue #278) can call it against a fresh offscreen canvas at any size.
 */
export function drawTaylorPanel(ctx: CanvasRenderingContext2D, width: number, height: number, graph: CellGraph, containerIds: ReturnType<typeof cellIdsTaylor>): void {
  ctx.clearRect(0, 0, width, height);
  const live = graph.get<Viewport | null>(containerIds.liveViewport);
  const vp = live ?? {
    xMin: Number(graph.get<string>(containerIds.xMin)) || -5,
    xMax: Number(graph.get<string>(containerIds.xMax)) || 5,
    yMin: Number(graph.get<string>(containerIds.yMin)) || -5,
    yMax: Number(graph.get<string>(containerIds.yMax)) || 5,
  };
  drawAxes(ctx, vp, width, height);
  for (const rowId of graph.get<string[]>(containerIds.list)) {
    const ids = cellIdsTaylor(rowId);
    try {
      if (!graph.get<boolean>(ids.visible)) continue;
      const approx = graph.get<ApproxResult>(ids.taylorPath);
      if (!approx.ok) continue;
      const color = graph.get<number>(ids.color);
      drawPath(ctx, { ...approx.fPath, stroke: { ...approx.fPath.stroke, color } }, vp, width, height);
      drawPath(ctx, { ...approx.taylorPath, stroke: { ...approx.taylorPath.stroke, color } }, vp, width, height, true);
    } catch {
      // A row whose cells haven't registered yet -- skip it this frame.
    }
  }
}

function useTaylorGraph(containerId: string): { graph: CellGraph; containerIds: ReturnType<typeof cellIdsTaylor> } {
  // `containerIds` is memoized on the ref itself (not just `useMemo`d on
  // `containerId`) so it's the exact SAME object reference across every
  // render for the life of this graph -- `cellIdsTaylor(containerId)`
  // otherwise returns a structurally-equal but referentially-NEW object
  // every render, which defeated the redraw/writeUrl effects' own
  // `[graph, containerIds]` dependency checks below: React saw
  // "containerIds changed" on every unrelated re-render (e.g. the `rowIds`
  // useCell hook firing after a cell write), tore down and re-ran those
  // effects -- including their own unconditional `redraw()`/`writeUrl()`
  // call at the top of the effect body -- ON TOP OF the `subscribeAll`
  // notification the same write already triggered, doubling every redraw.
  // Exactly the class of bug issue #236 originally fixed for
  // `committedViewport`, reintroduced here by this hook's own container-id
  // object; see TaylorPanel.test.ts's own doc comment for how this was
  // caught.
  const ref = useRef<{ graph: CellGraph; containerIds: ReturnType<typeof cellIdsTaylor> } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsTaylor(containerId);
    const graph = new CellGraph();
    const decoded = typeof window !== "undefined" ? decodeTaylorState(window.location.hash.slice(1)) : null;
    const state = decoded ?? DEFAULT_TAYLOR_STATE;
    graph.set(containerIds.xMin, state.xMin);
    graph.set(containerIds.xMax, state.xMax);
    graph.set(containerIds.yMin, state.yMin);
    graph.set(containerIds.yMax, state.yMax);
    graph.set<Viewport | null>(containerIds.liveViewport, null, { auxiliary: true });
    const rowIds = state.rows.map(() => crypto.randomUUID());
    rowIds.forEach((id, i) => seedTaylorRow(graph, containerIds, id, state.rows[i] as TaylorRowState));
    graph.set(containerIds.list, rowIds, { auxiliary: true });
    ref.current = { graph, containerIds };
  }
  return ref.current;
}

/** One function row's controls (issue #251): f(x)/center/order, color/visibility, its own Taylor-polynomial readout, and its own limit query. */
function TaylorRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsTaylor(rowId);
  const expr = useCell<string>(graph, ids.expr);
  const center = useCell<string>(graph, ids.center);
  const order = useCell<string>(graph, ids.order);
  const limitPoint = useCell<string>(graph, ids.limitPoint);
  const limitDirection = useCell<LimitDirection>(graph, ids.limitDirection);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const approx = useCell<ApproxResult>(graph, ids.taylorPath);
  const limitResult = useCell<LimitResult>(graph, ids.limitResult);

  function updateExpr(value: string) {
    graph.set(ids.expr, resolveNaturalLanguageQuery(value) ?? value);
  }

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
          f(x) = <input value={expr} onChange={(e) => updateExpr(e.target.value)} style={{ font: "inherit", width: "18ch" }} />
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this function">
            ✕
          </button>
        )}
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
      {approx.ok ? (
        <p style={{ margin: "0.25rem 0" }}>
          Taylor polynomial: <CopyableTex tex={approx.latex} />
        </p>
      ) : (
        <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{approx.message}</p>
      )}
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

/**
 * Unlimited functions f(x), each plotted against its own degree-n Taylor
 * polynomial about a center point (Symbolic.taylor) and its own numeric
 * limit readout (Symbolic.limit) at a chosen point/direction (issue #251),
 * overlaid on one shared, pannable/zoomable x/y viewport. v1 was a single
 * function only; every function now gets its own color/visibility, the
 * same "shared viewport, unlimited rows" shape GraphCanvasMulti established
 * -- each row draws its f(x) solid and its Taylor polynomial dashed, both
 * in the row's own color, so two overlaid rows stay distinguishable.
 */
export function TaylorPanel({ cellId = "taylor-1" }: { cellId?: string } = {}) {
  const { graph, containerIds } = useTaylorGraph(cellId);
  useCellGraphTools(`calculus_taylor_${cellId}`, graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const xMin = useCell<string>(graph, containerIds.xMin);
  const xMax = useCell<string>(graph, containerIds.xMax);
  const yMin = useCell<string>(graph, containerIds.yMin);
  const yMax = useCell<string>(graph, containerIds.yMax);
  const liveViewport = useCell<Viewport | null>(graph, containerIds.liveViewport);

  function addFunction() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedTaylorRowDefault(graph, containerIds, id, index);
  }

  function removeFunction(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsTaylor(rowId));
  }

  // subscribeMany (not subscribeAll, issue #242's own precedent, extended to
  // the dynamic row list the same way the draw effect below is): getState
  // never reads ids.liveViewport, so watching every graph cell here would
  // re-run writeUrl on every mid-gesture pan/zoom tick, the exact thing
  // #242 fixed for the single-row shape.
  useEffect(() => {
    function writeUrl() {
      const rows = graph.get<string[]>(containerIds.list).map((rowId) => {
        const ids = cellIdsTaylor(rowId);
        return {
          expr: graph.get<string>(ids.expr),
          center: graph.get<string>(ids.center),
          order: graph.get<string>(ids.order),
          limitPoint: graph.get<string>(ids.limitPoint),
          limitDirection: graph.get<LimitDirection>(ids.limitDirection),
          color: graph.get<number>(ids.color),
          visible: graph.get<boolean>(ids.visible),
        };
      });
      window.history.replaceState(
        null,
        "",
        `#${encodeTaylorState({
          v: 2,
          xMin: graph.get<string>(containerIds.xMin),
          xMax: graph.get<string>(containerIds.xMax),
          yMin: graph.get<string>(containerIds.yMin),
          yMax: graph.get<string>(containerIds.yMax),
          rows,
        })}`,
      );
    }
    writeUrl();
    const watchedIds = [
      containerIds.list,
      containerIds.xMin,
      containerIds.xMax,
      containerIds.yMin,
      containerIds.yMax,
      ...rowIds.flatMap((id) => {
        const ids = cellIdsTaylor(id);
        return [ids.expr, ids.center, ids.order, ids.limitPoint, ids.limitDirection, ids.color, ids.visible];
      }),
    ];
    return graph.subscribeMany(watchedIds, writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, containerIds, rowIds]);

  // Unlike GraphCanvas/FourierPanel/ParametricPanel, there's no single
  // cached `viewport` cell here -- x/y-min/max are four separate free cells
  // (so they can be four separate text inputs), so a fresh object built
  // from them inline was a NEW reference on every render even when none of
  // the four actually changed. Memoized on the four underlying values so
  // the reference is stable when they aren't.
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

  // Redraws whenever the row list changes, the shared viewport pans/zooms,
  // or any individual row's own cells do -- graph.subscribeAll rather than
  // per-row useCell hooks or subscribeMany, same reasoning as every other
  // multi-row panel in this PR (GraphCanvasMulti/ImplicitPanel/
  // ParametricPanel/Ode2Panel/...): the row *set* changes as much as any
  // one row's own cells do, and a fixed hook-per-row list can't track a
  // dynamic row count. Unlike a per-row `subscribeMany` (which fires once
  // per individually-dirtied watched cell), `subscribeAll` is batched to
  // exactly one notification per logical `set()` (see cell-graph.ts's own
  // `scheduleGlobalNotify` doc) -- issue #236's original fix instead
  // enumerated a fixed cell list to also SKIP redraws for fields the draw
  // never reads (e.g. limitPoint); that filtering doesn't survive the move
  // to an unbounded row list (issue #251) without hand-tracking a growing
  // per-row id set, so this panel now accepts the same "redraws once per
  // write, including writes the canvas doesn't visually depend on" tradeoff
  // GraphCanvasMulti's own reference implementation already does -- see
  // this file's own test for the updated expectation.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const redraw = () => drawTaylorPanel(ctx, WIDTH, HEIGHT, graph, containerIds);
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  /**
   * Copies a pending live-viewport override back into the four x/y-min/max
   * cells (the real, resample-triggering commit) and clears the override --
   * shared by pan/pinch release and the wheel-zoom debounce below. Unlike
   * GraphCanvas/FourierPanel's single `ids.viewport` cell, there's no
   * separate committed-viewport cell to write here -- this IS the commit,
   * straight into the same cells the text inputs edit.
   */
  function commitLiveViewport() {
    const live = graph.get<Viewport | null>(containerIds.liveViewport);
    if (!live) return;
    graph.set(containerIds.xMin, String(live.xMin));
    graph.set(containerIds.xMax, String(live.xMax));
    graph.set(containerIds.yMin, String(live.yMin));
    graph.set(containerIds.yMax, String(live.yMax));
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
      const vp = graph.get<Viewport | null>(containerIds.liveViewport) ?? committedViewport;
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
    const vp = graph.get<Viewport | null>(containerIds.liveViewport) ?? committedViewport;
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
    graph.set(containerIds.xMin, DEFAULT_TAYLOR_STATE.xMin);
    graph.set(containerIds.xMax, DEFAULT_TAYLOR_STATE.xMax);
    graph.set(containerIds.yMin, DEFAULT_TAYLOR_STATE.yMin);
    graph.set(containerIds.yMax, DEFAULT_TAYLOR_STATE.yMax);
  }

  function getExportSvg(): string | null {
    const paths: Path2D[] = [];
    for (const rowId of rowIds) {
      const ids = cellIdsTaylor(rowId);
      if (!graph.hasValue(ids.taylorPath) || !graph.get<boolean>(ids.visible)) continue;
      const approx = graph.get<ApproxResult>(ids.taylorPath);
      if (approx.ok) paths.push(approx.fPath, approx.taylorPath);
    }
    if (paths.length === 0) return null;
    return pathsToSvgDocument(paths, viewport, WIDTH, HEIGHT);
  }

  return (
    <div>
      {rowIds.map((rowId) => (
        <TaylorRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeFunction(rowId) : undefined} />
      ))}
      <button type="button" onClick={addFunction} style={{ margin: "0.35rem 0" }}>
        + Add function
      </button>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          x: [<input value={xMin} onChange={(e) => graph.set(containerIds.xMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={xMax} onChange={(e) => graph.set(containerIds.xMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>{" "}
        <label>
          y: [<input value={yMin} onChange={(e) => graph.set(containerIds.yMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={yMax} onChange={(e) => graph.set(containerIds.yMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
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
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="taylor"
          renderAtScale={(ctx, width, height) => drawTaylorPanel(ctx, width, height, graph, containerIds)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <SvgExportButton getSvg={getExportSvg} label="taylor" />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
    </div>
  );
}
