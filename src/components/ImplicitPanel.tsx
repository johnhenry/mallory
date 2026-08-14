import { useEffect, useRef } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsImplicit } from "../lib/cell-ids.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { drawImplicitCurve, type Viewport } from "../lib/render-path.ts";
import { sampleImplicitCurve, type ImplicitSegment } from "../lib/sample-implicit.ts";
import { useCell } from "../lib/use-cell.ts";

const WIDTH = 500;
const HEIGHT = 500;
const RESOLUTION = 80;

type SegmentsResult = { ok: true; segments: ImplicitSegment[] } | { ok: false; message: string };

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

  const viewport: Viewport = {
    xMin: Number(xMin) || -5,
    xMax: Number(xMax) || 5,
    yMin: Number(yMin) || -5,
    yMax: Number(yMax) || 5,
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (segments.ok) drawImplicitCurve(ctx, segments.segments, viewport, WIDTH, HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, xMin, xMax, yMin, yMax]);

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
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      {!segments.ok && <p style={{ color: "var(--danger)" }}>{segments.message}</p>}
    </div>
  );
}
