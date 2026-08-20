import type { Path2D } from "mallory-math";
import { addLocalSave } from "../lib/local-saves.ts";
import { useEffect, useRef, useState } from "react";
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
import {
  DEFAULT_ODE_SYSTEM_STATE,
  decodeOdeSystemState,
  encodeOdeSystemState,
  type OdeSystemRowState,
  type OdeSystemState,
} from "../lib/ode-system-state.ts";
import { layersToSvgDocument, type SvgLayer } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
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

/**
 * Seeds one row's own cells (unlimited overlaid systems): its own
 * exprX/exprY/t0/x0/y0/tMin/tMax, color and visibility, plus its own
 * derived trajectory/vector-field/fixed-points. Reads the shared
 * container's x/y phase-plane domain live inside each `define`, so panning
 * the one shared domain recomputes every row -- same shape as OdePanel's
 * `seedOdeRow`.
 */
export function seedOdeSystemRow(graph: CellGraph, containerIds: CellIdsOdeSystem, rowId: string, row: OdeSystemRowState): void {
  const ids = cellIdsOdeSystem(rowId);
  graph.set(ids.exprX, row.exprX);
  graph.set(ids.exprY, row.exprY);
  graph.set(ids.t0, row.t0);
  graph.set(ids.x0, row.x0);
  graph.set(ids.y0, row.y0);
  graph.set(ids.tMin, row.tMin);
  graph.set(ids.tMax, row.tMax);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

  const spec = (): OdeSystemSpec => ({
    stateVars: ["x", "y"],
    independentVar: "t",
    derivatives: [graph.get<string>(ids.exprX), graph.get<string>(ids.exprY)],
  });

  const domain = () => ({
    xMin: Number(graph.get<string>(containerIds.xMin)),
    xMax: Number(graph.get<string>(containerIds.xMax)),
    yMin: Number(graph.get<string>(containerIds.yMin)),
    yMax: Number(graph.get<string>(containerIds.yMax)),
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
      const { xMin, xMax, yMin, yMax } = domain();
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
      const { xMin, xMax, yMin, yMax } = domain();
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

function seedOdeSystemRowDefault(graph: CellGraph, containerIds: CellIdsOdeSystem, rowId: string, index: number): void {
  seedOdeSystemRow(graph, containerIds, rowId, { ...(DEFAULT_ODE_SYSTEM_STATE.rows[0] as OdeSystemRowState), color: paletteColor(index) });
}

/**
 * Full re-seed of the container: clears any existing rows (deleting their
 * cells) and sets the shared phase-plane domain, then seeds fresh rows from
 * `state.rows` -- same "delete then replay" shape OdePanel's own
 * `seedOdeState` uses, needed because a notebook block's seeding effect
 * runs AFTER `useOdeSystemGraph` has already constructed one default row.
 */
export function seedOdeSystemState(graph: CellGraph, containerIds: CellIdsOdeSystem, state: OdeSystemState): void {
  const existing = graph.has(containerIds.list) ? graph.get<string[]>(containerIds.list) : [];
  for (const rowId of existing) removeRow(graph, containerIds.list, rowId, cellIdsOdeSystem(rowId));
  graph.set(containerIds.xMin, state.xMin);
  graph.set(containerIds.xMax, state.xMax);
  graph.set(containerIds.yMin, state.yMin);
  graph.set(containerIds.yMax, state.yMax);
  const rowIds = state.rows.map(() => crypto.randomUUID());
  graph.set(containerIds.list, rowIds, { auxiliary: true });
  rowIds.forEach((id, i) => seedOdeSystemRow(graph, containerIds, id, state.rows[i] as OdeSystemRowState));
}

/** Builds the full serializable state of an ODE-system panel -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentOdeSystemState(graph: CellGraph, containerIds: CellIdsOdeSystem): OdeSystemState {
  return {
    v: 2,
    xMin: graph.get<string>(containerIds.xMin),
    xMax: graph.get<string>(containerIds.xMax),
    yMin: graph.get<string>(containerIds.yMin),
    yMax: graph.get<string>(containerIds.yMax),
    rows: graph.get<string[]>(containerIds.list).map((rowId) => {
      const ids = cellIdsOdeSystem(rowId);
      return {
        exprX: graph.get<string>(ids.exprX),
        exprY: graph.get<string>(ids.exprY),
        t0: graph.get<string>(ids.t0),
        x0: graph.get<string>(ids.x0),
        y0: graph.get<string>(ids.y0),
        tMin: graph.get<string>(ids.tMin),
        tMax: graph.get<string>(ids.tMax),
        color: graph.get<number>(ids.color),
        visible: graph.get<boolean>(ids.visible),
      };
    }),
  };
}

/**
 * The first row (unlimited overlaid systems, mirroring OdePanel's own
 * `getPrimaryRow`): a vector field is one direction field per f(x,y)/g(x,y)
 * pair -- overlaying N of them (one per row's own equations) would be
 * unreadable arrow-on-arrow noise, and fixed-point classification is
 * likewise a property of one specific system, not a thing to merge across
 * rows. Scoping both to the first row is the same "primary row" convention
 * OdePanel's own slope field/video export use -- every row still gets its
 * own plotted trajectory, just not its own background vector field/fixed
 * points.
 */
function getPrimaryRow(graph: CellGraph, containerIds: CellIdsOdeSystem): { rowId: string; ids: CellIdsOdeSystem } | null {
  const rowId = graph.get<string[]>(containerIds.list)[0];
  return rowId === undefined ? null : { rowId, ids: cellIdsOdeSystem(rowId) };
}

/**
 * Sets up the ODE-system panel's reactive cells -- an ordered list of
 * coupled-system rows sharing one phase-plane domain, yet another shape
 * distinct from every other panel's, so (like OdePanel/SystemSolverPanel)
 * it isn't woven into `cellIds`/`useExpressionGraph`. Shares an
 * `externalGraph` when supplied instead of creating a private one,
 * mirroring OdePanel's `useOdeGraph`.
 */
function useOdeSystemGraph(cellId: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const containerIds = cellIdsOdeSystem(cellId);
    if (!graph.has(containerIds.list)) {
      graph.set(containerIds.list, [] as string[], { auxiliary: true });
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeOdeSystemState(window.location.hash.slice(1)) : null;
      seedOdeSystemState(graph, containerIds, decoded ?? DEFAULT_ODE_SYSTEM_STATE);
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
 * Pure re-render of the vector-field + trajectories + classified
 * fixed-point markers canvas, extracted from the draw effect below so
 * `PngExportButton`'s `renderAtScale` (issue #278) can call it against a
 * fresh offscreen canvas at any size. Unlike v1, this reads live off
 * `graph` (not passed-in primitives) since it now has to iterate an
 * arbitrary row list, the same shape `drawOdePanel` uses.
 */
export function drawOdeSystemPanel(ctx: CanvasRenderingContext2D, width: number, height: number, graph: CellGraph, containerIds: CellIdsOdeSystem): void {
  ctx.clearRect(0, 0, width, height);
  const viewport: Viewport = {
    xMin: Number(graph.get<string>(containerIds.xMin)) || 0,
    xMax: Number(graph.get<string>(containerIds.xMax)) || 3,
    yMin: Number(graph.get<string>(containerIds.yMin)) || 0,
    yMax: Number(graph.get<string>(containerIds.yMax)) || 3,
  };
  drawAxes(ctx, viewport, width, height);

  const primary = getPrimaryRow(graph, containerIds);
  if (primary) {
    try {
      const vectorField = graph.get<VectorFieldResult>(primary.ids.vectorField);
      if (vectorField.ok) drawVectorField(ctx, vectorField.points, viewport, width, height);
    } catch {
      // Not registered yet -- skip this frame.
    }
  }

  for (const rowId of graph.get<string[]>(containerIds.list)) {
    const ids = cellIdsOdeSystem(rowId);
    try {
      if (!graph.get<boolean>(ids.visible)) continue;
      const trajectory = graph.get<TrajectoryResult>(ids.trajectory);
      if (!trajectory.ok) continue;
      const color = graph.get<number>(ids.color);
      drawPath(ctx, { ...trajectory.path, stroke: { ...trajectory.path.stroke, color } }, viewport, width, height);
      const x0 = Number(graph.get<string>(ids.x0));
      const y0 = Number(graph.get<string>(ids.y0));
      drawPoint(ctx, { x: x0, y: y0 }, viewport, width, height, 5, `#${color.toString(16).padStart(6, "0")}`);
    } catch {
      // A row whose cells haven't registered yet -- skip it this frame.
    }
  }

  if (primary) {
    try {
      const fixedPoints = graph.get<FixedPointsResult>(primary.ids.fixedPoints);
      if (fixedPoints.ok) {
        ctx.save();
        ctx.font = "11px sans-serif";
        const theme = getThemeColors();
        for (const fp of fixedPoints.points) {
          const sx = toScreenX(fp.x, viewport, width);
          const sy = toScreenY(fp.y, viewport, height);
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
    } catch {
      // Not registered yet -- skip this frame.
    }
  }
}

/** One coupled-system row's controls: dx/dt, dy/dt, initial condition, t domain, color/visibility, and its own trajectory readout. */
function OdeSystemRow({
  graph,
  rowId,
  onRemove,
}: {
  graph: CellGraph;
  rowId: string;
  onRemove?: () => void;
}) {
  const ids = cellIdsOdeSystem(rowId);
  const exprX = useCell<string>(graph, ids.exprX);
  const exprY = useCell<string>(graph, ids.exprY);
  const t0 = useCell<string>(graph, ids.t0);
  const x0 = useCell<string>(graph, ids.x0);
  const y0 = useCell<string>(graph, ids.y0);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const trajectory = useCell<TrajectoryResult>(graph, ids.trajectory);

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this trajectory" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          dx/dt = <input value={exprX} onChange={(e) => graph.set(ids.exprX, e.target.value)} style={{ font: "inherit", width: "16ch" }} />
        </label>
        <label>
          dy/dt = <input value={exprY} onChange={(e) => graph.set(ids.exprY, e.target.value)} style={{ font: "inherit", width: "16ch" }} />
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this system">
            ✕
          </button>
        )}
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          at t = <input value={t0} onChange={(e) => graph.set(ids.t0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />: x ={" "}
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
      {trajectory.ok ? (
        <p style={{ margin: "0.25rem 0", fontSize: "0.85rem" }}>
          at t = {trajectory.final.t.toFixed(4)}: x = {trajectory.final.x.toFixed(4)}, y = {trajectory.final.y.toFixed(4)}
        </p>
      ) : (
        <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{trajectory.message}</p>
      )}
    </div>
  );
}

/**
 * Unlimited overlaid coupled first-order systems dx/dt = f(x,y),
 * dy/dt = g(x,y) (porting v1's single system), plotted on one shared,
 * pannable x/y phase-plane domain -- every system now gets its own
 * color/visibility and its own trajectory, the same "shared domain,
 * unlimited rows" shape OdePanel already established for its sibling
 * first-order-IVP panel. The background vector field and fixed-point
 * classification stay scoped to the first row -- see `getPrimaryRow`'s own
 * doc comment for why.
 */
export function OdeSystemPanel({ cellId = "ode-system-1", graph: externalGraph, syncUrl = true }: OdeSystemPanelProps = {}) {
  const graph = useOdeSystemGraph(cellId, externalGraph);
  // Namespaced by cellId, same collision-avoidance fix as OdePanel's.
  useCellGraphTools(`calculus_ode_system_${cellId}`, graph);
  const containerIds = cellIdsOdeSystem(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rowIds = useCell<string[]>(graph, containerIds.list);

  const xMin = useCell<string>(graph, containerIds.xMin);
  const xMax = useCell<string>(graph, containerIds.xMax);
  const yMin = useCell<string>(graph, containerIds.yMin);
  const yMax = useCell<string>(graph, containerIds.yMax);

  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  function addSystem() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedOdeSystemRowDefault(graph, containerIds, id, index);
  }

  function removeSystem(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsOdeSystem(rowId));
  }

  async function handleSave() {
    const title = window.prompt("Title for this saved ODE system:", "Untitled");
    if (title === null) return;
    try {
      addLocalSave({ title, kind: "ode-system", state: getCurrentOdeSystemState(graph, containerIds) });
      setSaveStatus(`Saved as "${title || "Untitled"}" to My saves on this device — reopen or publish it from the gallery.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keep the URL fragment in sync with the live graph state, mirroring OdePanel's pattern.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeOdeSystemState(getCurrentOdeSystemState(graph, containerIds))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  const viewport: Viewport = {
    xMin: Number(xMin) || 0,
    xMax: Number(xMax) || 3,
    yMin: Number(yMin) || 0,
    yMax: Number(yMax) || 3,
  };

  // Redraws whenever the row list changes, the shared domain changes, or
  // any individual row's own cells do -- graph.subscribeAll rather than
  // per-row useCell hooks, same reasoning as OdePanel's identical redraw.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const redraw = () => drawOdeSystemPanel(ctx, WIDTH, HEIGHT, graph, containerIds);
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds]);

  const primary = getPrimaryRow(graph, containerIds);
  const primaryVectorField = primary ? graph.get<VectorFieldResult>(primary.ids.vectorField) : { ok: true as const, points: [] };
  const primaryFixedPoints = primary ? graph.get<FixedPointsResult>(primary.ids.fixedPoints) : { ok: true as const, points: [] };

  return (
    <div>
      {rowIds.map((rowId) => (
        <OdeSystemRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeSystem(rowId) : undefined} />
      ))}
      <button type="button" onClick={addSystem} style={{ margin: "0.35rem 0" }}>
        + Add system
      </button>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="ode-system"
          renderAtScale={(ctx, width, height) => drawOdeSystemPanel(ctx, width, height, graph, containerIds)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <SvgExportButton
          getSvg={() => {
            const layers: SvgLayer[] = [];
            if (primaryVectorField.ok) layers.push({ kind: "vectorfield", points: primaryVectorField.points });
            for (const rowId of rowIds) {
              const ids = cellIdsOdeSystem(rowId);
              if (!graph.hasValue(ids.trajectory) || !graph.get<boolean>(ids.visible)) continue;
              const trajectory = graph.get<TrajectoryResult>(ids.trajectory);
              if (!trajectory.ok) continue;
              const color = graph.get<number>(ids.color);
              layers.push({ kind: "path", path: { ...trajectory.path, stroke: { ...trajectory.path.stroke, color } } });
              layers.push({
                kind: "scatter",
                points: [{ x: Number(graph.get<string>(ids.x0)), y: Number(graph.get<string>(ids.y0)) }],
                color: `#${color.toString(16).padStart(6, "0")}`,
                radius: 5,
              });
            }
            if (primaryFixedPoints.ok) {
              layers.push({
                kind: "labeled-markers",
                points: primaryFixedPoints.points.map((fp) => ({ x: fp.x, y: fp.y, color: FIXED_POINT_COLOR[fp.kind], label: FIXED_POINT_LABEL[fp.kind] })),
              });
            }
            return layers.length > 0 ? layersToSvgDocument(layers, viewport, WIDTH, HEIGHT) : null;
          }}
          label="ode-system"
        />
      </div>
      {primaryFixedPoints.ok && primaryFixedPoints.points.length > 0 && (
        <div style={{ margin: "0.5rem 0" }}>
          <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>Fixed points:</p>
          <ul style={{ margin: 0 }}>
            {primaryFixedPoints.points.map((fp, i) => (
              <li key={i}>
                ({fp.x.toFixed(4)}, {fp.y.toFixed(4)}) — {FIXED_POINT_LABEL[fp.kind]} (λ = {fp.eigenvalues[0].toString()}, {fp.eigenvalues[1].toString()})
              </li>
            ))}
          </ul>
        </div>
      )}
      {rowIds.length > 1 && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0" }}>
          Vector field and fixed-point classification above reflect only the first system's equations.
        </p>
      )}
      {!primaryVectorField.ok && <p style={{ color: "var(--danger)" }}>{primaryVectorField.message}</p>}
      {syncUrl && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={handleSave}>
            Save
          </button>
          {saveStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{saveStatus}</p>}
        </div>
      )}
    </div>
  );
}
