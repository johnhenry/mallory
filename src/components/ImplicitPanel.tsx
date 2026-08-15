import { useEffect, useRef } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsImplicit } from "../lib/cell-ids.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { drawAxes, drawImplicitBoxes, drawImplicitCurve, drawVectorField, type Viewport } from "../lib/render-path.ts";
import { sampleImplicitCurve, type ImplicitSegment } from "../lib/sample-implicit.ts";
import { sampleImplicitCurveIntervalBoxes, type ImplicitBox } from "../lib/interval-implicit.ts";
import { computeContourLevels, type ContourLevel } from "../lib/contour-plot.ts";
import { sampleGradientField } from "../lib/gradient-field.ts";
import { equationToImplicitZero } from "../lib/equation-to-zero.ts";
import type { VectorFieldPoint } from "../lib/sample-ode.ts";
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
 * Sets up the implicit-curve panel's reactive cells on its own private
 * CellGraph -- a two-variable relation plus a rectangular domain, a
 * different input shape from GraphCanvas's single expression + axis
 * variable, so (like SystemSolverPanel/StatisticsPanel/OdePanel) it isn't
 * woven into `cellIds`/`useExpressionGraph`.
 */
function useImplicitGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsImplicit(cellId);
    if (!graph.has(ids.expr)) {
      graph.set(ids.expr, DEFAULTS.expr);
      graph.set(ids.xMin, DEFAULTS.xMin);
      graph.set(ids.xMax, DEFAULTS.xMax);
      graph.set(ids.yMin, DEFAULTS.yMin);
      graph.set(ids.yMax, DEFAULTS.yMax);

      graph.define(ids.segments, (): SegmentsResult => {
        try {
          const expr = graph.get<string>(ids.expr);
          const xMin = Number(graph.get<string>(ids.xMin));
          const xMax = Number(graph.get<string>(ids.xMax));
          const yMin = Number(graph.get<string>(ids.yMin));
          const yMax = Number(graph.get<string>(ids.yMax));
          if ([xMin, xMax, yMin, yMax].some(Number.isNaN)) throw new Error("Every domain field must be a number.");
          if (xMin >= xMax || yMin >= yMax) throw new Error("min must be less than max for both x and y.");
          return { ok: true, segments: sampleImplicitCurve(expr, { min: xMin, max: xMax }, { min: yMin, max: yMax }, RESOLUTION) };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });

      graph.set(ids.showContours, false, { auxiliary: true });
      graph.set(ids.showGradient, false, { auxiliary: true });
      graph.set(ids.showIntervalBoxes, false, { auxiliary: true });

      graph.define(
        ids.contourResult,
        (): ContourResult => {
          if (!graph.get<boolean>(ids.showContours)) return { ok: true, levels: [] };
          try {
            const field = equationToImplicitZero(graph.get<string>(ids.expr));
            const xMin = Number(graph.get<string>(ids.xMin));
            const xMax = Number(graph.get<string>(ids.xMax));
            const yMin = Number(graph.get<string>(ids.yMin));
            const yMax = Number(graph.get<string>(ids.yMax));
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
            const xMin = Number(graph.get<string>(ids.xMin));
            const xMax = Number(graph.get<string>(ids.xMax));
            const yMin = Number(graph.get<string>(ids.yMin));
            const yMax = Number(graph.get<string>(ids.yMax));
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
            const xMin = Number(graph.get<string>(ids.xMin));
            const xMax = Number(graph.get<string>(ids.xMax));
            const yMin = Number(graph.get<string>(ids.yMin));
            const yMax = Number(graph.get<string>(ids.yMax));
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
    ref.current = graph;
  }
  return ref.current;
}

export interface ImplicitPanelProps {
  cellId?: string;
}

/** v1: a single two-variable relation (e.g. "x^2+y^2=4") traced via marching squares over a fixed (non-pannable) domain. */
export function ImplicitPanel({ cellId = "implicit-1" }: ImplicitPanelProps = {}) {
  const graph = useImplicitGraph(cellId);
  useCellGraphTools("graphing_implicit", graph);
  const ids = cellIdsImplicit(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprValue = useCell<string>(graph, ids.expr);
  const xMin = useCell<string>(graph, ids.xMin);
  const xMax = useCell<string>(graph, ids.xMax);
  const yMin = useCell<string>(graph, ids.yMin);
  const yMax = useCell<string>(graph, ids.yMax);
  const segments = useCell<SegmentsResult>(graph, ids.segments);
  const showContours = useCell<boolean>(graph, ids.showContours);
  const contourResult = useCell<ContourResult>(graph, ids.contourResult);
  const showGradient = useCell<boolean>(graph, ids.showGradient);
  const gradientResult = useCell<GradientResult>(graph, ids.gradientResult);
  const showIntervalBoxes = useCell<boolean>(graph, ids.showIntervalBoxes);
  const intervalBoxesResult = useCell<IntervalBoxesResult>(graph, ids.intervalBoxesResult);

  const viewport: Viewport = {
    xMin: boundOrDefault(xMin, -5),
    xMax: boundOrDefault(xMax, 5),
    yMin: boundOrDefault(yMin, -5),
    yMax: boundOrDefault(yMax, 5),
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawAxes(ctx, viewport, WIDTH, HEIGHT);
    if (showIntervalBoxes && intervalBoxesResult.ok) {
      drawImplicitBoxes(ctx, intervalBoxesResult.boxes, viewport, WIDTH, HEIGHT);
    }
    if (segments.ok) drawImplicitCurve(ctx, segments.segments, viewport, WIDTH, HEIGHT);
    if (showContours && contourResult.ok) {
      contourResult.levels.forEach((level, i) => {
        drawImplicitCurve(ctx, level.segments, viewport, WIDTH, HEIGHT, levelColor(i, contourResult.levels.length));
      });
    }
    if (showGradient && gradientResult.ok) {
      drawVectorField(ctx, gradientResult.points, viewport, WIDTH, HEIGHT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, xMin, xMax, yMin, yMax, showContours, contourResult, showGradient, gradientResult, showIntervalBoxes, intervalBoxesResult]);

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          relation:{" "}
          <input
            value={exprValue}
            onChange={(e) => graph.set(ids.expr, e.target.value)}
            style={{ font: "inherit", width: "22ch" }}
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
      {showContours && !contourResult.ok && <p style={{ color: "var(--danger)" }}>{contourResult.message}</p>}
      {showGradient && !gradientResult.ok && <p style={{ color: "var(--danger)" }}>{gradientResult.message}</p>}
      {showIntervalBoxes && !intervalBoxesResult.ok && <p style={{ color: "var(--danger)" }}>{intervalBoxesResult.message}</p>}
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="implicit" />
      </div>
      {!segments.ok && <p style={{ color: "var(--danger)" }}>{segments.message}</p>}
    </div>
  );
}
