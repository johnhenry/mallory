import { useEffect, useRef } from "react";
import { CellGraph } from "@johnhenry/math";
import { cellIdsImplicit } from "../lib/cell-ids.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { drawAxes, drawImplicitBoxes, drawImplicitCurve, drawVectorField, hexToRgba, type Viewport } from "../lib/render-path.ts";
import { sampleImplicitCurve, type ImplicitSegment } from "../lib/sample-implicit.ts";
import { sampleImplicitCurveIntervalBoxes, type ImplicitBox } from "../lib/interval-implicit.ts";
import { computeContourLevels, type ContourLevel } from "../lib/contour-plot.ts";
import { sampleGradientField } from "../lib/gradient-field.ts";
import { equationToImplicitZero } from "../lib/equation-to-zero.ts";
import type { VectorFieldPoint } from "../lib/sample-ode.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";

const WIDTH = 500;
const HEIGHT = 500;
const RESOLUTION = 80;
const CONTOUR_LEVEL_COUNT = 6;
const GRADIENT_GRID_DENSITY = 12;
const INTERVAL_MAX_DEPTH = 9;

type SegmentsResult = { ok: true; segments: ImplicitSegment[] } | { ok: false; message: string };
type ContourResult = { ok: true; levels: ContourLevel[] } | { ok: false; message: string };
type GradientResult = { ok: true; points: VectorFieldPoint[] } | { ok: false; message: string };
type IntervalBoxesResult = { ok: true; boxes: ImplicitBox[] } | { ok: false; message: string };

/**
 * A plain `Number(x) || fallback` silently discards a legitimate "0" bound
 * (a very natural domain edge, e.g. plotting y=tan(x) from 0 to pi) -- 0 is
 * falsy in JS, so it fell through to the default instead of being used.
 * Found while verifying the interval-subdivision overlay (below) against a
 * pathological case whose natural domain starts at x=0.
 */
export function boundOrDefault(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** A blue->red interpolation across level index, so a stack of contour lines reads as a low-to-high ramp. */
function levelColor(index: number, count: number): string {
  const t = count > 1 ? index / (count - 1) : 0;
  const r = Math.round(37 + t * (220 - 37));
  const g = Math.round(99 + t * (38 - 99));
  const b = Math.round(235 + t * (38 - 235));
  return `rgb(${r}, ${g}, ${b})`;
}

const DEFAULTS = { expr: "x^2+y^2=4", xMin: "-5", xMax: "5", yMin: "-5", yMax: "5" };

/**
 * Seeds one relation row's own cells (issue #251, unlimited expressions):
 * the relation source plus its own overlay toggles/results -- contour/
 * gradient/interval-boxes are derived from THIS row's own field, so unlike
 * the domain bounds (shared, on the container id) they're per-row, not
 * shared. Each `define` reads the shared container's `xMin`/`xMax`/`yMin`/
 * `yMax` live, so panning/resizing the one shared domain recomputes every
 * row's overlays, not just the row that's currently focused.
 */
export function seedImplicitRow(graph: CellGraph, containerIds: ReturnType<typeof cellIdsImplicit>, rowId: string, index: number, source: string): void {
  const ids = cellIdsImplicit(rowId);
  graph.set(ids.expr, source);
  graph.set(ids.color, paletteColor(index));
  graph.set(ids.visible, true);
  graph.set(ids.showContours, false, { auxiliary: true });
  graph.set(ids.showGradient, false, { auxiliary: true });
  graph.set(ids.showIntervalBoxes, false, { auxiliary: true });

  graph.define(ids.segments, (): SegmentsResult => {
    try {
      const expr = graph.get<string>(ids.expr);
      const xMin = Number(graph.get<string>(containerIds.xMin));
      const xMax = Number(graph.get<string>(containerIds.xMax));
      const yMin = Number(graph.get<string>(containerIds.yMin));
      const yMax = Number(graph.get<string>(containerIds.yMax));
      if ([xMin, xMax, yMin, yMax].some(Number.isNaN)) throw new Error("Every domain field must be a number.");
      if (xMin >= xMax || yMin >= yMax) throw new Error("min must be less than max for both x and y.");
      return { ok: true, segments: sampleImplicitCurve(expr, { min: xMin, max: xMax }, { min: yMin, max: yMax }, RESOLUTION) };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  graph.define(
    ids.contourResult,
    (): ContourResult => {
      if (!graph.get<boolean>(ids.showContours)) return { ok: true, levels: [] };
      try {
        const field = equationToImplicitZero(graph.get<string>(ids.expr));
        const xMin = Number(graph.get<string>(containerIds.xMin));
        const xMax = Number(graph.get<string>(containerIds.xMax));
        const yMin = Number(graph.get<string>(containerIds.yMin));
        const yMax = Number(graph.get<string>(containerIds.yMax));
        if ([xMin, xMax, yMin, yMax].some(Number.isNaN)) throw new Error("Every domain field must be a number.");
        return {
          ok: true,
          levels: computeContourLevels(field, { min: xMin, max: xMax }, { min: yMin, max: yMax }, RESOLUTION, CONTOUR_LEVEL_COUNT),
        };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
    { auxiliary: true },
  );

  graph.define(
    ids.gradientResult,
    (): GradientResult => {
      if (!graph.get<boolean>(ids.showGradient)) return { ok: true, points: [] };
      try {
        const field = equationToImplicitZero(graph.get<string>(ids.expr));
        const xMin = Number(graph.get<string>(containerIds.xMin));
        const xMax = Number(graph.get<string>(containerIds.xMax));
        const yMin = Number(graph.get<string>(containerIds.yMin));
        const yMax = Number(graph.get<string>(containerIds.yMax));
        if ([xMin, xMax, yMin, yMax].some(Number.isNaN)) throw new Error("Every domain field must be a number.");
        return {
          ok: true,
          points: sampleGradientField(field, { min: xMin, max: xMax }, { min: yMin, max: yMax }, GRADIENT_GRID_DENSITY),
        };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
    { auxiliary: true },
  );

  graph.define(
    ids.intervalBoxesResult,
    (): IntervalBoxesResult => {
      if (!graph.get<boolean>(ids.showIntervalBoxes)) return { ok: true, boxes: [] };
      try {
        const expr = graph.get<string>(ids.expr);
        const xMin = Number(graph.get<string>(containerIds.xMin));
        const xMax = Number(graph.get<string>(containerIds.xMax));
        const yMin = Number(graph.get<string>(containerIds.yMin));
        const yMax = Number(graph.get<string>(containerIds.yMax));
        if ([xMin, xMax, yMin, yMax].some(Number.isNaN)) throw new Error("Every domain field must be a number.");
        return {
          ok: true,
          boxes: sampleImplicitCurveIntervalBoxes(expr, { min: xMin, max: xMax }, { min: yMin, max: yMax }, { maxDepth: INTERVAL_MAX_DEPTH }),
        };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
    { auxiliary: true },
  );
}

/**
 * Sets up the implicit-curve panel's reactive cells on its own private
 * CellGraph -- one shared rectangular domain (the container id's own
 * `xMin`/`xMax`/`yMin`/`yMax`/`list` cells) plus an ordered list of
 * relation rows (issue #251), each a two-variable relation with its own
 * color/visibility/overlay toggles (see `seedImplicitRow`). A different
 * input shape from GraphCanvasMulti's single-axis-variable rows, so (like
 * SystemSolverPanel/StatisticsPanel/OdePanel) it isn't woven into
 * `cellIds`/`useExpressionGraph` -- it follows the same "shared viewport,
 * ordered row list" shape GraphCanvasMulti itself established, just with a
 * panel-specific row shape.
 */
/**
 * Pure re-render of the shared implicit-relations canvas, extracted from
 * the redraw effect below so `PngExportButton`'s `renderAtScale` (issue
 * #278) can call it against a fresh offscreen canvas at any size -- reads
 * straight from `graph`/`containerIds` rather than closed-over React
 * state, so no other params are needed.
 */
export function drawImplicitPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  graph: CellGraph,
  containerIds: { list: string; xMin: string; xMax: string; yMin: string; yMax: string },
): void {
  ctx.clearRect(0, 0, width, height);
  const viewport: Viewport = {
    xMin: boundOrDefault(graph.get<string>(containerIds.xMin), -5),
    xMax: boundOrDefault(graph.get<string>(containerIds.xMax), 5),
    yMin: boundOrDefault(graph.get<string>(containerIds.yMin), -5),
    yMax: boundOrDefault(graph.get<string>(containerIds.yMax), 5),
  };
  drawAxes(ctx, viewport, width, height);
  for (const rowId of graph.get<string[]>(containerIds.list)) {
    const ids = cellIdsImplicit(rowId);
    try {
      const visible = graph.get<boolean>(ids.visible);
      if (!visible) continue;
      const color = graph.get<number>(ids.color);
      const colorHex = `#${color.toString(16).padStart(6, "0")}`;
      if (graph.get<boolean>(ids.showIntervalBoxes)) {
        const intervalBoxesResult = graph.get<IntervalBoxesResult>(ids.intervalBoxesResult);
        if (intervalBoxesResult.ok) drawImplicitBoxes(ctx, intervalBoxesResult.boxes, viewport, width, height, hexToRgba(color, 0.5));
      }
      const segments = graph.get<SegmentsResult>(ids.segments);
      if (segments.ok) drawImplicitCurve(ctx, segments.segments, viewport, width, height, colorHex);
      if (graph.get<boolean>(ids.showContours)) {
        const contourResult = graph.get<ContourResult>(ids.contourResult);
        if (contourResult.ok) {
          contourResult.levels.forEach((level, i) => {
            drawImplicitCurve(ctx, level.segments, viewport, width, height, levelColor(i, contourResult.levels.length));
          });
        }
      }
      if (graph.get<boolean>(ids.showGradient)) {
        const gradientResult = graph.get<GradientResult>(ids.gradientResult);
        if (gradientResult.ok) drawVectorField(ctx, gradientResult.points, viewport, width, height);
      }
    } catch {
      // A row whose cells haven't registered yet -- skip it this frame.
    }
  }
}

function useImplicitGraph(containerId: string): { graph: CellGraph; containerIds: ReturnType<typeof cellIdsImplicit> } {
  // `containerIds` is memoized on the ref itself, not recomputed every
  // render -- `cellIdsImplicit(containerId)` returns a structurally-equal
  // but referentially-NEW object each call, which would otherwise defeat
  // the redraw effect's own `[graph, containerIds]` dependency check below
  // (the same class of stale-reference bug issue #236 originally fixed for
  // TaylorPanel's `committedViewport`; see that file's own doc comment for
  // the full writeup and how it was caught).
  const ref = useRef<{ graph: CellGraph; containerIds: ReturnType<typeof cellIdsImplicit> } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsImplicit(containerId);
    const graph = new CellGraph();
    if (!graph.hasValue(containerIds.list)) {
      graph.set(containerIds.xMin, DEFAULTS.xMin);
      graph.set(containerIds.xMax, DEFAULTS.xMax);
      graph.set(containerIds.yMin, DEFAULTS.yMin);
      graph.set(containerIds.yMax, DEFAULTS.yMax);
      const rowId = crypto.randomUUID();
      seedImplicitRow(graph, containerIds, rowId, 0, DEFAULTS.expr);
      graph.set(containerIds.list, [rowId], { auxiliary: true });
    }
    ref.current = { graph, containerIds };
  }
  return ref.current;
}

/** One relation row's controls (issue #251): expr input, color/visibility, and its own contour/gradient/robust-mode overlay toggles + error messages -- the canvas draw itself lives in `ImplicitPanel`, which loops over every row. */
function ImplicitRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsImplicit(rowId);
  const exprValue = useCell<string>(graph, ids.expr);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const segments = useCell<SegmentsResult>(graph, ids.segments);
  const showContours = useCell<boolean>(graph, ids.showContours);
  const contourResult = useCell<ContourResult>(graph, ids.contourResult);
  const showGradient = useCell<boolean>(graph, ids.showGradient);
  const gradientResult = useCell<GradientResult>(graph, ids.gradientResult);
  const showIntervalBoxes = useCell<boolean>(graph, ids.showIntervalBoxes);
  const intervalBoxesResult = useCell<IntervalBoxesResult>(graph, ids.intervalBoxesResult);

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this relation" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          relation:{" "}
          <input
            value={exprValue}
            onChange={(e) => graph.set(ids.expr, e.target.value)}
            style={{ font: "inherit", width: "22ch" }}
          />
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this relation">
            ✕
          </button>
        )}
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <label>
          <input type="checkbox" checked={showContours} onChange={(e) => graph.set(ids.showContours, e.target.checked)} /> contour
          plot (levels of the relation's field)
        </label>
        <label>
          <input type="checkbox" checked={showGradient} onChange={(e) => graph.set(ids.showGradient, e.target.checked)} /> gradient
          field
        </label>
        <label>
          <input
            type="checkbox"
            checked={showIntervalBoxes}
            onChange={(e) => graph.set(ids.showIntervalBoxes, e.target.checked)}
          />{" "}
          robust mode (interval subdivision)
        </label>
      </div>
      {!segments.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{segments.message}</p>}
      {showContours && !contourResult.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{contourResult.message}</p>}
      {showGradient && !gradientResult.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{gradientResult.message}</p>}
      {showIntervalBoxes && !intervalBoxesResult.ok && (
        <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{intervalBoxesResult.message}</p>
      )}
    </div>
  );
}

export interface ImplicitPanelProps {
  cellId?: string;
}

/**
 * Unlimited two-variable relations (issue #251), each traced via marching
 * squares over one shared (non-pannable) domain -- v1 was a single relation
 * only; every relation now gets its own color/visibility and contour/
 * gradient/robust-mode overlays, overlaid on one shared canvas the same way
 * GraphCanvasMulti overlays unlimited y=f(x) curves on one shared viewport.
 */
export function ImplicitPanel({ cellId = "implicit-1" }: ImplicitPanelProps = {}) {
  const { graph, containerIds } = useImplicitGraph(cellId);
  useCellGraphTools("graphing_implicit", graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const xMin = useCell<string>(graph, containerIds.xMin);
  const xMax = useCell<string>(graph, containerIds.xMax);
  const yMin = useCell<string>(graph, containerIds.yMin);
  const yMax = useCell<string>(graph, containerIds.yMax);

  function addRelation() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedImplicitRow(graph, containerIds, id, index, DEFAULTS.expr);
  }

  function removeRelation(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsImplicit(rowId));
  }

  // Redraws whenever the row list changes, or any individual row's own
  // cells (or the shared domain) do -- graph.subscribeAll rather than
  // per-row useCell hooks, same reasoning as GraphCanvasMulti's own redraw
  // effect: the *set* of rows to draw changes as much as any one row's
  // segments/color/visibility does, and a fixed hook-per-row list can't
  // track a dynamic row count anyway (React's rules of hooks require a
  // static hook list).
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const redraw = () => drawImplicitPanel(ctx, WIDTH, HEIGHT, graph, containerIds);
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds]);

  return (
    <div>
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
      {rowIds.map((rowId) => (
        <ImplicitRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeRelation(rowId) : undefined} />
      ))}
      <button type="button" onClick={addRelation} style={{ margin: "0.35rem 0" }}>
        + Add relation
      </button>
      <div>
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="implicit"
          renderAtScale={(ctx, width, height) => drawImplicitPanel(ctx, width, height, graph, containerIds)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
      </div>
    </div>
  );
}
