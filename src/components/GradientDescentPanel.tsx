import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsGradientDescent, TIME_CELL, type CellIdsGradientDescent } from "../lib/cell-ids.ts";
import { computeContourLevels, type ContourLevel } from "../lib/contour-plot.ts";
import {
  DEFAULT_GRADIENT_DESCENT_STATE,
  decodeGradientDescentState,
  encodeGradientDescentState,
  type GradientDescentState,
} from "../lib/gradient-descent-state.ts";
import { runGradientDescent, type DescentResult, type OptimizerType } from "../lib/gradient-descent.ts";
import { drawImplicitCurve, drawPoint, drawPolyline } from "../lib/render-path.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { canvasEventPoint, toDataX, toDataY, type Viewport } from "../lib/viewport.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { TransportControls } from "./TransportControls.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export interface OptimizerRun {
  optimizer: OptimizerType;
  result: DescentResult;
}

const WIDTH = 520;
const HEIGHT = 520;
const VIEWPORT: Viewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
const DOMAIN = { min: -5, max: 5 };
// Per-step transport animation (issue #33's remaining scope): 1 descent
// step = this many seconds of the shared TIME_CELL clock, so the default
// 80-step run plays back over 8s -- watchable, not instant, not a slog.
export const STEP_SECONDS = 0.1;

/** The longest racing path's step count (paths can differ in length -- a diverged run stops early). Empty/no-runs gives 0, not -Infinity. */
export function maxDescentSteps(runs: readonly OptimizerRun[]): number {
  return Math.max(0, ...runs.map((run) => run.result.path.length - 1));
}

/** The index into a (possibly shorter, already-stopped) run's own path the shared clock currently points at -- clamped so a fast/short-diverged run just holds its last point once the clock outruns it, rather than reading past the array end. */
export function visiblePathIndex(time: number, pathLength: number): number {
  return Math.min(Math.floor(time / STEP_SECONDS), pathLength - 1);
}

const OPTIMIZER_COLORS: Record<OptimizerType, string> = {
  sgd: "#2563eb",
  adam: "#dc2626",
  rmsprop: "#16a34a",
};

const OPTIMIZER_LABELS: Record<OptimizerType, string> = {
  sgd: "SGD",
  adam: "Adam",
  rmsprop: "RMSprop",
};

function seedState(graph: CellGraph, ids: CellIdsGradientDescent, state: GradientDescentState): void {
  graph.set(ids.exprText, state.exprText);
  graph.set(ids.startX, state.startX);
  graph.set(ids.startY, state.startY);
  graph.set(ids.lr, state.lr);
  graph.set(ids.steps, state.steps);
  graph.set(ids.showSgd, state.showSgd);
  graph.set(ids.showAdam, state.showAdam);
  graph.set(ids.showRmsprop, state.showRmsprop);
  graph.set(ids.useSchedule, state.useSchedule ?? DEFAULT_GRADIENT_DESCENT_STATE.useSchedule);
  graph.set(ids.stepSize, state.stepSize ?? DEFAULT_GRADIENT_DESCENT_STATE.stepSize);
  graph.set(ids.gamma, state.gamma ?? DEFAULT_GRADIENT_DESCENT_STATE.gamma);
}

function getCurrentState(graph: CellGraph, ids: CellIdsGradientDescent): GradientDescentState {
  return {
    v: 1,
    exprText: graph.get<string>(ids.exprText),
    startX: graph.get<string>(ids.startX),
    startY: graph.get<string>(ids.startY),
    lr: graph.get<string>(ids.lr),
    steps: graph.get<string>(ids.steps),
    showSgd: graph.get<boolean>(ids.showSgd),
    showAdam: graph.get<boolean>(ids.showAdam),
    showRmsprop: graph.get<boolean>(ids.showRmsprop),
    useSchedule: graph.get<boolean>(ids.useSchedule),
    stepSize: graph.get<string>(ids.stepSize),
    gamma: graph.get<string>(ids.gamma),
  };
}

function useGradientDescentGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsGradientDescent(cellId);
    const decoded = typeof window !== "undefined" ? decodeGradientDescentState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_GRADIENT_DESCENT_STATE);
    if (!graph.has(TIME_CELL)) graph.set(TIME_CELL, 0, { auxiliary: true });

    graph.define(ids.contoursResult, (): Result<ContourLevel[]> => {
      try {
        return { ok: true, value: computeContourLevels(graph.get<string>(ids.exprText), DOMAIN, DOMAIN, 80, 10) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.descentResults, (): Result<OptimizerRun[]> => {
      try {
        const exprText = graph.get<string>(ids.exprText);
        const startX = Number(graph.get<string>(ids.startX));
        const startY = Number(graph.get<string>(ids.startY));
        const lr = Number(graph.get<string>(ids.lr));
        const steps = Number(graph.get<string>(ids.steps));
        const enabled: OptimizerType[] = [];
        if (graph.get<boolean>(ids.showSgd)) enabled.push("sgd");
        if (graph.get<boolean>(ids.showAdam)) enabled.push("adam");
        if (graph.get<boolean>(ids.showRmsprop)) enabled.push("rmsprop");
        let schedule: { stepSize: number; gamma: number } | undefined;
        if (graph.get<boolean>(ids.useSchedule)) {
          const stepSize = Number(graph.get<string>(ids.stepSize));
          const gamma = Number(graph.get<string>(ids.gamma));
          if (!Number.isInteger(stepSize) || stepSize <= 0) throw new Error("Schedule step size must be a positive integer.");
          if (!Number.isFinite(gamma) || gamma <= 0) throw new Error("Schedule gamma must be a positive number.");
          schedule = { stepSize, gamma };
        }
        // Same expression, same start, same lr/steps/schedule -- the runs
        // differ ONLY by optimizer, which is what makes the overlay a
        // genuine race.
        const runs = enabled.map((optimizer) => ({
          optimizer,
          result: runGradientDescent(exprText, startX, startY, optimizer, lr, steps, schedule),
        }));
        return { ok: true, value: runs };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * Gradient descent on f(x, y), visualized as optimizer paths over a contour
 * plot (issue #33): the full Symbolic -> compileExpr -> asVariableOp ->
 * Variable.backward() -> optim chain, with SGD/Adam/RMSprop racing from the
 * same start point in different colors. Click the canvas to move the start.
 *
 * v1 renders on the 2D contour view (reusing #28's computeContourLevels)
 * rather than animating a polyline on the Three.js surface -- the contour
 * picture is where optimizer-behavior differences (SGD's zigzag across an
 * anisotropic valley vs Adam's per-coordinate scaling) actually read
 * clearly. The 3D-surface path overlay remains deferred scope on the
 * issue. An optional `optim.StepLR` schedule (stepSize/gamma) is
 * available, applied uniformly to every racing optimizer -- off by
 * default. Each racing path plays back per-step on the shared TIME_CELL
 * clock (STEP_SECONDS per step) via the same TransportControls/
 * useTimelinePlayback machinery GraphCanvas/Graph3DCanvas already use,
 * rather than rendering the whole path at once.
 */
export function GradientDescentPanel({ cellId = "gd-1" }: { cellId?: string } = {}) {
  const graph = useGradientDescentGraph(cellId);
  useCellGraphTools(`gradient_descent_${cellId}`, graph);
  const ids = cellIdsGradientDescent(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprText = useCell<string>(graph, ids.exprText);
  const startX = useCell<string>(graph, ids.startX);
  const startY = useCell<string>(graph, ids.startY);
  const lr = useCell<string>(graph, ids.lr);
  const steps = useCell<string>(graph, ids.steps);
  const showSgd = useCell<boolean>(graph, ids.showSgd);
  const showAdam = useCell<boolean>(graph, ids.showAdam);
  const showRmsprop = useCell<boolean>(graph, ids.showRmsprop);
  const useSchedule = useCell<boolean>(graph, ids.useSchedule);
  const stepSize = useCell<string>(graph, ids.stepSize);
  const gamma = useCell<string>(graph, ids.gamma);
  const contoursResult = useCell<Result<ContourLevel[]>>(graph, ids.contoursResult);
  const descentResults = useCell<Result<OptimizerRun[]>>(graph, ids.descentResults);
  const time = useCell<number>(graph, TIME_CELL);

  const [exprInput, setExprInput] = useState(exprText);
  useEffect(() => {
    setExprInput(exprText);
  }, [exprText]);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const maxSteps = descentResults.ok ? maxDescentSteps(descentResults.value) : 0;
  const duration = maxSteps * STEP_SECONDS;
  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);
  // A fresh descent (new expression/start/lr/steps/optimizer set) restarts
  // the animation from the beginning rather than leaving the scrub head
  // wherever it was -- otherwise a shorter new run could leave `time` past
  // its own `duration`, silently showing the full path with no way to
  // "rewind" via the slider (its own max already shrank to match).
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descentResults]);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeGradientDescentState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (contoursResult.ok) {
      for (const level of contoursResult.value) {
        drawImplicitCurve(ctx, level.segments, VIEWPORT, WIDTH, HEIGHT, "rgba(148, 163, 184, 0.6)");
      }
    }
    if (descentResults.ok) {
      for (const run of descentResults.value) {
        const lastIndex = visiblePathIndex(time, run.result.path.length);
        drawPolyline(ctx, run.result.path.slice(0, lastIndex + 1), VIEWPORT, WIDTH, HEIGHT, OPTIMIZER_COLORS[run.optimizer]);
        const current = run.result.path[lastIndex];
        if (current) drawPoint(ctx, current, VIEWPORT, WIDTH, HEIGHT, 4, OPTIMIZER_COLORS[run.optimizer]);
      }
    }
    const sx = Number(startX);
    const sy = Number(startY);
    if (Number.isFinite(sx) && Number.isFinite(sy)) {
      drawPoint(ctx, { x: sx, y: sy }, VIEWPORT, WIDTH, HEIGHT, 6, "#111827");
    }
  }, [contoursResult, descentResults, startX, startY, time]);

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { sx, sy } = canvasEventPoint(e, canvas, WIDTH, HEIGHT);
    graph.set(ids.startX, toDataX(sx, VIEWPORT, WIDTH).toFixed(3));
    graph.set(ids.startY, toDataY(sy, VIEWPORT, HEIGHT).toFixed(3));
  }

  function updateExpr(value: string) {
    setExprInput(value);
    graph.set(ids.exprText, value);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          f(x, y) = <input value={exprInput} onChange={(e) => updateExpr(e.target.value)} style={{ font: "inherit", width: "20ch" }} />
        </label>
        <label>
          lr: <input value={lr} onChange={(e) => graph.set(ids.lr, e.target.value)} style={{ font: "inherit", width: "7ch" }} />
        </label>
        <label>
          steps:{" "}
          <input
            type="number"
            min={1}
            max={2000}
            value={steps}
            onChange={(e) => graph.set(ids.steps, e.target.value)}
            style={{ font: "inherit", width: "7ch" }}
          />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          start x: <input value={startX} onChange={(e) => graph.set(ids.startX, e.target.value)} style={{ font: "inherit", width: "7ch" }} />
        </label>
        <label>
          start y: <input value={startY} onChange={(e) => graph.set(ids.startY, e.target.value)} style={{ font: "inherit", width: "7ch" }} />
        </label>
        <label style={{ color: OPTIMIZER_COLORS.sgd }}>
          <input type="checkbox" checked={showSgd} onChange={(e) => graph.set(ids.showSgd, e.target.checked)} /> SGD
        </label>
        <label style={{ color: OPTIMIZER_COLORS.adam }}>
          <input type="checkbox" checked={showAdam} onChange={(e) => graph.set(ids.showAdam, e.target.checked)} /> Adam
        </label>
        <label style={{ color: OPTIMIZER_COLORS.rmsprop }}>
          <input type="checkbox" checked={showRmsprop} onChange={(e) => graph.set(ids.showRmsprop, e.target.checked)} /> RMSprop
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          <input type="checkbox" checked={useSchedule} onChange={(e) => graph.set(ids.useSchedule, e.target.checked)} /> StepLR
          schedule
        </label>
        {useSchedule && (
          <>
            <label>
              step size:{" "}
              <input
                type="number"
                min={1}
                value={stepSize}
                onChange={(e) => graph.set(ids.stepSize, e.target.value)}
                style={{ font: "inherit", width: "6ch" }}
              />
            </label>
            <label>
              gamma: <input value={gamma} onChange={(e) => graph.set(ids.gamma, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
            </label>
          </>
        )}
      </div>
      {!contoursResult.ok && <p style={{ color: "var(--danger)" }}>{contoursResult.message}</p>}
      {!descentResults.ok && <p style={{ color: "var(--danger)" }}>{descentResults.message}</p>}
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        onClick={handleCanvasClick}
        style={{ border: "1px solid var(--border)", maxWidth: "100%", cursor: "crosshair" }}
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="gradient-descent" />
      </div>
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
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>Click the plot to move the start point.</p>
      {descentResults.ok && (
        <ul style={{ margin: "0.25rem 0" }}>
          {descentResults.value.map((run) => {
            const last = run.result.path[run.result.path.length - 1];
            if (!last) return null;
            return (
              <li key={run.optimizer} style={{ color: OPTIMIZER_COLORS[run.optimizer] }}>
                {OPTIMIZER_LABELS[run.optimizer]}: ({last.x.toFixed(4)}, {last.y.toFixed(4)}), f = {last.f.toExponential(3)} after{" "}
                {run.result.path.length - 1} step{run.result.path.length === 2 ? "" : "s"}
                {run.result.stoppedEarly ? " -- diverged (stopped early)" : ""}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
