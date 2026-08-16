import type { Path2D } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsOdeSystem, type CellIdsOdeSystem } from "../lib/cell-ids.ts";
import { drawAxes, drawPath, drawPoint, drawVectorField, type Viewport } from "../lib/render-path.ts";
import { toScreenX, toScreenY } from "../lib/viewport.ts";
import {
  odeSystemTrajectoryToPhasePath,
  sampleOdeSystem2D,
  sampleVectorField2D,
  type OdeSystemSpec,
  type VectorFieldPoint,
} from "../lib/sample-ode.ts";
import { classifyFixedPoint, findFixedPoints, FIXED_POINT_LABEL, type ClassifiedFixedPoint } from "../lib/phase-portrait.ts";
import { getThemeColors } from "../lib/theme-colors.ts";
import { DEFAULT_ODE_SYSTEM_STATE, decodeOdeSystemState, encodeOdeSystemState, type OdeSystemState } from "../lib/ode-system-state.ts";
import { saveGraph } from "../lib/saved-graphs.ts";
import { layersToSvgDocument, type SvgLayer } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

type TrajectoryResult = { ok: true; path: Path2D; final: { t: number; x: number; y: number } } | { ok: false; message: string };
type VectorFieldResult = { ok: true; points: VectorFieldPoint[] } | { ok: false; message: string };
type FixedPointsResult = { ok: true; points: ClassifiedFixedPoint[] } | { ok: false; message: string };

const FIXED_POINT_COLOR: Record<ClassifiedFixedPoint["kind"], string> = {
  saddle: "#f59e0b",
  "stable-node": "#2563eb",
  "unstable-node": "#dc2626",
  "stable-spiral": "#0891b2",
  "unstable-spiral": "#c026d3",
  center: "#16a34a",
};

const WIDTH = 500;
const HEIGHT = 500;

/** Writes a state's fields onto `graph`'s free cells -- shared by useOdeSystemGraph's own hydrate-from-hash and a notebook block's post-mount overwrite. */
export function seedOdeSystemState(graph: CellGraph, ids: CellIdsOdeSystem, state: OdeSystemState): void {
  graph.set(ids.exprX, state.exprX);
  graph.set(ids.exprY, state.exprY);
  graph.set(ids.t0, state.t0);
  graph.set(ids.x0, state.x0);
  graph.set(ids.y0, state.y0);
  graph.set(ids.tMin, state.tMin);
  graph.set(ids.tMax, state.tMax);
  graph.set(ids.xMin, state.xMin);
  graph.set(ids.xMax, state.xMax);
  graph.set(ids.yMin, state.yMin);
  graph.set(ids.yMax, state.yMax);
}

/** Builds the full serializable state of an ODE-system panel -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentOdeSystemState(graph: CellGraph, ids: CellIdsOdeSystem): OdeSystemState {
  return {
    v: 1,
    exprX: graph.get<string>(ids.exprX),
    exprY: graph.get<string>(ids.exprY),
    t0: graph.get<string>(ids.t0),
    x0: graph.get<string>(ids.x0),
    y0: graph.get<string>(ids.y0),
    tMin: graph.get<string>(ids.tMin),
    tMax: graph.get<string>(ids.tMax),
    xMin: graph.get<string>(ids.xMin),
    xMax: graph.get<string>(ids.xMax),
    yMin: graph.get<string>(ids.yMin),
    yMax: graph.get<string>(ids.yMax),
  };
}

/**
 * Sets up the ODE-system panel's reactive cells -- two coupled expressions
 * plus an initial condition, a t-domain, and a phase-plane viewport, yet
 * another shape distinct from every other panel's, so (like
 * OdePanel/SystemSolverPanel) it isn't woven into `cellIds`/
 * `useExpressionGraph`. Shares an `externalGraph` when supplied instead of
 * creating a private one, mirroring OdePanel's `useOdeGraph`.
 */
function useOdeSystemGraph(cellId: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const ids = cellIdsOdeSystem(cellId);
    if (!graph.has(ids.exprX)) {
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeOdeSystemState(window.location.hash.slice(1)) : null;
      seedOdeSystemState(graph, ids, decoded ?? DEFAULT_ODE_SYSTEM_STATE);

      const spec = (): OdeSystemSpec => ({
        stateVars: ["x", "y"],
        independentVar: "t",
        derivatives: [graph.get<string>(ids.exprX), graph.get<string>(ids.exprY)],
      });

      graph.define(ids.trajectory, (): TrajectoryResult => {
        try {
          const t0 = Number(graph.get<string>(ids.t0));
          const x0 = Number(graph.get<string>(ids.x0));
          const y0 = Number(graph.get<string>(ids.y0));
          const tMin = Number(graph.get<string>(ids.tMin));
          const tMax = Number(graph.get<string>(ids.tMax));
          if ([t0, x0, y0, tMin, tMax].some(Number.isNaN)) throw new Error("Every field must be a number.");
          if (tMin >= tMax) throw new Error("t-min must be less than t-max.");
          const trajectory = sampleOdeSystem2D(spec(), { t0, state0: [x0, y0] }, { min: tMin, max: tMax });
          const path = odeSystemTrajectoryToPhasePath(trajectory);
          const last = trajectory[trajectory.length - 1];
          return { ok: true, path, final: last ? { t: last.t, x: last.state[0], y: last.state[1] } : { t: t0, x: x0, y: y0 } };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });

      graph.define(ids.vectorField, (): VectorFieldResult => {
        try {
          const xMin = Number(graph.get<string>(ids.xMin));
          const xMax = Number(graph.get<string>(ids.xMax));
          const yMin = Number(graph.get<string>(ids.yMin));
          const yMax = Number(graph.get<string>(ids.yMax));
          const t0 = Number(graph.get<string>(ids.t0));
          if ([xMin, xMax, yMin, yMax].some(Number.isNaN)) throw new Error("Every field must be a number.");
          if (xMin >= xMax || yMin >= yMax) throw new Error("min must be less than max for both x and y.");
          return { ok: true, points: sampleVectorField2D(spec(), { min: xMin, max: xMax }, { min: yMin, max: yMax }, t0) };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });

      graph.define(ids.fixedPoints, (): FixedPointsResult => {
        try {
          const xMin = Number(graph.get<string>(ids.xMin));
          const xMax = Number(graph.get<string>(ids.xMax));
          const yMin = Number(graph.get<string>(ids.yMin));
          const yMax = Number(graph.get<string>(ids.yMax));
          const t0 = Number(graph.get<string>(ids.t0));
          if ([xMin, xMax, yMin, yMax, t0].some(Number.isNaN)) throw new Error("Every field must be a number.");
          if (xMin >= xMax || yMin >= yMax) throw new Error("min must be less than max for both x and y.");
          const raw = findFixedPoints(spec(), { min: xMin, max: xMax }, { min: yMin, max: yMax }, t0);
          const points = raw.map((p) => classifyFixedPoint(spec(), p, t0));
          return { ok: true, points };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    ref.current = graph;
  }
  return ref.current;
}

export interface OdeSystemPanelProps {
  cellId?: string;
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
}

/**
 * v1: a fixed 2-equation/2-variable coupled first-order system
 * dx/dt = f(x,y,t), dy/dt = g(x,y,t) -- the same "fixed at 2" scope cut
 * SystemSolverPanel already made for algebraic systems -- rendered as a
 * phase portrait (one trajectory from a single initial condition, overlaid
 * on a direction field sampled at t0). No animation/dragging, no
 * multi-trajectory overlay.
 */
export function OdeSystemPanel({ cellId = "ode-system-1", graph: externalGraph, syncUrl = true }: OdeSystemPanelProps = {}) {
  const graph = useOdeSystemGraph(cellId, externalGraph);
  // Namespaced by cellId, same collision-avoidance fix as OdePanel's.
  useCellGraphTools(`calculus_ode_system_${cellId}`, graph);
  const ids = cellIdsOdeSystem(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprX = useCell<string>(graph, ids.exprX);
  const exprY = useCell<string>(graph, ids.exprY);
  const t0 = useCell<string>(graph, ids.t0);
  const x0 = useCell<string>(graph, ids.x0);
  const y0 = useCell<string>(graph, ids.y0);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
  const xMin = useCell<string>(graph, ids.xMin);
  const xMax = useCell<string>(graph, ids.xMax);
  const yMin = useCell<string>(graph, ids.yMin);
  const yMax = useCell<string>(graph, ids.yMax);
  const trajectory = useCell<TrajectoryResult>(graph, ids.trajectory);
  const vectorField = useCell<VectorFieldResult>(graph, ids.vectorField);
  const fixedPoints = useCell<FixedPointsResult>(graph, ids.fixedPoints);

  const [exprXInput, setExprXInput] = useState(exprX);
  const [exprYInput, setExprYInput] = useState(exprY);
  // Keeps the input boxes in sync when exprX/exprY change for a reason
  // other than typing in these boxes -- e.g. URL-hash hydration -- mirrors
  // GraphCanvas's identically-reasoned effect.
  useEffect(() => {
    setExprXInput(exprX);
  }, [exprX]);
  useEffect(() => {
    setExprYInput(exprY);
  }, [exprY]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const saveGraphFn = useServerFn(saveGraph);

  async function handleSave() {
    const title = window.prompt("Title for this saved ODE system:", "Untitled");
    if (title === null) return;
    setSaveStatus("Saving…");
    try {
      await saveGraphFn({ data: { title, kind: "ode-system", state: getCurrentOdeSystemState(graph, ids) } });
      setSaveStatus(`Saved as "${title || "Untitled"}" — see the gallery to reopen it.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keep the URL fragment in sync with the live graph state, mirroring OdePanel's pattern.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeOdeSystemState(getCurrentOdeSystemState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  function updateExprX(value: string) {
    setExprXInput(value);
    graph.set(ids.exprX, value);
  }
  function updateExprY(value: string) {
    setExprYInput(value);
    graph.set(ids.exprY, value);
  }

  const viewport: Viewport = {
    xMin: Number(xMin) || 0,
    xMax: Number(xMax) || 3,
    yMin: Number(yMin) || 0,
    yMax: Number(yMax) || 3,
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawAxes(ctx, viewport, WIDTH, HEIGHT);
    if (vectorField.ok) drawVectorField(ctx, vectorField.points, viewport, WIDTH, HEIGHT);
    if (trajectory.ok) {
      drawPath(ctx, trajectory.path, viewport, WIDTH, HEIGHT);
      drawPoint(ctx, { x: Number(x0), y: Number(y0) }, viewport, WIDTH, HEIGHT, 5, "#dc2626");
    }
    if (fixedPoints.ok) {
      ctx.save();
      ctx.font = "11px sans-serif";
      const theme = getThemeColors();
      for (const fp of fixedPoints.points) {
        const sx = toScreenX(fp.x, viewport, WIDTH);
        const sy = toScreenY(fp.y, viewport, HEIGHT);
        ctx.fillStyle = FIXED_POINT_COLOR[fp.kind];
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = theme.ink;
        ctx.fillText(FIXED_POINT_LABEL[fp.kind], sx + 9, sy - 9);
      }
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trajectory, vectorField, fixedPoints, xMin, xMax, yMin, yMax, x0, y0]);

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          dx/dt ={" "}
          <input value={exprXInput} onChange={(e) => updateExprX(e.target.value)} style={{ font: "inherit", width: "16ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          dy/dt ={" "}
          <input value={exprYInput} onChange={(e) => updateExprY(e.target.value)} style={{ font: "inherit", width: "16ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          at t ={" "}
          <input value={t0} onChange={(e) => graph.set(ids.t0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />: x ={" "}
          <input value={x0} onChange={(e) => graph.set(ids.x0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />, y ={" "}
          <input value={y0} onChange={(e) => graph.set(ids.y0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          t: [<input value={tMin} onChange={(e) => graph.set(ids.tMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={tMax} onChange={(e) => graph.set(ids.tMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <label>
          x: [<input value={xMin} onChange={(e) => graph.set(ids.xMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={xMax} onChange={(e) => graph.set(ids.xMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
        <label>
          y: [<input value={yMin} onChange={(e) => graph.set(ids.yMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={yMax} onChange={(e) => graph.set(ids.yMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="ode-system" />
        <SvgExportButton
          getSvg={() => {
            const layers: SvgLayer[] = [];
            if (vectorField.ok) layers.push({ kind: "vectorfield", points: vectorField.points });
            if (trajectory.ok) {
              layers.push({ kind: "path", path: trajectory.path });
              layers.push({ kind: "scatter", points: [{ x: Number(x0), y: Number(y0) }], color: "#dc2626", radius: 5 });
            }
            return layers.length > 0 ? layersToSvgDocument(layers, viewport, WIDTH, HEIGHT) : null;
          }}
          label="ode-system"
        />
      </div>
      {trajectory.ok && (
        <p>
          at t = {trajectory.final.t.toFixed(4)}: x = {trajectory.final.x.toFixed(4)}, y = {trajectory.final.y.toFixed(4)}
        </p>
      )}
      {fixedPoints.ok && fixedPoints.points.length > 0 && (
        <div style={{ margin: "0.5rem 0" }}>
          <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>Fixed points:</p>
          <ul style={{ margin: 0 }}>
            {fixedPoints.points.map((fp, i) => (
              <li key={i}>
                ({fp.x.toFixed(4)}, {fp.y.toFixed(4)}) — {FIXED_POINT_LABEL[fp.kind]} (λ = {fp.eigenvalues[0].toString()}, {fp.eigenvalues[1].toString()})
              </li>
            ))}
          </ul>
        </div>
      )}
      {(!trajectory.ok || !vectorField.ok) && (
        <p style={{ color: "var(--danger)" }}>{!trajectory.ok ? trajectory.message : !vectorField.ok ? vectorField.message : ""}</p>
      )}
      {syncUrl && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={handleSave}>
            Save to gallery
          </button>
          {saveStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{saveStatus}</p>}
        </div>
      )}
    </div>
  );
}
