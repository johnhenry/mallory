import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsGradientDescent, type CellIdsGradientDescent } from "../lib/cell-ids.ts";
import { computeContourLevels, type ContourLevel } from "../lib/contour-plot.ts";
import {
  DEFAULT_GRADIENT_DESCENT_STATE,
  decodeGradientDescentState,
  encodeGradientDescentState,
  type GradientDescentState,
} from "../lib/gradient-descent-state.ts";
import { runGradientDescent, type DescentResult, type OptimizerType } from "../lib/gradient-descent.ts";
import { drawImplicitCurve, drawPoint, drawPolyline } from "../lib/render-path.ts";
import { canvasEventPoint, toDataX, toDataY, type Viewport } from "../lib/viewport.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

interface OptimizerRun {
  optimizer: OptimizerType;
  result: DescentResult;
}

const WIDTH = 520;
const HEIGHT = 520;
const VIEWPORT: Viewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
const DOMAIN = { min: -5, max: 5 };

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
  };
}

function useGradientDescentGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsGradientDescent(cellId);
    const decoded = typeof window !== "undefined" ? decodeGradientDescentState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_GRADIENT_DESCENT_STATE);

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
        // Same expression, same start, same lr/steps -- the runs differ ONLY
        // by optimizer, which is what makes the overlay a genuine race.
        const runs = enabled.map((optimizer) => ({ optimizer, result: runGradientDescent(exprText, startX, startY, optimizer, lr, steps) }));
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
 * clearly. The 3D-surface path overlay, per-step transport animation, and
 * StepLR schedules are deferred scope on the issue.
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
  const contoursResult = useCell<Result<ContourLevel[]>>(graph, ids.contoursResult);
  const descentResults = useCell<Result<OptimizerRun[]>>(graph, ids.descentResults);

  const [exprInput, setExprInput] = useState(exprText);
  useEffect(() => {
    setExprInput(exprText);
  }, [exprText]);

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
        drawPolyline(ctx, run.result.path, VIEWPORT, WIDTH, HEIGHT, OPTIMIZER_COLORS[run.optimizer]);
      }
    }
    const sx = Number(startX);
    const sy = Number(startY);
    if (Number.isFinite(sx) && Number.isFinite(sy)) {
      drawPoint(ctx, { x: sx, y: sy }, VIEWPORT, WIDTH, HEIGHT, 6, "#111827");
    }
  }, [contoursResult, descentResults, startX, startY]);

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
      {!contoursResult.ok && <p style={{ color: "var(--danger)" }}>{contoursResult.message}</p>}
      {!descentResults.ok && <p style={{ color: "var(--danger)" }}>{descentResults.message}</p>}
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        onClick={handleCanvasClick}
        style={{ border: "1px solid var(--border)", maxWidth: "100%", cursor: "crosshair" }}
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
