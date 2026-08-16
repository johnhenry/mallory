import type { Path2D } from "mallory-math";
import { useEffect, useRef } from "react";
import type { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsCurveTransform, notebookCurveCellId, type CurveTransformOp } from "../lib/cell-ids.ts";
import { derivativeCurve, differenceCurve, integralCurve, type CurvePoint } from "../lib/curve-transform.ts";
import { drawAxes, drawPolyline, type Viewport } from "../lib/render-path.ts";
import { useCell } from "../lib/use-cell.ts";

const WIDTH = 400;
const HEIGHT = 300;

type Result = { ok: true; runs: CurvePoint[][] } | { ok: false; message: string };

/**
 * Numeric derivative/integral of a graph row's published curve (issue #35
 * item 2's "later blocks can consume it" case) -- the whole-curve
 * counterpart to a "value" block referencing a named scalar. Reads
 * `notebookCurveCellId(curveName)` via the same `get()`-before-`hasValue()`
 * idiom `ExpressionRow.tsx` uses for scalars (see that file's doc comment):
 * the dependency edge is registered even before the name exists, so naming
 * a row *after* this block is created still triggers a live recompute.
 */
export function NotebookCurveTransformBlock({
  graph,
  blockId,
  initialCurveName,
  initialOp,
  initialCurveName2,
}: {
  graph: CellGraph;
  blockId: string;
  initialCurveName: string;
  initialOp: CurveTransformOp;
  initialCurveName2: string;
}) {
  const ids = cellIdsCurveTransform(blockId);
  const initRef = useRef(false);
  if (!initRef.current) {
    initRef.current = true;
    if (!graph.hasValue(ids.curveName)) {
      graph.set(ids.curveName, initialCurveName);
      graph.set(ids.curveName2, initialCurveName2);
      graph.set(ids.op, initialOp);
      graph.define(
        ids.result,
        (): Result => {
          const name = graph.get<string>(ids.curveName);
          const op = graph.get<CurveTransformOp>(ids.op);
          const cellId = notebookCurveCellId(name);
          const path = graph.get<Path2D | undefined>(cellId);
          if (!name) return { ok: false, message: "Enter a curve name to reference (name a graph row to publish one)." };
          if (!graph.hasValue(cellId) || path === undefined) return { ok: false, message: `No curve named "${name}" is published yet.` };
          if (op === "derivative") return { ok: true, runs: derivativeCurve(path) };
          if (op === "integral") return { ok: true, runs: integralCurve(path) };
          // op === "difference"
          const name2 = graph.get<string>(ids.curveName2);
          const cellId2 = notebookCurveCellId(name2);
          const path2 = graph.get<Path2D | undefined>(cellId2);
          if (!name2) return { ok: false, message: "Enter a second curve name to subtract." };
          if (!graph.hasValue(cellId2) || path2 === undefined) return { ok: false, message: `No curve named "${name2}" is published yet.` };
          return { ok: true, runs: differenceCurve(path, path2) };
        },
        { auxiliary: true },
      );
    }
  }

  const curveName = useCell<string>(graph, ids.curveName);
  const curveName2 = useCell<string>(graph, ids.curveName2);
  const op = useCell<CurveTransformOp>(graph, ids.op);
  const result = useCell<Result>(graph, ids.result);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!result.ok) return;
    const points = result.runs.flat();
    if (points.length === 0) return;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const yPad = Math.max((yMax - yMin) * 0.1, 1e-6);
    const viewport: Viewport = {
      xMin: xMin === xMax ? xMin - 1 : xMin,
      xMax: xMin === xMax ? xMax + 1 : xMax,
      yMin: yMin - yPad,
      yMax: yMax + yPad,
    };
    drawAxes(ctx, viewport, WIDTH, HEIGHT);
    for (const run of result.runs) drawPolyline(ctx, run, viewport, WIDTH, HEIGHT, "#7c3aed");
  }, [result]);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: "0.9rem" }}>
          curve:{" "}
          <input
            value={curveName}
            onChange={(e) => graph.set(ids.curveName, e.target.value)}
            placeholder="e.g. f"
            style={{ font: "inherit", width: "10ch" }}
          />
        </label>
        <label style={{ fontSize: "0.9rem" }}>
          op:{" "}
          <select value={op} onChange={(e) => graph.set(ids.op, e.target.value as CurveTransformOp)}>
            <option value="derivative">derivative</option>
            <option value="integral">running integral</option>
            <option value="difference">difference (curve − curve 2)</option>
          </select>
        </label>
        {op === "difference" && (
          <label style={{ fontSize: "0.9rem" }}>
            curve 2:{" "}
            <input
              value={curveName2}
              onChange={(e) => graph.set(ids.curveName2, e.target.value)}
              placeholder="e.g. g"
              style={{ font: "inherit", width: "10ch" }}
            />
          </label>
        )}
      </div>
      {result.ok ? (
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)", marginTop: "0.25rem" }} />
      ) : (
        <p style={{ color: "var(--danger)", fontSize: "0.9rem", margin: "0.25rem 0" }}>{result.message}</p>
      )}
    </div>
  );
}
