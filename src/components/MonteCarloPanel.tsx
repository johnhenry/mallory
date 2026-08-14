import { useEffect, useRef, useState } from "react";
import { Rng } from "mallory-tensor-core";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMonteCarlo, type CellIdsMonteCarlo } from "../lib/cell-ids.ts";
import { drawHistogram, drawPath, drawScatter, type Viewport } from "../lib/render-path.ts";
import {
  estimateDartPi,
  sampleDistributionHistogram,
  type DartPiResult,
  type DistributionSampleResult,
  type MonteCarloDistType,
} from "../lib/monte-carlo.ts";
import { DEFAULT_MONTE_CARLO_STATE, decodeMonteCarloState, encodeMonteCarloState, type MonteCarloState } from "../lib/monte-carlo-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";

const WIDTH = 400;
const HEIGHT = 400;

const DIST_LABELS: Record<MonteCarloDistType, string> = {
  normal: "Normal",
  uniform: "Uniform",
  exponential: "Exponential",
  binomial: "Binomial",
  poisson: "Poisson",
};

function seedMonteCarloState(graph: CellGraph, ids: CellIdsMonteCarlo, state: MonteCarloState): void {
  graph.set(ids.seed, state.seed);
  graph.set(ids.dartCount, state.dartCount);
  graph.set(ids.distType, state.distType);
  graph.set(ids.distMean, state.distMean);
  graph.set(ids.distSd, state.distSd);
  graph.set(ids.distA, state.distA);
  graph.set(ids.distB, state.distB);
  graph.set(ids.distRate, state.distRate);
  graph.set(ids.distN, state.distN);
  graph.set(ids.distP, state.distP);
  graph.set(ids.distLambda, state.distLambda);
  graph.set(ids.sampleCount, state.sampleCount);
}

function getCurrentMonteCarloState(graph: CellGraph, ids: CellIdsMonteCarlo): MonteCarloState {
  return {
    v: 1,
    seed: graph.get<string>(ids.seed),
    dartCount: graph.get<string>(ids.dartCount),
    distType: graph.get<MonteCarloDistType>(ids.distType),
    distMean: graph.get<string>(ids.distMean),
    distSd: graph.get<string>(ids.distSd),
    distA: graph.get<string>(ids.distA),
    distB: graph.get<string>(ids.distB),
    distRate: graph.get<string>(ids.distRate),
    distN: graph.get<string>(ids.distN),
    distP: graph.get<string>(ids.distP),
    distLambda: graph.get<string>(ids.distLambda),
    sampleCount: graph.get<string>(ids.sampleCount),
  };
}

type DartResult = { ok: true; result: DartPiResult } | { ok: false; message: string };
type HistResult = { ok: true; result: DistributionSampleResult } | { ok: false; message: string };

function useMonteCarloGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsMonteCarlo(cellId);
    const decoded = typeof window !== "undefined" ? decodeMonteCarloState(window.location.hash.slice(1)) : null;
    seedMonteCarloState(graph, ids, decoded ?? DEFAULT_MONTE_CARLO_STATE);

    graph.define(ids.dartResult, (): DartResult => {
      try {
        const seed = Number(graph.get<string>(ids.seed));
        const n = Number(graph.get<string>(ids.dartCount));
        if ([seed, n].some(Number.isNaN)) throw new Error("Seed and dart count must be numbers.");
        if (!Number.isInteger(n) || n <= 0) throw new Error("Dart count must be a positive integer.");
        return { ok: true, result: estimateDartPi(n, new Rng(seed)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.histResult, (): HistResult => {
      try {
        const seed = Number(graph.get<string>(ids.seed));
        const n = Number(graph.get<string>(ids.sampleCount));
        const distType = graph.get<MonteCarloDistType>(ids.distType);
        if ([seed, n].some(Number.isNaN)) throw new Error("Seed and sample count must be numbers.");
        if (!Number.isInteger(n) || n <= 0) throw new Error("Sample count must be a positive integer.");
        const params = {
          mean: Number(graph.get<string>(ids.distMean)),
          sd: Number(graph.get<string>(ids.distSd)),
          a: Number(graph.get<string>(ids.distA)),
          b: Number(graph.get<string>(ids.distB)),
          rate: Number(graph.get<string>(ids.distRate)),
          n: Number(graph.get<string>(ids.distN)),
          p: Number(graph.get<string>(ids.distP)),
          lambda: Number(graph.get<string>(ids.distLambda)),
        };
        // Use a distinct Rng from the dart-throwing one (offset seed) so the
        // two sections don't share a stream and silently correlate.
        return { ok: true, result: sampleDistributionHistogram(distType, params, n, new Rng(seed + 1)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/** Seeded (reproducible) Monte Carlo demos: pi estimation via dart-throwing, and a distribution-sampling histogram with its theoretical density overlaid. */
export function MonteCarloPanel({ cellId = "monte-carlo-1" }: { cellId?: string } = {}) {
  const graph = useMonteCarloGraph(cellId);
  useCellGraphTools(`data_montecarlo_${cellId}`, graph);
  const ids = cellIdsMonteCarlo(cellId);

  const dartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const convergenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const histCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const seed = useCell<string>(graph, ids.seed);
  const dartCount = useCell<string>(graph, ids.dartCount);
  const dartResult = useCell<DartResult>(graph, ids.dartResult);
  const distType = useCell<MonteCarloDistType>(graph, ids.distType);
  const distMean = useCell<string>(graph, ids.distMean);
  const distSd = useCell<string>(graph, ids.distSd);
  const distA = useCell<string>(graph, ids.distA);
  const distB = useCell<string>(graph, ids.distB);
  const distRate = useCell<string>(graph, ids.distRate);
  const distN = useCell<string>(graph, ids.distN);
  const distP = useCell<string>(graph, ids.distP);
  const distLambda = useCell<string>(graph, ids.distLambda);
  const sampleCount = useCell<string>(graph, ids.sampleCount);
  const histResult = useCell<HistResult>(graph, ids.histResult);

  const [seedInput, setSeedInput] = useState(seed);
  useEffect(() => {
    setSeedInput(seed);
  }, [seed]);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeMonteCarloState(getCurrentMonteCarloState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const ctx = dartCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (dartResult.ok) {
      const viewport: Viewport = { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
      const inside = dartResult.result.points.filter((p) => p.inside);
      const outside = dartResult.result.points.filter((p) => !p.inside);
      drawScatter(ctx, inside, viewport, WIDTH, HEIGHT, 1.5, "#16a34a");
      drawScatter(ctx, outside, viewport, WIDTH, HEIGHT, 1.5, "#dc2626");
    }
  }, [dartResult]);

  useEffect(() => {
    const ctx = convergenceCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, 120);
    if (dartResult.ok && dartResult.result.convergence.length > 0) {
      const maxN = dartResult.result.n;
      const viewport: Viewport = { xMin: 0, xMax: maxN, yMin: 2.5, yMax: 4 };
      const pts = dartResult.result.convergence.map((c) => ({ x: c.n, y: c.estimate }));
      drawScatter(ctx, pts, viewport, WIDTH, 120, 1.5, "#2563eb");
      // pi reference line
      const piY = viewport.yMax - Math.PI < 0 || Math.PI < viewport.yMin ? null : Math.PI;
      if (piY !== null) {
        const sy = 120 - ((piY - viewport.yMin) / (viewport.yMax - viewport.yMin)) * 120;
        ctx.save();
        ctx.strokeStyle = "#9ca3af";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(WIDTH, sy);
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [dartResult]);

  useEffect(() => {
    const ctx = histCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (histResult.ok) {
      const { bins, densityPath } = histResult.result;
      const maxCount = Math.max(...bins.map((b) => b.count), 1);
      const minX = bins[0]?.x0 ?? 0;
      const maxX = bins[bins.length - 1]?.x1 ?? 1;
      const countViewport: Viewport = { xMin: minX, xMax: maxX, yMin: 0, yMax: maxCount };
      drawHistogram(ctx, bins, countViewport, WIDTH, HEIGHT);
      // Density curve is drawn against a *proportion* scale (count/n / binWidth would
      // be true density), so it's overlaid on a separate rescaled pass rather than
      // sharing count-space y with the bars -- an approximation, not a properly
      // normalized dual-axis overlay (documented v1 simplification).
      const maxDensity = Math.max(...densityPath.commands.map((c) => c.y), 1e-9);
      const scaled = { ...densityPath, commands: densityPath.commands.map((c) => ({ ...c, y: (c.y / maxDensity) * maxCount })) };
      drawPath(ctx, scaled, countViewport, WIDTH, HEIGHT);
    }
  }, [histResult]);

  function updateSeed(value: string) {
    setSeedInput(value);
    graph.set(ids.seed, value);
  }

  return (
    <div>
      <h2>Estimate π by dart-throwing</h2>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <label>
          seed: <input value={seedInput} onChange={(e) => updateSeed(e.target.value)} style={{ font: "inherit", width: "8ch" }} />
        </label>
        <label>
          darts:{" "}
          <input
            type="number"
            value={dartCount}
            onChange={(e) => graph.set(ids.dartCount, e.target.value)}
            style={{ font: "inherit", width: "8ch" }}
          />
        </label>
      </div>
      <canvas ref={dartCanvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid #ccc" }} />
      <canvas ref={convergenceCanvasRef} width={WIDTH} height={120} style={{ border: "1px solid #ccc", display: "block", marginTop: "0.25rem" }} />
      {dartResult.ok ? (
        <p>π estimate = {dartResult.result.piEstimate.toFixed(5)} (actual π ≈ 3.14159)</p>
      ) : (
        <p style={{ color: "crimson" }}>{dartResult.message}</p>
      )}

      <h2>Distribution sampling</h2>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <label>
          distribution:{" "}
          <select value={distType} onChange={(e) => graph.set(ids.distType, e.target.value as MonteCarloDistType)}>
            {(Object.keys(DIST_LABELS) as MonteCarloDistType[]).map((t) => (
              <option key={t} value={t}>
                {DIST_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          n:{" "}
          <input
            type="number"
            value={sampleCount}
            onChange={(e) => graph.set(ids.sampleCount, e.target.value)}
            style={{ font: "inherit", width: "8ch" }}
          />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {distType === "normal" && (
          <>
            <label>
              mean: <input value={distMean} onChange={(e) => graph.set(ids.distMean, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
            <label>
              sd: <input value={distSd} onChange={(e) => graph.set(ids.distSd, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
          </>
        )}
        {distType === "uniform" && (
          <>
            <label>
              a: <input value={distA} onChange={(e) => graph.set(ids.distA, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
            <label>
              b: <input value={distB} onChange={(e) => graph.set(ids.distB, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
          </>
        )}
        {distType === "exponential" && (
          <label>
            rate: <input value={distRate} onChange={(e) => graph.set(ids.distRate, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
          </label>
        )}
        {distType === "binomial" && (
          <>
            <label>
              n: <input value={distN} onChange={(e) => graph.set(ids.distN, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
            <label>
              p: <input value={distP} onChange={(e) => graph.set(ids.distP, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
          </>
        )}
        {distType === "poisson" && (
          <label>
            λ: <input value={distLambda} onChange={(e) => graph.set(ids.distLambda, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
          </label>
        )}
      </div>
      <canvas ref={histCanvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid #ccc" }} />
      {histResult.ok ? (
        <p>
          sample mean = {histResult.result.sampleMean.toFixed(4)} (theoretical {histResult.result.theoreticalMean.toFixed(4)}), sample
          variance = {histResult.result.sampleVariance.toFixed(4)} (theoretical {histResult.result.theoreticalVariance.toFixed(4)})
        </p>
      ) : (
        <p style={{ color: "crimson" }}>{histResult.message}</p>
      )}
    </div>
  );
}
