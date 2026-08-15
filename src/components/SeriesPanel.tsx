import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSeries, type CellIdsSeries } from "../lib/cell-ids.ts";
import { analyzeSeries, type SeriesResult } from "../lib/series-analysis.ts";
import { DEFAULT_SERIES_STATE, decodeSeriesState, encodeSeriesState, type SeriesState } from "../lib/series-state.ts";
import { drawScatter, type Viewport } from "../lib/render-path.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 300;

function seedSeriesState(graph: CellGraph, ids: CellIdsSeries, state: SeriesState): void {
  graph.set(ids.exprText, state.exprText);
  graph.set(ids.variable, state.variable);
  graph.set(ids.fromN, state.fromN);
  graph.set(ids.toN, state.toN);
  graph.set(ids.plotCount, state.plotCount);
}

function getCurrentSeriesState(graph: CellGraph, ids: CellIdsSeries): SeriesState {
  return {
    v: 1,
    exprText: graph.get<string>(ids.exprText),
    variable: graph.get<string>(ids.variable),
    fromN: graph.get<string>(ids.fromN),
    toN: graph.get<string>(ids.toN),
    plotCount: graph.get<string>(ids.plotCount),
  };
}

function useSeriesGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsSeries(cellId);
    const decoded = typeof window !== "undefined" ? decodeSeriesState(window.location.hash.slice(1)) : null;
    seedSeriesState(graph, ids, decoded ?? DEFAULT_SERIES_STATE);

    graph.define(ids.result, (): Result<SeriesResult> => {
      try {
        const variable = graph.get<string>(ids.variable);
        const from = Number(graph.get<string>(ids.fromN));
        const to = Number(graph.get<string>(ids.toN));
        const plotCount = Number(graph.get<string>(ids.plotCount));
        if (Number.isNaN(from) || Number.isNaN(to)) throw new Error('"from"/"to" must be numbers (or "Infinity").');
        if (!Number.isInteger(from)) throw new Error('"from" must be an integer.');
        if (to < from) throw new Error('"to" must be greater than or equal to "from".');
        if (!Number.isInteger(plotCount) || plotCount <= 0) throw new Error("Plot count must be a positive integer.");
        const exprText = graph.get<string>(ids.exprText);
        return { ok: true, value: analyzeSeries(exprText, variable, from, to, plotCount) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * Partial sums of a user series (part of #26): a running partial-sum dot
 * plot alongside a convergence/divergence verdict via `Symbolic.sumSeries`
 * (which throws `SeriesDivergesError`, caught and reported rather than
 * crashing). A finite `to` is a plain partial sum; `to = Infinity` tries a
 * closed form (geometric series) or a numeric convergence check.
 */
export function SeriesPanel({ cellId = "series-1" }: { cellId?: string } = {}) {
  const graph = useSeriesGraph(cellId);
  useCellGraphTools(`calculus_series_${cellId}`, graph);
  const ids = cellIdsSeries(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprText = useCell<string>(graph, ids.exprText);
  const variable = useCell<string>(graph, ids.variable);
  const fromN = useCell<string>(graph, ids.fromN);
  const toN = useCell<string>(graph, ids.toN);
  const plotCount = useCell<string>(graph, ids.plotCount);
  const result = useCell<Result<SeriesResult>>(graph, ids.result);

  const [exprInput, setExprInput] = useState(exprText);
  useEffect(() => {
    setExprInput(exprText);
  }, [exprText]);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeSeriesState(getCurrentSeriesState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!result.ok) return;
    const { partialSums, finalSum } = result.value;
    if (partialSums.length === 0) return;
    const ns = partialSums.map((p) => p.n);
    const sums = partialSums.map((p) => p.sum);
    const yValues = finalSum === null ? sums : [...sums, finalSum];
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const pad = Math.max((yMax - yMin) * 0.1, 1e-6);
    const viewport: Viewport = { xMin: ns[0] ?? 0, xMax: ns[ns.length - 1] ?? 1, yMin: yMin - pad, yMax: yMax + pad };
    drawScatter(ctx, partialSums.map((p) => ({ x: p.n, y: p.sum })), viewport, WIDTH, HEIGHT, 3, "#2563eb");

    if (finalSum !== null) {
      const sy = HEIGHT - ((finalSum - viewport.yMin) / (viewport.yMax - viewport.yMin)) * HEIGHT;
      ctx.save();
      ctx.strokeStyle = "#9ca3af";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(WIDTH, sy);
      ctx.stroke();
      ctx.restore();
    }
  }, [result]);

  function updateExpr(value: string) {
    setExprInput(value);
    graph.set(ids.exprText, value);
  }

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Sum of a series, term by term -- try "Infinity" as the upper bound for an infinite series.
      </p>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Σ <input value={exprInput} onChange={(e) => updateExpr(e.target.value)} style={{ font: "inherit", width: "12ch" }} />
        </label>
        <label>
          var:{" "}
          <input value={variable} onChange={(e) => graph.set(ids.variable, e.target.value)} style={{ font: "inherit", width: "3ch" }} />
        </label>
        <label>
          from: <input value={fromN} onChange={(e) => graph.set(ids.fromN, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
        <label>
          to: <input value={toN} onChange={(e) => graph.set(ids.toN, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
        </label>
        <label>
          plot:{" "}
          <input
            type="number"
            min={1}
            value={plotCount}
            onChange={(e) => graph.set(ids.plotCount, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
      </div>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="series" />
      </div>
      {result.ok ? (
        result.value.diverges ? (
          <p style={{ color: "var(--danger)" }}>Diverges -- {result.value.divergeMessage}</p>
        ) : (
          <p>Sum = {result.value.finalSum?.toFixed(6)}</p>
        )
      ) : (
        <p style={{ color: "var(--danger)" }}>{result.message}</p>
      )}
    </div>
  );
}
