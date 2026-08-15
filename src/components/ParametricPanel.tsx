import type { Path2D } from "mallory-math";
import { useEffect, useRef } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsParametric } from "../lib/cell-ids.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { drawAxes, drawPath, type Viewport } from "../lib/render-path.ts";
import { sampleParametricCurve, samplePolarCurve } from "../lib/sample-parametric.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";

const WIDTH = 500;
const HEIGHT = 500;
const RESOLUTION = 400;
const VIEWPORT: Viewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };

type PathResult = { ok: true; path: Path2D } | { ok: false; message: string };
type Mode = "parametric" | "polar";

const DEFAULTS = { mode: "parametric" as Mode, exprX: "cos(t)", exprY: "sin(t)", exprR: "1+cos(t)", tMin: "0", tMax: "6.2832" };

/**
 * Sets up the parametric/polar panel's reactive cells on its own private
 * CellGraph. A polar curve r(θ) is sampled as the parametric curve
 * x=r·cosθ, y=r·sinθ (see `samplePolarCurve`) -- one `mode` cell picks which
 * of `exprX`/`exprY` vs. `exprR` the derived `path` cell reads.
 */
function useParametricGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsParametric(cellId);
    if (!graph.has(ids.mode)) {
      graph.set(ids.mode, DEFAULTS.mode);
      graph.set(ids.exprX, DEFAULTS.exprX);
      graph.set(ids.exprY, DEFAULTS.exprY);
      graph.set(ids.exprR, DEFAULTS.exprR);
      graph.set(ids.tMin, DEFAULTS.tMin);
      graph.set(ids.tMax, DEFAULTS.tMax);

      graph.define(ids.path, (): PathResult => {
        try {
          const mode = graph.get<Mode>(ids.mode);
          const tMin = Number(graph.get<string>(ids.tMin));
          const tMax = Number(graph.get<string>(ids.tMax));
          if ([tMin, tMax].some(Number.isNaN)) throw new Error("t-min/t-max must be numbers.");
          if (tMin >= tMax) throw new Error("t-min must be less than t-max.");
          const domain = { min: tMin, max: tMax };
          const path =
            mode === "polar"
              ? samplePolarCurve(graph.get<string>(ids.exprR), domain, RESOLUTION)
              : sampleParametricCurve(graph.get<string>(ids.exprX), graph.get<string>(ids.exprY), domain, RESOLUTION);
          return { ok: true, path };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    ref.current = graph;
  }
  return ref.current;
}

export interface ParametricPanelProps {
  cellId?: string;
}

/** v1: a single parametric curve (x(t),y(t)) or polar curve r(θ), over a fixed domain and viewport. */
export function ParametricPanel({ cellId = "parametric-1" }: ParametricPanelProps = {}) {
  const graph = useParametricGraph(cellId);
  useCellGraphTools("graphing_parametric", graph);
  const ids = cellIdsParametric(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const mode = useCell<Mode>(graph, ids.mode);
  const exprX = useCell<string>(graph, ids.exprX);
  const exprY = useCell<string>(graph, ids.exprY);
  const exprR = useCell<string>(graph, ids.exprR);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
  const path = useCell<PathResult>(graph, ids.path);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawAxes(ctx, VIEWPORT, WIDTH, HEIGHT);
    if (path.ok) drawPath(ctx, path.path, VIEWPORT, WIDTH, HEIGHT);
  }, [path]);

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          <input type="radio" checked={mode === "parametric"} onChange={() => graph.set(ids.mode, "parametric")} /> parametric
          (x(t), y(t))
        </label>{" "}
        <label>
          <input type="radio" checked={mode === "polar"} onChange={() => graph.set(ids.mode, "polar")} /> polar (r(θ))
        </label>
      </div>
      {mode === "polar" ? (
        <div style={{ margin: "0.25rem 0" }}>
          <label>
            r(θ) ={" "}
            <input value={exprR} onChange={(e) => graph.set(ids.exprR, e.target.value)} style={{ font: "inherit", width: "16ch" }} />
          </label>
        </div>
      ) : (
        <div style={{ margin: "0.25rem 0" }}>
          <label>
            x(t) ={" "}
            <input value={exprX} onChange={(e) => graph.set(ids.exprX, e.target.value)} style={{ font: "inherit", width: "12ch" }} />
          </label>{" "}
          <label>
            y(t) ={" "}
            <input value={exprY} onChange={(e) => graph.set(ids.exprY, e.target.value)} style={{ font: "inherit", width: "12ch" }} />
          </label>
        </div>
      )}
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          {mode === "polar" ? "θ" : "t"}: [
          <input value={tMin} onChange={(e) => graph.set(ids.tMin, e.target.value)} style={{ font: "inherit", width: "8ch" }} />,{" "}
          <input value={tMax} onChange={(e) => graph.set(ids.tMax, e.target.value)} style={{ font: "inherit", width: "8ch" }} />]
        </label>
      </div>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="parametric" />
      </div>
      {!path.ok && <p style={{ color: "var(--danger)" }}>{path.message}</p>}
    </div>
  );
}
