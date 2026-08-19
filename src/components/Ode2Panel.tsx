import type { Path2D } from "mallory-math";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, type WheelEvent as ReactWheelEvent } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsOde2 } from "../lib/cell-ids.ts";
import { drawAxes, drawPath, type Viewport } from "../lib/render-path.ts";
import { attemptOde2ndOrderClosedForm, type Ode2ndOrderClosedFormAttempt, sampleOde2ndOrderSolution } from "../lib/sample-ode.ts";
import { DEFAULT_ODE2_STATE, decodeOde2State, encodeOde2State, type Ode2RowState } from "../lib/ode2-state.ts";
import { pathsToSvgDocument } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import { useCell } from "../lib/use-cell.ts";
import { canvasEventPoint, toDataX, toDataY } from "../lib/viewport.ts";
import { pinchZoomFactor, viewportFromAnchor, wheelZoomFactor } from "../lib/viewport-gestures.ts";
import { CopyableTex } from "./CopyableTex.tsx";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

type SolutionResult = { ok: true; path: Path2D } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;
const ZOOM_STEP = 1.1;
const ZOOM_COMMIT_DEBOUNCE_MS = 150;

const ROOT_CASE_LABEL: Record<string, string> = {
  "distinct-real": "Overdamped — two distinct real roots",
  repeated: "Critically damped — repeated root",
  complex: "Underdamped — complex conjugate roots",
};

/** a=1 throughout: b/c chosen so disc = b²-4c lands solidly in each case, all with the same y0=1, y'0=0 (released from rest) so the three curves are visually comparable. */
const PRESETS: Array<{ label: string; a: string; b: string; c: string }> = [
  { label: "Underdamped", a: "1", b: "0.4", c: "4" },
  { label: "Critically damped", a: "1", b: "4", c: "4" },
  { label: "Overdamped", a: "1", b: "5", c: "4" },
];

/** Seeds one equation row's own cells (issue #251, unlimited expressions): its own a/b/c/x0/y0/y'0, color and visibility, plus its own derived solution/closed form. Reads the shared container's x-domain live inside `solution`'s define, so panning/resizing the one shared domain recomputes every row. */
export function seedOde2Row(graph: CellGraph, containerIds: ReturnType<typeof cellIdsOde2>, rowId: string, row: Ode2RowState): void {
  const ids = cellIdsOde2(rowId);
  graph.set(ids.a, row.a);
  graph.set(ids.b, row.b);
  graph.set(ids.c, row.c);
  graph.set(ids.x0, row.x0);
  graph.set(ids.y0, row.y0);
  graph.set(ids.yPrime0, row.yPrime0);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

  graph.define(ids.solution, (): SolutionResult => {
    try {
      const a = Number(graph.get<string>(ids.a));
      const b = Number(graph.get<string>(ids.b));
      const c = Number(graph.get<string>(ids.c));
      const x0 = Number(graph.get<string>(ids.x0));
      const y0 = Number(graph.get<string>(ids.y0));
      const yPrime0 = Number(graph.get<string>(ids.yPrime0));
      const xMin = Number(graph.get<string>(containerIds.xMin));
      const xMax = Number(graph.get<string>(containerIds.xMax));
      if ([a, b, c, x0, y0, yPrime0, xMin, xMax].some(Number.isNaN)) throw new Error("Every field must be a number.");
      if (xMin >= xMax) throw new Error("x-min must be less than x-max.");
      if (a === 0) throw new Error("a must be nonzero -- otherwise this isn't a second-order equation.");
      const path = sampleOde2ndOrderSolution({ a, b, c }, x0, y0, yPrime0, { min: xMin, max: xMax });
      return { ok: true, path };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  graph.define(ids.closedForm, (): Ode2ndOrderClosedFormAttempt => {
    const a = Number(graph.get<string>(ids.a));
    const b = Number(graph.get<string>(ids.b));
    const c = Number(graph.get<string>(ids.c));
    const x0 = Number(graph.get<string>(ids.x0));
    const y0 = Number(graph.get<string>(ids.y0));
    const yPrime0 = Number(graph.get<string>(ids.yPrime0));
    if ([a, b, c, x0, y0, yPrime0].some(Number.isNaN)) return { found: false, message: "Every field must be a number." };
    return attemptOde2ndOrderClosedForm({ a, b, c }, x0, y0, yPrime0);
  });
}

function seedOde2RowDefault(graph: CellGraph, containerIds: ReturnType<typeof cellIdsOde2>, rowId: string, index: number): void {
  seedOde2Row(graph, containerIds, rowId, { ...(DEFAULT_ODE2_STATE.rows[0] as Ode2RowState), color: paletteColor(index) });
}

/**
 * Pure re-render of the shared ODE2 solutions canvas, extracted from the
 * redraw effect below so `PngExportButton`'s `renderAtScale` (issue #278)
 * can call it against a fresh offscreen canvas at any size.
 */
export function drawOde2Panel(ctx: CanvasRenderingContext2D, width: number, height: number, graph: CellGraph, containerIds: ReturnType<typeof cellIdsOde2>): void {
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
    const ids = cellIdsOde2(rowId);
    try {
      if (!graph.get<boolean>(ids.visible)) continue;
      const solution = graph.get<SolutionResult>(ids.solution);
      if (!solution.ok) continue;
      const color = graph.get<number>(ids.color);
      drawPath(ctx, { ...solution.path, stroke: { ...solution.path.stroke, color } }, vp, width, height);
    } catch {
      // A row whose cells haven't registered yet -- skip it this frame.
    }
  }
}

function useOde2Graph(containerId: string): { graph: CellGraph; containerIds: ReturnType<typeof cellIdsOde2> } {
  // `containerIds` is memoized on the ref itself, not recomputed every
  // render -- see ImplicitPanel's identical `useImplicitGraph` doc comment
  // for why (issue #236's stale-reference bug class, reintroduced by this
  // hook's own container-id object).
  const ref = useRef<{ graph: CellGraph; containerIds: ReturnType<typeof cellIdsOde2> } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsOde2(containerId);
    const graph = new CellGraph();
    const decoded = typeof window !== "undefined" ? decodeOde2State(window.location.hash.slice(1)) : null;
    const state = decoded ?? DEFAULT_ODE2_STATE;
    graph.set(containerIds.xMin, state.xMin);
    graph.set(containerIds.xMax, state.xMax);
    graph.set(containerIds.yMin, state.yMin);
    graph.set(containerIds.yMax, state.yMax);
    graph.set<Viewport | null>(containerIds.liveViewport, null, { auxiliary: true });
    const rowIds = state.rows.map(() => crypto.randomUUID());
    rowIds.forEach((id, i) => seedOde2Row(graph, containerIds, id, state.rows[i] as Ode2RowState));
    graph.set(containerIds.list, rowIds, { auxiliary: true });
    ref.current = { graph, containerIds };
  }
  return ref.current;
}

/** One equation row's controls (issue #251): damping presets, a/b/c coefficients, initial conditions, color/visibility, and its own closed-form readout. */
function Ode2Row({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsOde2(rowId);
  const a = useCell<string>(graph, ids.a);
  const b = useCell<string>(graph, ids.b);
  const c = useCell<string>(graph, ids.c);
  const x0 = useCell<string>(graph, ids.x0);
  const y0 = useCell<string>(graph, ids.y0);
  const yPrime0 = useCell<string>(graph, ids.yPrime0);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const closedForm = useCell<Ode2ndOrderClosedFormAttempt>(graph, ids.closedForm);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    graph.set(ids.a, preset.a);
    graph.set(ids.b, preset.b);
    graph.set(ids.c, preset.c);
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
        {PRESETS.map((preset) => (
          <button key={preset.label} type="button" onClick={() => applyPreset(preset)}>
            {preset.label}
          </button>
        ))}
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this equation">
            ✕
          </button>
        )}
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          <input value={a} onChange={(e) => graph.set(ids.a, e.target.value)} style={{ font: "inherit", width: "5ch" }} />
          {" y'' + "}
          <input value={b} onChange={(e) => graph.set(ids.b, e.target.value)} style={{ font: "inherit", width: "5ch" }} />
          {" y' + "}
          <input value={c} onChange={(e) => graph.set(ids.c, e.target.value)} style={{ font: "inherit", width: "5ch" }} />
          {" y = 0"}
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          y(
          <input value={x0} onChange={(e) => graph.set(ids.x0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ) ={" "}
          <input value={y0} onChange={(e) => graph.set(ids.y0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>{" "}
        <label>
          y'(
          <input value={x0} readOnly style={{ font: "inherit", width: "6ch" }} />
          ) ={" "}
          <input value={yPrime0} onChange={(e) => graph.set(ids.yPrime0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
      </div>
      {closedForm.found ? (
        <p style={{ margin: "0.25rem 0" }}>
          Closed form: <CopyableTex tex={`y = ${closedForm.latex}`} />
          <br />
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Discriminant b² − 4ac = {closedForm.discriminant?.toFixed(4)} — {ROOT_CASE_LABEL[closedForm.rootCase ?? ""]}
          </span>
        </p>
      ) : (
        closedForm.message && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{closedForm.message}</p>
      )}
    </div>
  );
}

/**
 * Unlimited second-order linear ODEs a*y'' + b*y' + c*y = 0, y(x0)=y0,
 * y'(x0)=yPrime0 (issue #251) -- each row's closed form (Symbolic.
 * solveOde2ndOrderConstCoeff) plotted against its own RK4 numeric
 * trajectory as a built-in self-check, overlaid on one shared, pannable/
 * zoomable x/y viewport. v1 was a single equation only; every equation now
 * gets its own color/visibility, the same "shared viewport, unlimited rows"
 * shape GraphCanvasMulti established for y=f(x) curves.
 */
export function Ode2Panel({ cellId = "ode2-1" }: { cellId?: string } = {}) {
  const { graph, containerIds } = useOde2Graph(cellId);
  useCellGraphTools(`calculus_ode2_${cellId}`, graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const xMin = useCell<string>(graph, containerIds.xMin);
  const xMax = useCell<string>(graph, containerIds.xMax);
  const yMin = useCell<string>(graph, containerIds.yMin);
  const yMax = useCell<string>(graph, containerIds.yMax);
  const liveViewport = useCell<Viewport | null>(graph, containerIds.liveViewport);

  function addEquation() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedOde2RowDefault(graph, containerIds, id, index);
  }

  function removeEquation(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsOde2(rowId));
  }

  useEffect(() => {
    function writeUrl() {
      const rows = graph.get<string[]>(containerIds.list).map((rowId) => {
        const ids = cellIdsOde2(rowId);
        return {
          a: graph.get<string>(ids.a),
          b: graph.get<string>(ids.b),
          c: graph.get<string>(ids.c),
          x0: graph.get<string>(ids.x0),
          y0: graph.get<string>(ids.y0),
          yPrime0: graph.get<string>(ids.yPrime0),
          color: graph.get<number>(ids.color),
          visible: graph.get<boolean>(ids.visible),
        };
      });
      window.history.replaceState(
        null,
        "",
        `#${encodeOde2State({
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
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, containerIds]);

  const committedViewport: Viewport = {
    xMin: Number(xMin) || -5,
    xMax: Number(xMax) || 5,
    yMin: Number(yMin) || -5,
    yMax: Number(yMax) || 5,
  };
  const viewport = liveViewport ?? committedViewport;

  // Pan/pinch gesture state (issue #53), mirroring TaylorPanel's #189
  // xMin/xMax/yMin/yMax-cells-are-the-viewport approach. No draggable
  // handle, so every pointerdown is a pinch (2+ pointers) or a pan.
  const gestureRef = useRef<
    | { kind: "pan"; anchorX: number; anchorY: number; spanX: number; spanY: number }
    | { kind: "pinch"; anchorX: number; anchorY: number; spanX: number; spanY: number; startDistancePx: number }
    | null
  >(null);
  const activePointersRef = useRef<Map<number, { sx: number; sy: number }>>(new Map());
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Redraws whenever the row list changes, the shared viewport pans/zooms,
  // or any individual row's own cells do -- graph.subscribeAll rather than
  // per-row useCell hooks, same reasoning as every other multi-row panel.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const redraw = () => drawOde2Panel(ctx, WIDTH, HEIGHT, graph, containerIds);
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  /** Copies a pending live-viewport override back into the four x/y-min/max cells (the real, resample-triggering commit) and clears the override. */
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

  /** Wheel-to-zoom, anchored on the cursor's data point; the real commit is debounced (no pointerup to trigger it). */
  function handleWheel(e: ReactWheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const vp = graph.get<Viewport | null>(containerIds.liveViewport) ?? committedViewport;
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
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

  function resetView() {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    graph.set<Viewport | null>(containerIds.liveViewport, null);
    graph.set(containerIds.xMin, DEFAULT_ODE2_STATE.xMin);
    graph.set(containerIds.xMax, DEFAULT_ODE2_STATE.xMax);
    graph.set(containerIds.yMin, DEFAULT_ODE2_STATE.yMin);
    graph.set(containerIds.yMax, DEFAULT_ODE2_STATE.yMax);
  }

  function getExportSvg(): string | null {
    const paths: Path2D[] = [];
    for (const rowId of rowIds) {
      const ids = cellIdsOde2(rowId);
      if (!graph.hasValue(ids.solution) || !graph.get<boolean>(ids.visible)) continue;
      const solution = graph.get<SolutionResult>(ids.solution);
      if (solution.ok) paths.push(solution.path);
    }
    if (paths.length === 0) return null;
    return pathsToSvgDocument(paths, viewport, WIDTH, HEIGHT);
  }

  return (
    <div>
      {rowIds.map((rowId) => (
        <Ode2Row key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeEquation(rowId) : undefined} />
      ))}
      <button type="button" onClick={addEquation} style={{ margin: "0.35rem 0" }}>
        + Add equation
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
        onWheel={handleWheel}
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="ode-2nd-order"
          renderAtScale={(ctx, width, height) => drawOde2Panel(ctx, width, height, graph, containerIds)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <SvgExportButton getSvg={getExportSvg} label="ode-2nd-order" />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
    </div>
  );
}
