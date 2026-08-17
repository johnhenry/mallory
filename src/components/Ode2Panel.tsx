import type { Path2D } from "mallory-math";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsOde2, type CellIdsOde2 } from "../lib/cell-ids.ts";
import { drawAxes, drawPath, type Viewport } from "../lib/render-path.ts";
import {
  attemptOde2ndOrderClosedForm,
  type Ode2ndOrderClosedFormAttempt,
  sampleOde2ndOrderSolution,
} from "../lib/sample-ode.ts";
import { DEFAULT_ODE2_STATE, decodeOde2State, encodeOde2State, type Ode2State } from "../lib/ode2-state.ts";
import { pathsToSvgDocument } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
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

function seedOde2State(graph: CellGraph, ids: CellIdsOde2, state: Ode2State): void {
  graph.set(ids.a, state.a);
  graph.set(ids.b, state.b);
  graph.set(ids.c, state.c);
  graph.set(ids.x0, state.x0);
  graph.set(ids.y0, state.y0);
  graph.set(ids.yPrime0, state.yPrime0);
  graph.set(ids.xMin, state.xMin);
  graph.set(ids.xMax, state.xMax);
  graph.set(ids.yMin, state.yMin);
  graph.set(ids.yMax, state.yMax);
}

function getCurrentOde2State(graph: CellGraph, ids: CellIdsOde2): Ode2State {
  return {
    v: 1,
    a: graph.get<string>(ids.a),
    b: graph.get<string>(ids.b),
    c: graph.get<string>(ids.c),
    x0: graph.get<string>(ids.x0),
    y0: graph.get<string>(ids.y0),
    yPrime0: graph.get<string>(ids.yPrime0),
    xMin: graph.get<string>(ids.xMin),
    xMax: graph.get<string>(ids.xMax),
    yMin: graph.get<string>(ids.yMin),
    yMax: graph.get<string>(ids.yMax),
  };
}

function useOde2Graph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsOde2(cellId);
    const decoded = typeof window !== "undefined" ? decodeOde2State(window.location.hash.slice(1)) : null;
    seedOde2State(graph, ids, decoded ?? DEFAULT_ODE2_STATE);
    graph.set<Viewport | null>(ids.liveViewport, null, { auxiliary: true });

    graph.define(ids.solution, (): SolutionResult => {
      try {
        const a = Number(graph.get<string>(ids.a));
        const b = Number(graph.get<string>(ids.b));
        const c = Number(graph.get<string>(ids.c));
        const x0 = Number(graph.get<string>(ids.x0));
        const y0 = Number(graph.get<string>(ids.y0));
        const yPrime0 = Number(graph.get<string>(ids.yPrime0));
        const xMin = Number(graph.get<string>(ids.xMin));
        const xMax = Number(graph.get<string>(ids.xMax));
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

    ref.current = graph;
  }
  return ref.current;
}

/** a*y'' + b*y' + c*y = 0, y(x0)=y0, y'(x0)=yPrime0 -- closed form (Symbolic.solveOde2ndOrderConstCoeff) plotted against its RK4 numeric trajectory as a built-in self-check; the two should visually overlap. */
export function Ode2Panel({ cellId = "ode2-1" }: { cellId?: string } = {}) {
  const graph = useOde2Graph(cellId);
  useCellGraphTools(`calculus_ode2_${cellId}`, graph);
  const ids = cellIdsOde2(cellId);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const a = useCell<string>(graph, ids.a);
  const b = useCell<string>(graph, ids.b);
  const c = useCell<string>(graph, ids.c);
  const x0 = useCell<string>(graph, ids.x0);
  const y0 = useCell<string>(graph, ids.y0);
  const yPrime0 = useCell<string>(graph, ids.yPrime0);
  const xMin = useCell<string>(graph, ids.xMin);
  const xMax = useCell<string>(graph, ids.xMax);
  const yMin = useCell<string>(graph, ids.yMin);
  const yMax = useCell<string>(graph, ids.yMax);
  const solution = useCell<SolutionResult>(graph, ids.solution);
  const closedForm = useCell<Ode2ndOrderClosedFormAttempt>(graph, ids.closedForm);
  const liveViewport = useCell<Viewport | null>(graph, ids.liveViewport);

  // subscribeMany (not subscribeAll, issue #242 -- follow-up to #235) --
  // getCurrentOde2State only reads the fixed cell list below (the committed
  // xMin/xMax/yMin/yMax cells), never ids.liveViewport, so a subscribeAll
  // here used to re-run writeUrl on every pan/pinch/wheel-zoom gesture tick
  // even though the URL never encodes the live mid-gesture viewport.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeOde2State(getCurrentOde2State(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeMany([ids.a, ids.b, ids.c, ids.x0, ids.y0, ids.yPrime0, ids.xMin, ids.xMax, ids.yMin, ids.yMax], writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

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

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawAxes(ctx, viewport, WIDTH, HEIGHT);
    if (solution.ok) drawPath(ctx, solution.path, viewport, WIDTH, HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solution, viewport]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    graph.set(ids.a, preset.a);
    graph.set(ids.b, preset.b);
    graph.set(ids.c, preset.c);
  }

  /** Copies a pending live-viewport override back into the four x/y-min/max cells (the real, resample-triggering commit) and clears the override. */
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
    graph.set(ids.xMin, DEFAULT_ODE2_STATE.xMin);
    graph.set(ids.xMax, DEFAULT_ODE2_STATE.xMax);
    graph.set(ids.yMin, DEFAULT_ODE2_STATE.yMin);
    graph.set(ids.yMax, DEFAULT_ODE2_STATE.yMax);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        {PRESETS.map((preset) => (
          <button key={preset.label} type="button" onClick={() => applyPreset(preset)} style={{ marginRight: "0.5rem" }}>
            {preset.label}
          </button>
        ))}
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
      {closedForm.found ? (
        <p style={{ margin: "0.25rem 0" }}>
          Closed form: <CopyableTex tex={`y = ${closedForm.latex}`} />
          <br />
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Discriminant b² − 4ac = {closedForm.discriminant?.toFixed(4)} — {ROOT_CASE_LABEL[closedForm.rootCase ?? ""]}
          </span>
        </p>
      ) : (
        closedForm.message && <p style={{ color: "var(--danger)" }}>{closedForm.message}</p>
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
        <PngExportButton getCanvas={() => canvasRef.current} label="ode-2nd-order" />
        <SvgExportButton getSvg={() => (solution.ok ? pathsToSvgDocument([solution.path], viewport, WIDTH, HEIGHT) : null)} label="ode-2nd-order" />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
      {!solution.ok && <p style={{ color: "var(--danger)" }}>{solution.message}</p>}
    </div>
  );
}
